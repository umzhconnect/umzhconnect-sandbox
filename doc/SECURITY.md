# Security Concept — UMZH-Connect COW Sandbox

## Overview

The sandbox implements a three-level security model that mirrors the production security
requirements of the UMZH-Connect federation. The level is controlled by the `AUTH_LEVEL`
environment variable.

---

## Level 1 — Client Secret Basic (Default / Sandbox)

**Method:** `client_secret_basic`

Client authenticates to Keycloak's token endpoint using a shared secret
transmitted as a Basic Authorization header.

**Configuration:**
```env
AUTH_LEVEL=1
PLACER_CLIENT_SECRET=placer-secret-change-me
FULFILLER_CLIENT_SECRET=fulfiller-secret-change-me
```

**Token flow:**
```
FastAPI Backend → POST /realms/umzh-sandbox/protocol/openid-connect/token
  Authorization: Basic base64(client_id:client_secret)
  Body: grant_type=client_credentials&scope=...
```

**Security properties:**
- Token never reaches the browser (cached server-side in FastAPI)
- JWT validated at KrakenD before passing to HAPI FHIR
- OPA enforces consent-based scope limitation

**Use for:** Local development, demos, CI testing.

---

## Level 2 — Private Key JWT (Production)

**Method:** `private_key_jwt` (RFC 7523)

Client proves identity by signing a JWT with its private key. Keycloak verifies
using the registered public key (JWKS endpoint).

**Configuration:**
```env
AUTH_LEVEL=2
```

**Setup:**
1. Generate a keypair:
   ```bash
   openssl genrsa -out placer.pem 2048
   openssl rsa -in placer.pem -pubout -out placer.pub.pem
   ```
2. Register the JWKS URI in Keycloak:
   - Keycloak Admin → Clients → `placer-client` → Credentials
   - Client Authenticator: `Signed JWT`
   - Import certificate or set JWKS URI
3. Set `AUTH_LEVEL=2` and restart backend

**Token flow:**
```
FastAPI Backend → POST /realms/umzh-sandbox/protocol/openid-connect/token
  Body: grant_type=client_credentials
        client_assertion_type=urn:ietf:params:oauth:client-assertion-type:jwt-bearer
        client_assertion=<signed-JWT>
```

**Security properties:**
- No secret transmitted — possession of private key proves identity
- Key rotation without service restart (update JWKS endpoint)
- Audit trail via `iss`/`jti` claims

**Use for:** Staging, production (UMZH network participants).

---

## Level 3 — mTLS (High-Risk / Cross-Org)

**Method:** Mutual TLS certificate authentication

Both client and server present certificates. The client certificate CN/SAN
identifies the party.

**Configuration:**
```env
AUTH_LEVEL=3
```

**Setup:**
1. Obtain certificates from the UMZH-Connect CA
2. Configure KrakenD mTLS:
   ```json
   "tls": {
     "public_key": "/certs/server.pem",
     "private_key": "/certs/server.key",
     "ca_certs": ["/certs/ca.pem"],
     "client_certs": true,
     "disable_system_ca_pool": true
   }
   ```
3. Configure Keycloak mTLS token endpoint:
   - `KC_HTTPS_CERTIFICATE_FILE` / `KC_HTTPS_CERTIFICATE_KEY_FILE`
   - Enable `X509` authenticator on clients

**Security properties:**
- Both parties mutually authenticated at transport layer
- Certificate pinning prevents MITM
- Client certificate mapped to Keycloak client via SAN/CN matching

**Use for:** Cross-organization data exchange with high-risk patient data.

---

## OPA Consent Policy

The consent-based authorization policy (`infrastructure/opa/policy.rego`) enforces:

1. **Token validity** — JWT must be present and contain `party_id` claim
2. **Scope check** — requested resource type must match token scopes
3. **Consent check** (cross-party reads) — a valid, active `Consent` resource
   must exist in partyA's FHIR store that:
   - Is `status=active`
   - References the requesting party (`partyB`) as performer
   - Includes the requested resource in its provision data

**OPA input structure:**
```json
{
  "token": {
    "client_id": "fulfiller-client",
    "party_id": "partyB",
    "scope": "system/ServiceRequest.rs system/Patient.r"
  },
  "request": {
    "method": "GET",
    "resource_type": "ServiceRequest",
    "resource_id": "sr-001",
    "consent_id": "consent-abc"
  },
  "hapi_url": "http://hapi-fhir:8080"
}
```

**Switch to Phase 2 policy enforcement:**
```json
// infrastructure/opa/data.json
{
  "phase": 2
}
```

---

## JWT Validation at KrakenD

KrakenD validates JWTs using Keycloak's JWKS endpoint:

```json
"auth/validator": {
  "alg": "RS256",
  "jwk_url": "http://keycloak:8080/realms/umzh-sandbox/protocol/openid-connect/certs",
  "issuer": "http://keycloak:8080/realms/umzh-sandbox",
  "disable_jwk_security": true
}
```

Claims propagated from JWT to backend: `party_id`, `client_id`, `scope`

---

## Trust Bundle

The backend exposes a trust bundle at `/trust-bundle` listing:
- Parties and their client IDs
- Allowed SMART on FHIR scopes per party
- Token endpoint and JWKS URI

This can be published as a well-known endpoint for federation participants.
