#!/usr/bin/env node
// =============================================================================
// UMZH Connect Sandbox – Reseed API
// =============================================================================
// POST /reseed  → expunge all FHIR partitions, then reload seed bundles.
// Intended as an internal sandbox utility; CORS is wide-open.
// =============================================================================

'use strict';

const http = require('http');
const fs   = require('fs');

const FHIR_BASE    = process.env.FHIR_BASE_URL        || 'http://hapi-fhir:8080/fhir';
const PLACER_URL   = process.env.PLACER_EXTERNAL_URL   || 'http://localhost:8081';
const FULFILLER_URL= process.env.FULFILLER_EXTERNAL_URL|| 'http://localhost:8083';
const REGISTRY_URL = process.env.REGISTRY_EXTERNAL_URL || 'http://localhost:8084';
const PORT         = 9001;

// ---------------------------------------------------------------------------
// Helper: POST JSON to HAPI FHIR (returns { status, body })
// ---------------------------------------------------------------------------
async function fhirPost(path, body) {
  const res = await fetch(`${FHIR_BASE}${path}`, {
    method : 'POST',
    headers: { 'Content-Type': 'application/fhir+json' },
    body   : JSON.stringify(body),
  });
  const text = await res.text();
  return { status: res.status, body: text };
}

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

// ---------------------------------------------------------------------------
// Helper: clear a single partition (partition-scoped, IG-safe)
// ---------------------------------------------------------------------------
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
  // Safe because expire_search_results_after_millis=0 disables the search
  // cache, so PID reassignment on recreate causes no stale-entry issues.
  const result = await fhirPost(`/${partition}/$expunge`, {
    resourceType: 'Parameters',
    parameter   : [{ name: 'expungeDeletedResources', valueBoolean: true }],
  });
  log(`  Expunge /${partition}: HTTP ${result.status}`);
}

// ---------------------------------------------------------------------------
// Helper: create a HAPI partition (ignores 409 / already-exists)
// ---------------------------------------------------------------------------
async function createPartition(id, name, desc, log) {
  const result = await fhirPost('/DEFAULT/$partition-management-create-partition', {
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

// ---------------------------------------------------------------------------
// Main reseed routine
// ---------------------------------------------------------------------------
async function reseed() {
  const lines = [];
  const log   = (msg) => { lines.push(msg); console.log(msg); };

  log('=== RESEED STARTED ===');

  // [1/6] Clear clinical partitions (IG-safe per-type delete + expunge)
  log('\n[1/6] Expunging FHIR partitions…');
  await expungePartition('placer',    log);
  await expungePartition('fulfiller', log);
  await expungePartition('registry',  log);

  // [2/6] Re-create named partitions (may already exist in the DB schema)
  log('\n[2/6] Ensuring FHIR partitions exist…');
  await createPartition(1, 'placer',    'HospitalP (Placer) partition',    log);
  await createPartition(2, 'fulfiller', 'HospitalF (Fulfiller) partition', log);
  await createPartition(3, 'registry',  'Organization registry partition', log);

  // [3/6] Load shared bundle → /fhir/DEFAULT
  log('\n[3/5] Loading shared bundle → /fhir/DEFAULT…');
  const sharedBundle = JSON.parse(fs.readFileSync('/seed/bundles/shared-bundle.json', 'utf8'));
  const sharedResult = await fhirPost('/DEFAULT', sharedBundle);
  log(`  Shared bundle: HTTP ${sharedResult.status}`);
  if (sharedResult.status !== 200 && sharedResult.status !== 201) {
    throw new Error(`Shared bundle failed: HTTP ${sharedResult.status}`);
  }

  // [4/6] Load placer bundle (URL substitution) → /fhir/placer
  log('\n[4/5] Loading placer bundle → /fhir/placer…');
  let placerStr = fs.readFileSync('/seed/bundles/placer-bundle.json', 'utf8');
  placerStr = placerStr
    .replace(/__PLACER_EXTERNAL_URL__/g,    PLACER_URL)
    .replace(/__FULFILLER_EXTERNAL_URL__/g, FULFILLER_URL)
    .replace(/__REGISTRY_URL__/g,           REGISTRY_URL);
  const placerResult = await fhirPost('/placer', JSON.parse(placerStr));
  log(`  Placer bundle: HTTP ${placerResult.status}`);
  if (placerResult.status !== 200 && placerResult.status !== 201) {
    throw new Error(`Placer bundle failed: HTTP ${placerResult.status}`);
  }

  // [5/6] Load fulfiller bundle (URL substitution) → /fhir/fulfiller
  log('\n[5/6] Loading fulfiller bundle → /fhir/fulfiller…');
  let fulfillerStr = fs.readFileSync('/seed/bundles/fulfiller-bundle.json', 'utf8');
  fulfillerStr = fulfillerStr
    .replace(/__PLACER_EXTERNAL_URL__/g,    PLACER_URL)
    .replace(/__FULFILLER_EXTERNAL_URL__/g, FULFILLER_URL)
    .replace(/__REGISTRY_URL__/g,           REGISTRY_URL);
  const fulfillerResult = await fhirPost('/fulfiller', JSON.parse(fulfillerStr));
  log(`  Fulfiller bundle: HTTP ${fulfillerResult.status}`);
  if (fulfillerResult.status !== 200 && fulfillerResult.status !== 201) {
    throw new Error(`Fulfiller bundle failed: HTTP ${fulfillerResult.status}`);
  }

  // [6/6] Load registry bundle (URL substitution) → /fhir/registry
  log('\n[6/6] Loading registry bundle → /fhir/registry…');
  let registryStr = fs.readFileSync('/seed/bundles/registry-bundle.json', 'utf8');
  registryStr = registryStr
    .replace(/__PLACER_EXTERNAL_URL__/g,    PLACER_URL)
    .replace(/__FULFILLER_EXTERNAL_URL__/g, FULFILLER_URL)
    .replace(/__REGISTRY_URL__/g,           REGISTRY_URL);
  const registryResult = await fhirPost('/registry', JSON.parse(registryStr));
  log(`  Registry bundle: HTTP ${registryResult.status}`);
  if (registryResult.status !== 200 && registryResult.status !== 201) {
    throw new Error(`Registry bundle failed: HTTP ${registryResult.status}`);
  }

  log('\n=== RESEED COMPLETE ===');
  return lines;
}

// ---------------------------------------------------------------------------
// HTTP server
// ---------------------------------------------------------------------------
const server = http.createServer(async (req, res) => {
  // CORS — wide open for sandbox use
  res.setHeader('Access-Control-Allow-Origin',  '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    res.writeHead(204);
    res.end();
    return;
  }

  if (req.method === 'POST' && req.url === '/reseed') {
    console.log('POST /reseed — starting…');
    try {
      const log = await reseed();
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ success: true, log }));
    } catch (err) {
      console.error('Reseed failed:', err.message);
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ success: false, error: err.message }));
    }
    return;
  }

  if (req.method === 'GET' && req.url === '/health') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ status: 'ok' }));
    return;
  }

  res.writeHead(404);
  res.end('Not found');
});

server.listen(PORT, '0.0.0.0', () => {
  console.log(`Reseed API listening on :${PORT}`);
  console.log(`FHIR_BASE_URL:          ${FHIR_BASE}`);
  console.log(`PLACER_EXTERNAL_URL:    ${PLACER_URL}`);
  console.log(`FULFILLER_EXTERNAL_URL: ${FULFILLER_URL}`);
  console.log(`REGISTRY_EXTERNAL_URL:  ${REGISTRY_URL}`);
});
