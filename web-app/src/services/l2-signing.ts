// =============================================================================
// L2 (private_key_jwt) signing — in-browser Web Crypto
// =============================================================================
// Shared helpers for the Level-2 client-credentials flow performed directly in
// the browser. The web-app has the demo private keys mounted at /l2-keys/ (the
// same source the rest of the sandbox uses), fetches the party's key, signs an
// RS256 client assertion, and exchanges it at Keycloak for an M2M access token.
//
// Used by:
//   * CredentialsPage — the interactive "show me the L2 flow" teaching page
//   * useM2mToken hook — cross-party data calls (reads, Task create, Task list)
//
// This is the browser-side equivalent of what tests/scripts/get-token.sh and the
// key custodian's /sign endpoint do. Cross-party FHIR calls go straight to the
// partner's external gateway with the resulting Bearer token — no internal-gateway
// proxy in between.
// =============================================================================

import type { LogEntry } from '../types/fhir';

type LogCallback = (entry: Omit<LogEntry, 'id' | 'timestamp'>) => void;

// ─── Web Crypto helpers ──────────────────────────────────────────────────────

export function base64url(buf: ArrayBuffer): string {
  return btoa(String.fromCharCode(...new Uint8Array(buf)))
    .replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '');
}

export function base64urlStr(str: string): string {
  return btoa(str).replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '');
}

export async function importPrivateKey(pem: string): Promise<CryptoKey> {
  const b64 = pem
    .replace(/-----BEGIN (?:RSA )?PRIVATE KEY-----/, '')
    .replace(/-----END (?:RSA )?PRIVATE KEY-----/, '')
    .replace(/\s/g, '');
  const der = Uint8Array.from(atob(b64), c => c.charCodeAt(0));
  return crypto.subtle.importKey(
    'pkcs8', der,
    { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
    false, ['sign'],
  );
}

export interface AssertionParts {
  header:  { typ: string; alg: string; kid?: string };
  payload: { iss: string; sub: string; aud: string; exp: number; jti: string };
  jwt:     string;
}

export async function buildClientAssertion(
  clientId: string,
  audience: string,
  key: CryptoKey,
  kid?: string,
): Promise<AssertionParts> {
  // kid links this signed assertion to a specific JWK in the JWKS that
  // Keycloak fetches from the client's jwks.url. With one key per client
  // today it's not strictly required, but it's the linkage that makes
  // overlap-window rotation work.
  const headerObj  = kid
    ? { typ: 'JWT', alg: 'RS256', kid }
    : { typ: 'JWT', alg: 'RS256' };
  const now        = Math.floor(Date.now() / 1000);
  const payloadObj = {
    iss: clientId,
    sub: clientId,
    aud: audience,
    exp: now + 60,
    jti: `${now}-${Math.random().toString(36).slice(2)}`,
  };

  const header  = base64urlStr(JSON.stringify(headerObj));
  const payload = base64urlStr(JSON.stringify(payloadObj));
  const sigInput  = `${header}.${payload}`;
  const sigBuffer = await crypto.subtle.sign(
    'RSASSA-PKCS1-v1_5', key, new TextEncoder().encode(sigInput),
  );
  return {
    header:  headerObj,
    payload: payloadObj,
    jwt:     `${sigInput}.${base64url(sigBuffer)}`,
  };
}

// ─── M2M token acquisition ───────────────────────────────────────────────────

export interface AcquireM2mTokenOptions {
  /** Keycloak token endpoint (published/frontend URL — also the assertion aud). */
  keycloakTokenUrl: string;
  /** L2 client_id, e.g. "placer-client-l2". */
  clientId: string;
  /** JWT header kid, e.g. "placer-l2". */
  kid: string;
  /** URL the private key (PEM) is served from, e.g. "/l2-keys/placer-l2.key". */
  keyUrl: string;
  /**
   * Optional FHIR reference (e.g. "ServiceRequest/abc") bound into the token as
   * RFC 9396 authorization_details — the fhirContext the partner's OPA gate
   * checks before allowing a clinical read. Omit for Task list/create, which
   * are not fhirContext-gated.
   */
  fhirContextRef?: string;
  /**
   * RFC 8707 resource indicator — the base URL of the target resource server
   * (e.g. "http://localhost:8083"). Restricts the token's aud claim to that
   * resource server only.
   */
  resource?: string;
  onLog?: LogCallback;
}

/**
 * Run the full in-browser L2 client-credentials flow and return the access token.
 * Fetch key → import → sign assertion → POST to Keycloak → access_token.
 */
export async function acquireM2mToken(opts: AcquireM2mTokenOptions): Promise<string> {
  const { keycloakTokenUrl, clientId, kid, keyUrl, fhirContextRef, resource, onLog } = opts;

  onLog?.({ type: 'request', method: 'GET', url: keyUrl, message: 'Fetch L2 private key' });
  const keyRes = await fetch(keyUrl);
  if (!keyRes.ok) throw new Error(`Failed to fetch L2 key: ${keyRes.status}`);
  const pem = await keyRes.text();
  onLog?.({ type: 'response', method: 'GET', url: keyUrl, status: keyRes.status,
    body: { note: 'RSA private key (PEM)' } });

  const key = await importPrivateKey(pem);
  const assertion = await buildClientAssertion(clientId, keycloakTokenUrl, key, kid);

  const body = new URLSearchParams({
    grant_type: 'client_credentials',
    client_id: clientId,
    client_assertion_type: 'urn:ietf:params:oauth:client-assertion-type:jwt-bearer',
    client_assertion: assertion.jwt,
  });
  if (fhirContextRef) {
    body.set('authorization_details',
      JSON.stringify([{ type: 'umzh-connect-context', identifier: fhirContextRef }]));
  }
  if (resource) {
    body.set('resource', resource);
  }

  onLog?.({
    type: 'request', method: 'POST', url: keycloakTokenUrl,
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: {
      grant_type: 'client_credentials',
      client_id: clientId,
      client_assertion_type: 'urn:ietf:params:oauth:client-assertion-type:jwt-bearer',
      client_assertion: `${assertion.jwt.slice(0, 40)}… (RS256-signed JWT)`,
      ...(fhirContextRef ? { authorization_details: `fhirContext=${fhirContextRef}` } : {}),
      ...(resource ? { resource } : {}),
    },
  });

  const res = await fetch(keycloakTokenUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body,
  });
  const data = await res.json();
  onLog?.({ type: res.ok ? 'response' : 'error', method: 'POST', url: keycloakTokenUrl,
    status: res.status, body: data });

  if (!res.ok || typeof data.access_token !== 'string') {
    throw new Error(`M2M token request failed: ${res.status}`);
  }
  return data.access_token;
}
