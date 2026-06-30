#!/usr/bin/env node
// =============================================================================
// UMZH Connect Sandbox – Admin API
// =============================================================================
// Merged admin surface (formerly the separate reseed-api + onboarding-api).
//
//   Seed management:
//     POST /reseed       Expunge all FHIR partitions, then reload seed bundles
//
//   Onboarding:
//     POST /invites      Generate a single-use registration token (admin-only)
//     POST /register     Create a Keycloak user from a valid invite token
//     GET  /clients      List onboarded M2M clients
//     POST /clients      Onboard a new M2M client (L1 or L2) + FHIR org
//
//   GET  /health         Liveness check
//
// Intended as an internal sandbox utility; CORS is wide-open. Privileged
// routes are gated by Keycloak token introspection + realm-role checks.
// =============================================================================

'use strict';

const http = require('http');
const fs   = require('fs');

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------
const KEYCLOAK_URL           = process.env.KEYCLOAK_URL           || 'http://keycloak:8080';
// Public Keycloak base used in responses handed back to clients (token endpoint
// they will actually call). Defaults to the internal URL for local dev.
const KEYCLOAK_PUBLIC_URL    = process.env.KEYCLOAK_PUBLIC_URL    || KEYCLOAK_URL;
const KEYCLOAK_REALM         = process.env.KEYCLOAK_REALM         || 'umzh-connect';
// Confidential client used both to mint admin tokens (client_credentials) and to
// authenticate the introspection calls that validate incoming user tokens. Must
// have the realm-management roles manage-users / manage-clients.
const ADMIN_CLIENT_ID        = process.env.ONBOARDING_CLIENT_ID   || 'onboarding-client';
const ADMIN_CLIENT_SECRET    = process.env.ONBOARDING_CLIENT_SECRET;
const FHIR_BASE              = process.env.FHIR_BASE_URL          || 'http://hapi-fhir:8080/fhir';
const PLACER_URL            = process.env.PLACER_EXTERNAL_URL    || 'http://localhost:8081';
const FULFILLER_URL         = process.env.FULFILLER_EXTERNAL_URL || 'http://localhost:8083';
const REGISTRY_EXTERNAL_URL  = process.env.REGISTRY_EXTERNAL_URL  || 'http://localhost:8084';
const PORT                   = parseInt(process.env.PORT || '9000', 10);

const INVITE_FILE   = '/data/invites.json';
const CLIENTS_FILE  = '/data/clients.json';
const INVITE_TTL_MS = 48 * 60 * 60 * 1000; // 48 hours

const ADMIN_API      = `${KEYCLOAK_URL}/admin/realms/${KEYCLOAK_REALM}`;
const TOKEN_URL      = `${KEYCLOAK_URL}/realms/${KEYCLOAK_REALM}/protocol/openid-connect/token`;
const INTROSPECT_URL = `${KEYCLOAK_URL}/realms/${KEYCLOAK_REALM}/protocol/openid-connect/token/introspect`;

// Roles assigned to every self-registered sandbox user.
// Deliberately minimal — permissions are granted explicitly in a second step.
const USER_ROLES = ['user'];

// Roles assigned to every onboarded M2M client's service account.
// placer+fulfiller lets the client call both external gateways (OPA requires
// "fulfiller" on placer-external and "placer" on fulfiller-external).
const CLIENT_ROLES = ['placer', 'fulfiller'];

// Default SMART scopes for onboarded clients (crus on Task, read-only elsewhere)
const DEFAULT_SCOPES = [
  'system/Task.crus',
  'system/ServiceRequest.rs',
  'system/Patient.r',
  'system/Condition.r',
  'system/MedicationStatement.r',
  'system/AllergyIntolerance.r',
  'system/Coverage.r',
  'system/Observation.r',
  'system/Procedure.r',
  'system/Immunization.r',
  'system/DiagnosticReport.r',
  'system/QuestionnaireResponse.cru',
  'system/ImagingStudy.r',
  'system/Appointment.r',
];

const FHIR_BASE_URL_EXT = 'https://umzhconnect.ch/ext/fhir-base-url';

// ===========================================================================
// Keycloak helpers
// ===========================================================================

async function getAdminToken() {
  const res = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type:    'client_credentials',
      client_id:     ADMIN_CLIENT_ID,
      client_secret: ADMIN_CLIENT_SECRET,
    }),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Failed to get admin token (${res.status}): ${text}`);
  }
  const data = await res.json();
  return data.access_token;
}

async function kcGet(path, adminToken) {
  const res = await fetch(`${ADMIN_API}${path}`, {
    headers: { Authorization: `Bearer ${adminToken}` },
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`GET ${path} failed (${res.status}): ${text}`);
  }
  return res.json();
}

async function kcPost(path, body, adminToken) {
  const res = await fetch(`${ADMIN_API}${path}`, {
    method:  'POST',
    headers: {
      'Content-Type':  'application/json',
      Authorization:   `Bearer ${adminToken}`,
    },
    body: JSON.stringify(body),
  });
  return res;
}

// Validate an incoming Bearer token via Keycloak introspection.
async function introspectToken(bearerToken) {
  const res = await fetch(INTROSPECT_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      token:         bearerToken,
      client_id:     ADMIN_CLIENT_ID,
      client_secret: ADMIN_CLIENT_SECRET,
    }),
  });
  if (!res.ok) throw new Error('Introspection request failed');
  return res.json(); // { active, realm_access, ... }
}

// Extract the bearer token and require the caller to hold the `admin` realm role.
// Returns null on success, or { status, message } on failure.
async function requireAdmin(req) {
  const authHeader = req.headers['authorization'] || '';
  if (!authHeader.startsWith('Bearer ')) {
    return { status: 401, message: 'Authorization: Bearer <token> required' };
  }
  const token = authHeader.slice(7);
  let info;
  try {
    info = await introspectToken(token);
  } catch (err) {
    console.error('Token introspection failed:', err.message);
    return { status: 503, message: 'Auth service unavailable' };
  }
  if (!info || !info.active) {
    return { status: 401, message: 'Token is not active' };
  }
  const roles = info.realm_access?.roles || info.realm_roles || [];
  if (!roles.includes('admin')) {
    return { status: 403, message: 'admin role required' };
  }
  return null;
}

// ===========================================================================
// FHIR helpers
// ===========================================================================

// Throwing helper: POST a resource into a partition, returns parsed JSON.
async function fhirPost(partition, resource) {
  const url = `${FHIR_BASE}/${partition}/${resource.resourceType}`;
  const res = await fetch(url, {
    method:  'POST',
    headers: { 'Content-Type': 'application/fhir+json' },
    body:    JSON.stringify(resource),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`FHIR POST /${partition}/${resource.resourceType} failed (${res.status}): ${text}`);
  }
  return res.json();
}

async function fhirPatch(partition, resourcePath, patch) {
  const url = `${FHIR_BASE}/${partition}/${resourcePath}`;
  const res = await fetch(url, {
    method:  'PATCH',
    headers: { 'Content-Type': 'application/json-patch+json' },
    body:    JSON.stringify(patch),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`FHIR PATCH /${partition}/${resourcePath} failed (${res.status}): ${text}`);
  }
  return res.json();
}

// Non-throwing helper for the reseed flow: POST raw JSON to an arbitrary FHIR
// path and return { status, body } so the caller can log/branch on the status.
async function fhirPostRaw(path, body) {
  const res = await fetch(`${FHIR_BASE}${path}`, {
    method : 'POST',
    headers: { 'Content-Type': 'application/fhir+json' },
    body   : JSON.stringify(body),
  });
  const text = await res.text();
  return { status: res.status, body: text };
}

// ===========================================================================
// Onboarding: small utilities
// ===========================================================================

function toSlug(name) {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 32);
}

function generateSecret(len = 32) {
  const chars = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
  const { randomInt } = require('crypto');
  return Array.from({ length: len }, () => chars[randomInt(chars.length)]).join('');
}

function generateInviteToken() {
  const { randomBytes } = require('crypto');
  return randomBytes(20).toString('hex');
}

function loadInvites() {
  try { return JSON.parse(fs.readFileSync(INVITE_FILE, 'utf8')); }
  catch { return {}; }
}

function saveInvites(invites) {
  fs.writeFileSync(INVITE_FILE, JSON.stringify(invites, null, 2));
}

function loadClients() {
  try { return JSON.parse(fs.readFileSync(CLIENTS_FILE, 'utf8')); }
  catch { return []; }
}

function saveClients(clients) {
  fs.writeFileSync(CLIENTS_FILE, JSON.stringify(clients, null, 2));
}

// ===========================================================================
// Onboarding: route handlers
// ===========================================================================

// POST /invites  (admin-only — generates a single-use registration token)
async function handleCreateInvite(bearerToken) {
  const tokenInfo = await introspectToken(bearerToken);
  if (!tokenInfo.active) return { status: 401, body: { error: 'Token is not active' } };
  const callerRoles = tokenInfo.realm_access?.roles || tokenInfo.realm_roles || [];
  if (!callerRoles.includes('admin')) return { status: 403, body: { error: 'admin role required' } };

  const token    = generateInviteToken();
  const now      = Date.now();
  const invites  = loadInvites();
  invites[token] = { createdAt: now, expiresAt: now + INVITE_TTL_MS, usedAt: null };
  saveInvites(invites);

  return {
    status: 201,
    body: {
      token,
      expiresAt: new Date(now + INVITE_TTL_MS).toISOString(),
      message: 'Share this token out-of-band. It is single-use and expires in 48 hours.',
    },
  };
}

// POST /register
async function handleRegister(body) {
  const { email, password, firstName, lastName, inviteToken } = body;
  if (!email || !password || !firstName || !lastName || !inviteToken) {
    return { status: 400, body: { error: 'email, password, firstName, lastName, inviteToken are required' } };
  }

  // Validate invite token before touching Keycloak
  const invites = loadInvites();
  const invite  = invites[inviteToken];
  if (!invite)                       return { status: 403, body: { error: 'Invalid invite token' } };
  if (invite.usedAt)                 return { status: 403, body: { error: 'Invite token has already been used' } };
  if (Date.now() > invite.expiresAt) return { status: 403, body: { error: 'Invite token has expired' } };

  const adminToken = await getAdminToken();

  // Create user
  const createRes = await kcPost('/users', {
    username:  email,
    email,
    firstName,
    lastName,
    enabled:   true,
    emailVerified: true,
    credentials: [{ type: 'password', value: password, temporary: false }],
  }, adminToken);

  if (createRes.status === 409) {
    return { status: 409, body: { error: 'A user with this email already exists' } };
  }
  if (!createRes.ok) {
    const text = await createRes.text();
    throw new Error(`User creation failed (${createRes.status}): ${text}`);
  }

  // Keycloak returns the new user URL in Location header; extract the ID
  const location = createRes.headers.get('location') || '';
  const userId = location.split('/').pop();
  if (!userId) throw new Error('Could not extract user ID from Keycloak response');

  // Fetch role representations
  const roleReps = await Promise.all(
    USER_ROLES.map(name => kcGet(`/roles/${name}`, adminToken))
  );

  // Assign roles
  const assignRes = await kcPost(`/users/${userId}/role-mappings/realm`, roleReps, adminToken);
  if (!assignRes.ok) {
    const text = await assignRes.text();
    throw new Error(`Role assignment failed (${assignRes.status}): ${text}`);
  }

  // Consume the invite — mark used so it cannot be replayed
  invites[inviteToken].usedAt = Date.now();
  saveInvites(invites);

  return {
    status: 201,
    body: { userId, email, message: 'User created with user role' },
  };
}

// GET /clients
async function handleListClients(bearerToken) {
  const tokenInfo = await introspectToken(bearerToken);
  if (!tokenInfo || !tokenInfo.active) return { status: 401, body: { error: 'Token is not active' } };
  return { status: 200, body: loadClients() };
}

// POST /clients
async function handleCreateClient(body, bearerToken) {
  // Validate caller
  const tokenInfo = await introspectToken(bearerToken);
  if (!tokenInfo.active) {
    return { status: 401, body: { error: 'Token is not active' } };
  }
  const callerRoles = tokenInfo.realm_access?.roles || tokenInfo.realm_roles || [];
  if (!callerRoles.includes('admin') && !callerRoles.includes('user')) {
    return { status: 403, body: { error: 'admin or user role required' } };
  }

  const { orgName, orgIdentifier, fhirBaseUrl, level, jwksUrl } = body;
  if (!orgName || !level) {
    return { status: 400, body: { error: 'orgName and level (l1|l2) are required' } };
  }
  if (level !== 'l1' && level !== 'l2') {
    return { status: 400, body: { error: "level must be 'l1' or 'l2'" } };
  }
  if (level === 'l2' && !jwksUrl) {
    return { status: 400, body: { error: 'jwksUrl is required for l2 clients' } };
  }

  const slug      = toSlug(orgName);
  const clientId  = `${slug}-${level}-${Date.now().toString(36)}`;
  const adminToken = await getAdminToken();

  // ── 1. Create Organization in FHIR registry ──────────────────────────────
  const orgResource = {
    resourceType: 'Organization',
    active:       true,
    name:         orgName,
    ...(orgIdentifier ? {
      identifier: [{ system: 'urn:oid:2.51.1.3', value: orgIdentifier }],
    } : {}),
    ...(fhirBaseUrl ? {
      extension: [{ url: FHIR_BASE_URL_EXT, valueUrl: fhirBaseUrl }],
    } : {}),
    meta: {
      tag: [{ system: 'https://umzhconnect.ch/tags', code: 'sandbox-onboarded' }],
    },
  };

  const createdOrg   = await fhirPost('registry', orgResource);
  const orgId        = createdOrg.id;
  const orgReference = `${REGISTRY_EXTERNAL_URL}/fhir/Organization/${orgId}`;

  // ── 1b. Create associated Endpoint (if fhirBaseUrl provided) ─────────────
  let endpointId = null;
  if (fhirBaseUrl) {
    const endpointResource = {
      resourceType: 'Endpoint',
      status:       'active',
      connectionType: {
        system: 'http://terminology.hl7.org/CodeSystem/endpoint-connection-type',
        code:   'hl7-fhir-rest',
      },
      name:                 `${orgName} FHIR Endpoint`,
      managingOrganization: { reference: `Organization/${orgId}` },
      payloadType: [{
        coding: [{
          system: 'http://terminology.hl7.org/CodeSystem/endpoint-payload-type',
          code:   'any',
        }],
      }],
      address: fhirBaseUrl,
      meta: {
        tag: [{ system: 'https://umzhconnect.ch/tags', code: 'sandbox-onboarded' }],
      },
    };
    const createdEndpoint = await fhirPost('registry', endpointResource);
    endpointId = createdEndpoint.id;

    // Patch Organization.endpoint so _include=Organization:endpoint also resolves
    await fhirPatch('registry', `Organization/${orgId}`, [
      { op: 'add', path: '/endpoint', value: [{ reference: `Endpoint/${endpointId}` }] },
    ]);
  }

  // ── 2. Create Keycloak client ─────────────────────────────────────────────
  const clientPayload = {
    clientId,
    name:        `${orgName} (${level.toUpperCase()} sandbox client)`,
    description: `Onboarded via sandbox self-service for ${orgName}`,
    enabled:     true,
    publicClient:              false,
    standardFlowEnabled:       false,
    directAccessGrantsEnabled: false,
    serviceAccountsEnabled:    true,
    protocol:    'openid-connect',
    defaultClientScopes: DEFAULT_SCOPES,
    optionalClientScopes: [],
    protocolMappers: [
      {
        name:           'org-reference-mapper',
        protocol:       'openid-connect',
        protocolMapper: 'oidc-hardcoded-claim-mapper',
        config: {
          'claim.name':        'extensions.umzhconnect.organization_reference',
          'claim.value':       orgReference,
          'jsonType.label':    'String',
          'id.token.claim':    'false',
          'access.token.claim':'true',
          'userinfo.token.claim':'false',
        },
      },
      {
        name:           'tenant-mapper',
        protocol:       'openid-connect',
        protocolMapper: 'oidc-hardcoded-claim-mapper',
        config: {
          'claim.name':        'tenant',
          'claim.value':       slug,
          'jsonType.label':    'String',
          'id.token.claim':    'false',
          'access.token.claim':'true',
          'userinfo.token.claim':'false',
        },
      },
      {
        name:           'fhir-context-mapper',
        protocol:       'openid-connect',
        protocolMapper: 'umzh-fhir-context-mapper',
        config: {
          'id.token.claim':    'false',
          'access.token.claim':'true',
          'userinfo.token.claim':'false',
        },
      },
      {
        name:           'realm-roles',
        protocol:       'openid-connect',
        protocolMapper: 'oidc-usermodel-realm-role-mapper',
        config: {
          multivalued:         'true',
          'claim.name':        'realm_roles',
          'jsonType.label':    'String',
          'id.token.claim':    'false',
          'access.token.claim':'true',
          'userinfo.token.claim':'false',
        },
      },
    ],
  };

  // L1: client_secret
  let clientSecret = null;
  if (level === 'l1') {
    clientSecret = generateSecret();
    clientPayload.clientAuthenticatorType = 'client-secret';
    clientPayload.secret = clientSecret;
  }

  // L2: private_key_jwt via user-supplied JWKS URL
  if (level === 'l2') {
    clientPayload.clientAuthenticatorType = 'client-jwt';
    clientPayload.attributes = {
      'use.jwks.url': 'true',
      'jwks.url':     jwksUrl,
    };
  }

  const createClientRes = await kcPost('/clients', clientPayload, adminToken);
  if (!createClientRes.ok) {
    const text = await createClientRes.text();
    throw new Error(`Client creation failed (${createClientRes.status}): ${text}`);
  }

  // Get the created client's internal ID
  const clients = await kcGet(`/clients?clientId=${encodeURIComponent(clientId)}`, adminToken);
  const internalId = clients[0]?.id;
  if (!internalId) throw new Error('Could not find newly created client in Keycloak');

  // Get the service account user
  const saUser = await kcGet(`/clients/${internalId}/service-account-user`, adminToken);
  const saUserId = saUser.id;

  // Assign placer + fulfiller roles to service account
  const roleReps = await Promise.all(
    CLIENT_ROLES.map(name => kcGet(`/roles/${name}`, adminToken))
  );
  const assignRes = await kcPost(`/users/${saUserId}/role-mappings/realm`, roleReps, adminToken);
  if (!assignRes.ok) {
    const text = await assignRes.text();
    throw new Error(`Service account role assignment failed (${assignRes.status}): ${text}`);
  }

  const result = {
    clientId,
    level,
    orgName,
    orgId,
    orgReference,
    ...(endpointId ? { endpointId, fhirBaseUrl } : {}),
    tokenEndpoint: `${KEYCLOAK_PUBLIC_URL}/realms/${KEYCLOAK_REALM}/protocol/openid-connect/token`,
  };
  if (level === 'l1') result.clientSecret = clientSecret;
  if (level === 'l2') result.jwksUrl = jwksUrl;

  // Persist so GET /clients can list all onboarded clients
  const stored = loadClients();
  stored.push({ ...result, createdAt: new Date().toISOString() });
  saveClients(stored);

  return { status: 201, body: result };
}

// ===========================================================================
// Reseed: expunge + reload all FHIR seed bundles
// ===========================================================================

// Resource types seeded across the clinical partitions.
// expungeEverything=true is unconditionally GLOBAL in HAPI and wipes the IG
// package (SearchParameters). Instead: soft-delete per type, then hard-expunge
// deleted resources — both operations are partition-scoped.
//
// Order matters: Consent.provision.data.reference is not a registered
// SearchParameter so HAPI's _cascade=delete cannot follow it. Delete Consent
// and QuestionnaireResponse first so subsequent deletes succeed without 409.
const CLINICAL_TYPES = [
  'Consent', 'QuestionnaireResponse',
  'Task', 'Appointment',
  'ServiceRequest',
  'Observation', 'AllergyIntolerance', 'Condition', 'Coverage',
  'DocumentReference', 'ImagingStudy', 'MedicationStatement',
  'PractitionerRole', 'HealthcareService', 'Endpoint',
  'Organization', 'Patient', 'Practitioner',
];

async function expungePartition(partition, log) {
  // Step 1: soft-delete per type. _cascade=delete handles referential integrity.
  for (const type of CLINICAL_TYPES) {
    const res = await fetch(
      `${FHIR_BASE}/${partition}/${type}?_lastUpdated=ge1900-01-01&_cascade=delete`,
      { method: 'DELETE' }
    );
    if (res.status !== 200 && res.status !== 204 && res.status !== 404) {
      log(`  DELETE /${partition}/${type}: HTTP ${res.status}`);
    }
  }

  // Step 2: hard-expunge tombstones (partition-scoped, not global).
  const result = await fhirPostRaw(`/${partition}/$expunge`, {
    resourceType: 'Parameters',
    parameter   : [{ name: 'expungeDeletedResources', valueBoolean: true }],
  });
  log(`  Expunge /${partition}: HTTP ${result.status}`);
}

async function createPartition(id, name, desc, log) {
  const result = await fhirPostRaw('/DEFAULT/$partition-management-create-partition', {
    resourceType: 'Parameters',
    parameter   : [
      { name: 'id',          valueInteger: id   },
      { name: 'name',        valueCode   : name },
      { name: 'description', valueString : desc },
    ],
  });
  const ok = result.status === 200 || result.status === 201;
  const skip = result.status === 409 ||
               (result.status === 400 && result.body.includes('already defined'));
  log(`  Partition '${name}': HTTP ${result.status}${skip ? ' (already exists — ok)' : ''}`);
  if (!ok && !skip) {
    throw new Error(`Failed to create partition '${name}': HTTP ${result.status}`);
  }
}

function loadBundleWithSubstitution(file) {
  let str = fs.readFileSync(`/seed/bundles/${file}`, 'utf8');
  return JSON.parse(
    str
      .replace(/__PLACER_EXTERNAL_URL__/g,    PLACER_URL)
      .replace(/__FULFILLER_EXTERNAL_URL__/g, FULFILLER_URL)
      .replace(/__REGISTRY_URL__/g,           REGISTRY_EXTERNAL_URL)
  );
}

async function loadPartitionBundle(partition, file, log) {
  const bundle = loadBundleWithSubstitution(file);
  const result = await fhirPostRaw(`/${partition}`, bundle);
  log(`  ${partition} bundle: HTTP ${result.status}`);
  if (result.status !== 200 && result.status !== 201) {
    throw new Error(`${partition} bundle failed: HTTP ${result.status}`);
  }
}

async function reseed() {
  const lines = [];
  const log   = (msg) => { lines.push(msg); console.log(msg); };

  log('=== RESEED STARTED ===');

  // [1/3] Clear clinical partitions (IG-safe per-type delete + expunge)
  log('\n[1/3] Expunging FHIR partitions…');
  await expungePartition('placer',    log);
  await expungePartition('fulfiller', log);
  await expungePartition('registry',  log);

  // [2/3] Re-create named partitions (may already exist in the DB schema)
  log('\n[2/3] Ensuring FHIR partitions exist…');
  await createPartition(1, 'placer',    'HospitalP (Placer) partition',    log);
  await createPartition(2, 'fulfiller', 'HospitalF (Fulfiller) partition', log);
  await createPartition(3, 'registry',  'Organization registry partition', log);

  // [3/3] Reload seed bundles
  log('\n[3/3] Loading seed bundles…');
  await loadPartitionBundle('DEFAULT',   'shared-bundle.json',    log);
  await loadPartitionBundle('placer',    'placer-bundle.json',    log);
  await loadPartitionBundle('fulfiller', 'fulfiller-bundle.json', log);
  await loadPartitionBundle('registry',  'registry-bundle.json',  log);

  log('\n=== RESEED COMPLETE ===');
  return lines;
}

// ===========================================================================
// HTTP server
// ===========================================================================
function readBody(req) {
  return new Promise((resolve, reject) => {
    let data = '';
    req.on('data', chunk => { data += chunk; });
    req.on('end', () => {
      try { resolve(data ? JSON.parse(data) : {}); }
      catch { reject(new Error('Invalid JSON body')); }
    });
    req.on('error', reject);
  });
}

function bearerFrom(req) {
  const authHeader = req.headers['authorization'] || '';
  return authHeader.startsWith('Bearer ') ? authHeader.slice(7) : null;
}

const server = http.createServer(async (req, res) => {
  // CORS — wide open for sandbox use
  res.setHeader('Access-Control-Allow-Origin',  '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

  if (req.method === 'OPTIONS') {
    res.writeHead(204);
    res.end();
    return;
  }

  const send = (status, body) => {
    res.writeHead(status, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(body));
  };

  try {
    // ── Liveness ──────────────────────────────────────────────────────────
    if (req.method === 'GET' && req.url === '/health') {
      return send(200, { status: 'ok' });
    }

    // ── Seed management ───────────────────────────────────────────────────
    if (req.method === 'POST' && req.url === '/reseed') {
      const authErr = await requireAdmin(req);
      if (authErr) return send(authErr.status, { success: false, error: authErr.message });
      console.log('POST /reseed — starting…');
      try {
        const logLines = await reseed();
        return send(200, { success: true, log: logLines });
      } catch (err) {
        console.error('Reseed failed:', err.message);
        return send(500, { success: false, error: err.message });
      }
    }

    // ── Onboarding ────────────────────────────────────────────────────────
    if (req.method === 'POST' && req.url === '/invites') {
      const bearerToken = bearerFrom(req);
      if (!bearerToken) return send(401, { error: 'Authorization header required' });
      const result = await handleCreateInvite(bearerToken);
      return send(result.status, result.body);
    }

    if (req.method === 'POST' && req.url === '/register') {
      const body   = await readBody(req);
      const result = await handleRegister(body);
      return send(result.status, result.body);
    }

    if (req.method === 'GET' && req.url === '/clients') {
      const bearerToken = bearerFrom(req);
      if (!bearerToken) return send(401, { error: 'Authorization header required' });
      const result = await handleListClients(bearerToken);
      return send(result.status, result.body);
    }

    if (req.method === 'POST' && req.url === '/clients') {
      const bearerToken = bearerFrom(req);
      if (!bearerToken) return send(401, { error: 'Authorization header required' });
      const body   = await readBody(req);
      const result = await handleCreateClient(body, bearerToken);
      return send(result.status, result.body);
    }

    send(404, { error: 'Not found' });
  } catch (err) {
    console.error('Admin API error:', err.message);
    send(500, { error: err.message });
  }
});

server.listen(PORT, '0.0.0.0', () => {
  console.log(`Admin API listening on :${PORT}`);
  console.log(`Keycloak:               ${KEYCLOAK_URL}/realms/${KEYCLOAK_REALM}`);
  console.log(`FHIR base:              ${FHIR_BASE}`);
  console.log(`PLACER_EXTERNAL_URL:    ${PLACER_URL}`);
  console.log(`FULFILLER_EXTERNAL_URL: ${FULFILLER_URL}`);
  console.log(`REGISTRY_EXTERNAL_URL:  ${REGISTRY_EXTERNAL_URL}`);
});
