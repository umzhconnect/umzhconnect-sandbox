# UMZH Connect Sandbox

A reference implementation and sandbox environment for the **UMZH Connect Clinical Order Workflow** — simulating the complete collaboration between two healthcare parties (Placer & Fulfiller) using standardised FHIR R4 APIs, OAuth2/SMART on FHIR security, and consent-centric fine-grained authorisation.

Built on the [UMZH Connect FHIR Implementation Guide](https://build.fhir.org/ig/umzhconnect/umzhconnect-ig/index.html).

---

## Table of Contents

- [Architecture](#architecture)
  - [Components Overview](#components-overview)
  - [Dual-Gateway Pattern — Internal and External](#dual-gateway-pattern--internal-and-external)
  - [FHIR Server — URL-based Partitioning](#fhir-server--url-based-partitioning)
  - [nginx-proxy — Self-Link Rewriting Layer](#nginx-proxy--self-link-rewriting-layer)
  - [API Gateway Endpoint Categories](#api-gateway-endpoint-categories)
  - [Proxy Walk-Through — Placer Web-App Reads Fulfiller Data](#proxy-walk-through--placer-web-app-reads-fulfiller-data)
  - [APISIX Plugins](#apisix-plugins)
  - [Security Model](#security-model)
  - [Consent Enforcement — OPA Gate](#consent-enforcement--opa-gate)
  - [Clinical Order Workflow](#clinical-order-workflow)
- [Quick Start](#quick-start)
- [Configuration Reference](#configuration-reference)
  - [Environment Variables](#environment-variables)
  - [HAPI FHIR Server](#hapi-fhir-server)
  - [Keycloak — Authorization Server](#keycloak--authorization-server)
  - [Dynamic Consent Scope](#dynamic-consent-scope)
  - [APISIX API Gateways](#apisix-api-gateways)
  - [OPA Policy Engine](#opa-policy-engine)
  - [Seed Data](#seed-data)
  - [Web Application](#web-application)
- [Usage Guide](#usage-guide)
- [Bruno API Collection](#bruno-api-collection)
  - [Setup](#setup)
  - [Auth Mechanism — Internal vs External APIs](#auth-mechanism--internal-vs-external-apis)
  - [Collection Structure](#collection-structure)
  - [Running Requests](#running-requests)
- [Testing](#testing)
  - [Test Framework](#test-framework)
  - [Test Suite Overview](#test-suite-overview)
  - [Running the Tests](#running-the-tests)
  - [How the Runner Works](#how-the-runner-works)
  - [Reports](#reports)
- [Development](#development)
- [Project Structure](#project-structure)

---

## Architecture

### Components Overview

```
┌─────────────────────────────────────────────────────────────────────────────────┐
│                          Web Application (React SPA)                            │
│                            http://localhost:3000                                │
└──────────────────────────────────┬──────────────────────────────────────────────┘
                                   │ PKCE login (web-app client)
                                   │
              ┌────────────────────▼────────────────────────┐
              │         Keycloak (shared AuthServer)        │
              │           http://localhost:8180             │
              │   realm: umzh-connect                       │
              │   features: dynamic-scopes                  │
              └────────────────────┬───────────────────────-┘
                                   │ JWKS (RS256)
         ┌─────────────────────────┴─────────────────────────────┐
         │                                                       │
┌────────┴────────────────────────┐     ┌────────────────────────┴───────────────────┐
│    HospitalP (Placer)           │     │    HospitalF (Fulfiller)                   │
│                                 │     │                                            │
│  apisix-placer-internal  :8080  │     │  apisix-fulfiller-internal     :8082       │
│  (internal gateway)             │     │  (internal gateway)                        │
│   /fhir/*        own data only  │     │   /fhir/*        own data only             │
│                                 │     │                                            │
│  apisix-placer-external  :8081  │     │  apisix-fulfiller-external     :8083       │
│  (external gateway)             │◄───►│  (external gateway)                        │
│   /fhir/*  Fulfiller reads      │     │   /fhir/*  Placer reads                    │
│            Placer data          │     │            Fulfiller data                  │
│   /jwks.json  L2 public keys    │     │   /jwks.json  L2 public keys               │
└──────────────────┬──────────────┘     └─────────────────────┬──────────────────────┘
                   │                                          │
                   └────────────────────┬─────────────────────┘
                                        │
                              ┌─────────▼─────────┐
                              │   nginx-proxy     │
                              │  ports 80–84      │
                              │  self-link        │
                              │  rewriting +      │
                              │  registry (84)    │
                              └─────────┬─────────┘
                                        │
                              ┌─────────▼──────────┐
                              │    HAPI FHIR       │
                              │  localhost:8090    │
                              │  /fhir/placer/     │← HospitalP partition
                              │  /fhir/fulfiller/  │← HospitalF partition
                              │  /fhir/registry/   │← mCSD registry (public)
                              └─────────┬──────────┘
                                        │
                              ┌─────────▼──────────┐
                              │    PostgreSQL      │
                              │  localhost:5431    │
                              └────────────────────┘

  ┌──────────────────────┐      ┌────────────────────┐
  │  OPA — Placer        │      │  OPA — Fulfiller   │
  │  localhost:8181      │      │  localhost:8182    │
  │  package umzh.authz  │      │  package umzh.authz│
  └──────────────────────┘      └────────────────────┘
```

**Service inventory:**

| Service | Image | Host Port | Purpose |
|---------|-------|-----------|---------|
| `postgres` | `postgres:16-alpine` | 5431 | Shared DB (HAPI FHIR + Keycloak) |
| `keycloak` | `quay.io/keycloak/keycloak:25.0` | 8180 | OAuth2 / OIDC / SMART on FHIR |
| `hapi-fhir` | `hapiproject/hapi:v8.10.0-1` | 8090 | FHIR R4 server (URL-partitioned) |
| `nginx-proxy` | `nginx:alpine` | 8084 | Self-link rewriting proxy (ports 80–83); port 84 = public registry gateway |
| `opa-placer` | `openpolicyagent/opa:0.70.0` | 8181 | Policy engine for HospitalP |
| `opa-fulfiller` | `openpolicyagent/opa:0.70.0` | 8182 | Policy engine for HospitalF |
| `apisix-placer-internal` | `apache/apisix:3.9.0-debian` | 8080 | Internal API gateway for HospitalP |
| `apisix-placer-external` | `apache/apisix:3.9.0-debian` | 8081 | External API gateway for HospitalP |
| `apisix-fulfiller-internal` | `apache/apisix:3.9.0-debian` | 8082 | Internal API gateway for HospitalF |
| `apisix-fulfiller-external` | `apache/apisix:3.9.0-debian` | 8083 | External API gateway for HospitalF |
| `seed-loader` | custom | — | Init container (loads FHIR data) |
| `admin-api` | Node.js | 9000 | Admin HTTP API: reseed FHIR data + self-service user/M2M-client onboarding |
| `web-app` | Node 20 + Nginx | 3000 | React SPA |

---

### Dual-Gateway Pattern — Internal and External

Each party operates **two dedicated API gateways**: an *internal* gateway for its own web-app and an *external* gateway that the partner calls. The split enforces a clean security boundary — the external gateway is purpose-built to serve cross-party requests and always returns consistent responses regardless of who calls it.

```
                     ── HospitalP (Placer) ────────────────────────────────────────
                    │                                                              │
  Placer web-app    │  apisix-placer-internal  :8080                               │
  ─────────────────►│   /fhir/*            → own FHIR partition (nginx-proxy:80)   │
                    │   (own data only — no proxy, no orchestration)               │
                    │                                                              │
                    │  apisix-placer-external  :8081                               │
  Fulfiller calls  ►│   GET /fhir/{resource}?_id=<id>  → OPA → placer partition   │
                    │   GET /fhir/{resource}/{id}      → OPA → placer partition   │
                    │   POST /fhir/Task                → placer partition          │
                    │   GET /jwks.json                 → L2 public keys            │
                     ──────────────────────────────────────────────────────────────

                     ── HospitalF (Fulfiller) ───────────────────────────────────
                    │                                                              │
  Fulfiller web-app │  apisix-fulfiller-internal  :8082                            │
  ─────────────────►│   /fhir/*            → own FHIR partition (nginx-proxy:82)   │
                    │   (own data only — no proxy, no orchestration)               │
                    │                                                              │
                    │  apisix-fulfiller-external  :8083                            │
  Placer calls     ►│   GET  /fhir/{resource}?_id=<id>  → OPA → fulfiller partition│
                    │   GET  /fhir/{resource}/{id}      → OPA → fulfiller partition│
                    │   POST /fhir/Task                 → fulfiller partition      │
                    │   PATCH /fhir/Task/{id}           → fulfiller partition      │
                    │   GET /jwks.json                  → L2 public keys           │
                     ──────────────────────────────────────────────────────────────
```

Cross-party calls do **not** pass through the internal gateway. The web-app mints
its own M2M token (in-browser L2 client_credentials) and calls the partner's
external gateway directly — the same arrow as "Fulfiller calls ►" / "Placer calls ►"
above, originating from the *other party's web-app* rather than its internal gateway.

**Design principles:**

- **External gateways are stateless and consistent.** They always return the same self-link URLs (e.g. `http://localhost:8083/fhir/...` for fulfiller-external) regardless of which party calls them.
- **The caller authenticates itself.** Because the web-app holds the party's L2 credentials, it performs the client_credentials flow in-browser and calls the partner external gateway directly. No internal-gateway token exchange, no response rewriting — stored partner references are already absolute partner-external URLs.
- **The partner controls access to its own data.** The external gateway validates the M2M JWT and runs the OPA fhirContext consent gate on every read. The Fulfiller retains full control over who can access its data.

Both gateways share the **same Keycloak realm** and the **same HAPI FHIR instance** (via different URL partitions). In a production deployment, each gateway would typically live in its own network perimeter.

---

### FHIR Server — URL-based Partitioning

A single HAPI FHIR v8.10 instance provides three logical partitions via URL-based multi-tenancy:

| Partition | Base URL | Tenant | Auth |
|-----------|----------|--------|------|
| **Placer (HospitalP)** | `http://hapi-fhir:8080/fhir/placer/` | `placer` | JWT required |
| **Fulfiller (HospitalF)** | `http://hapi-fhir:8080/fhir/fulfiller/` | `fulfiller` | JWT required |
| **Registry** | `http://hapi-fhir:8080/fhir/registry/` | `registry` | Public (no auth) |

**Organization resources live only in the registry partition** and are referenced by absolute URL from both party partitions. The registry implements an mCSD-style directory with `Organization` and `Endpoint` resources:
- `Organization/HospitalP` — HospitalP with an `endpoint` reference to `Endpoint/EndpointHospitalP`
- `Organization/HospitalF` — HospitalF with an `endpoint` reference to `Endpoint/EndpointHospitalF`
- `Endpoint/EndpointHospitalP` — `address` = placer external gateway URL (`__PLACER_EXTERNAL_URL__/fhir`)
- `Endpoint/EndpointHospitalF` — `address` = fulfiller external gateway URL (`__FULFILLER_EXTERNAL_URL__/fhir`)

**Cross-partition references** use absolute URLs (stored verbatim by HAPI — no placeholder creation):

```
Task.owner.reference      = "http://localhost:8084/fhir/Organization/HospitalF"
Task.basedOn[0].reference = "http://localhost:8080/fhir/ServiceRequest/ReferralOrthopedicSurgery"
```

Absolute URL bases are injected at container start-up via environment variable substitution (`__PLACER_EXTERNAL_URL__`, `__FULFILLER_EXTERNAL_URL__`, `__REGISTRY_URL__`), making all gateway addresses configurable without touching the bundle files.

The registry is exposed publicly on **host port 8084** via a dedicated nginx-proxy server block (port 84) that prepends `/fhir/registry/` to incoming `/fhir/*` paths and rewrites HAPI self-links to `http://localhost:8084/fhir/...`.

---

### nginx-proxy — Self-Link Rewriting Layer

HAPI FHIR embeds its own base URL in every resource's self-link (`fullUrl`, `Bundle.link`, pagination URLs). Without rewriting, clients would always receive `http://localhost:8090/fhir/{partition}/...` self-links — internal addresses that are inaccessible outside the Docker network.

`nginx-proxy` is a single nginx container that listens on **four internal ports**, each with a dedicated `sub_filter` rewrite rule. The correct port is selected by the gateway's upstream configuration.

```
nginx-proxy internal ports
─────────────────────────────────────────────────────────────────────────────────

Ports 80–83: proxy to hapi-fhir:8080
  Each port rewrites HAPI's raw partition URL to the correct gateway URL.

  Port 80 ─ Placer internal (apisix-placer-internal :8080)
    proxy_pass: hapi-fhir:8080
    sub_filter: "http://localhost:8090/fhir/placer/"  →  "http://localhost:8080/fhir/"
    Used by: apisix-placer-internal (Category 1 — own data)

  Port 81 ─ Placer external (apisix-placer-external :8081)
    proxy_pass: hapi-fhir:8080
    sub_filter: "http://localhost:8090/fhir/placer/"  →  "http://localhost:8081/fhir/"
    Used by: apisix-placer-external (Category 2 — Fulfiller reads Placer data)

  Port 82 ─ Fulfiller internal (apisix-fulfiller-internal :8082)
    proxy_pass: hapi-fhir:8080
    sub_filter: "http://localhost:8090/fhir/fulfiller/"  →  "http://localhost:8082/fhir/"
    Used by: apisix-fulfiller-internal (Category 1 — own data)

  Port 83 ─ Fulfiller external (apisix-fulfiller-external :8083)
    proxy_pass: hapi-fhir:8080
    sub_filter: "http://localhost:8090/fhir/fulfiller/"  →  "http://localhost:8083/fhir/"
    Used by: apisix-fulfiller-external (Category 2 — Placer reads Fulfiller data)

Port 84: registry gateway — public, no auth (host port 8084)
  proxy_pass: hapi-fhir:8080
  rewrite: /fhir/*  →  /fhir/registry/*   (path prepend via nginx rewrite)
  sub_filter: "http://localhost:8090/fhir/registry/"  →  "http://localhost:8084/fhir/"
  Used by: web-app (Organization + Endpoint lookups), seed-loader (registry bundle upload)
```

Cross-party responses are **not** rewritten. The web-app calls the partner's
external gateway directly, so the partner-external self-links in the response are
already navigable by the caller — no `response-rewrite` step is involved.

**Key nginx settings** (applied to all server blocks):
```nginx
proxy_set_header  Accept-Encoding  "";  # Disable compression so sub_filter can read the body
sub_filter_once   off;                  # Replace all occurrences, not just the first
sub_filter_types  *;                    # Apply to all content types (JSON, XML, etc.)
```

---

### API Gateway Endpoint Categories

Both *internal* gateways expose the same endpoint categories. The *external* gateways each expose a purpose-built subset for cross-party access.

#### Category 1 — Internal FHIR API (internal gateways only)

Direct FHIR access for the logged-in user to manage their own party's partition.

| Endpoint | Method(s) | Backend (placer example) | Auth |
|----------|-----------|--------------------------|------|
| `/fhir/metadata` | GET | `nginx-proxy:80/fhir/placer/metadata` | None |
| `/fhir/{resource}` | GET, POST | `nginx-proxy:80/fhir/placer/{resource}` | JWT |
| `/fhir/{resource}/{id}` | GET, PUT | `nginx-proxy:80/fhir/placer/{resource}/{id}` | JWT |

#### Category 2 — External FHIR API (external gateways only)

Endpoints the **partner gateway calls** to read or write data. Each external gateway serves a fixed set of endpoints that always return self-links for its own base URL, regardless of caller.

Both read endpoints (`/fhir/{resource}` and `/fhir/{resource}/{id}`) are fhirContext-gated via OPA before the FHIR backend is called. Task write endpoints are not fhirContext-gated.

**apisix-placer-external `:8081`** — consumed by the Fulfiller to read Placer data and write Tasks:

| Endpoint | Method | Query params | Backend | Guards |
|----------|--------|-------------|---------|--------|
| `/fhir/Task` | GET | `owner`, `requester`, `status`, `_id`, `_include` | `opa-placer:8181` → `nginx-proxy:81` | `umzh-capability-guard` + `opa` |
| `/fhir/ServiceRequest` | GET | `_id` (required), `_include` | `opa-placer:8181` → `nginx-proxy:81` | `umzh-capability-guard` + `opa` |
| `/fhir/{resource}/{id}` | GET | — | `opa-placer:8181` → `nginx-proxy:81` | `umzh-capability-guard` + `opa` |
| `/fhir/Task` | POST | — | `nginx-proxy:81` | — |

**apisix-fulfiller-external `:8083`** — consumed by the Placer to read Fulfiller data and write/update Tasks:

| Endpoint | Method | Query params | Backend | Guards |
|----------|--------|-------------|---------|--------|
| `/fhir/Task` | GET | `owner`, `requester`, `status`, `_id`, `_include` | `opa-fulfiller:8181` → `nginx-proxy:83` | `umzh-capability-guard` + `opa` |
| `/fhir/ServiceRequest` | GET | `_id` (required), `_include` | `opa-fulfiller:8181` → `nginx-proxy:83` | `umzh-capability-guard` + `opa` |
| `/fhir/{resource}/{id}` | GET | — | `opa-fulfiller:8181` → `nginx-proxy:83` | `umzh-capability-guard` + `opa` |
| `/fhir/Task` | POST | — | `nginx-proxy:83` | — |
| `/fhir/Task/{id}` | PATCH | — | `opa-fulfiller:8181` → `nginx-proxy:83` | `umzh-capability-guard` (patchable fields) + `opa` |

#### Category 3 — Local diagnostic (internal gateways only)

| Endpoint | Method | Description | Backend |
|----------|--------|-------------|---------|
| `/api/policy/check` | POST | Direct OPA policy evaluation | Own OPA instance |

There is no internal-gateway proxy and no `/api/actions/*` orchestration. The
internal gateway serves only its own party's partition.

---

### Cross-Party Walk-Through — Placer Web-App Reads Fulfiller Data

Cross-party access is performed **directly by the caller** — there is no
internal-gateway proxy and no response URL rewriting. The web-app authenticates
itself with an L2 `private_key_jwt` client-credentials flow (signed in-browser
via Web Crypto using the keys at `/l2-keys/`) and calls the partner's external
gateway. The same flow is what `tests/scripts/get-token.sh` and the Kestra
workflow engine perform.

```
Placer web-app  (localhost:3000)
     │
     │  1. Fetch own L2 key            GET /l2-keys/placer-l2.key   (served by web-app)
     │  2. Sign RS256 assertion        iss=sub=placer-client-l2, aud=<keycloak token URL>, kid=placer-l2
     │  3. Exchange for M2M token      POST keycloak:8180/.../token
     │        grant_type=client_credentials, client_assertion=<JWT>,
     │        authorization_details=[{type:umzh-connect-context, identifier:ServiceRequest/<id>}]
     │        → access_token (carries the fhirContext claim)
     │
     │  4. Direct cross-party read     GET http://localhost:8083/fhir/ServiceRequest?_id=<id>&_include=…
     │        Authorization: Bearer <M2M access_token>
     ▼
┌──────────────────────────────────────────────────────────────────────────────┐
│  apisix-fulfiller-external  :8083                                             │
│   · openid-connect — RS256 JWT validation (Keycloak JWKS)                     │
│   · opa — fhirContext consent gate (apisix.rego → main.rego); 403 if denied  │
│   · proxy-rewrite — /fhir/* → /fhir/fulfiller/*  (upstream nginx-proxy:83)    │
└────────────────────────────┬─────────────────────────────────────────────────┘
                             ▼
                    nginx-proxy:83 → hapi-fhir  (self-links rewritten to :8083)
                             │  200 OK (FHIR Bundle, self-links at :8083)
                             ▼
                    Placer web-app — references already point at the partner
                    external gateway (:8083), so follow-up reads repeat the
                    same direct flow. No proxy path, no response rewriting.
```

**Security properties of this flow:**

| Property | Where enforced |
|----------|---------------|
| Caller proves its identity (L2 private_key_jwt) | Keycloak token endpoint (assertion signature vs. JWKS) |
| Fulfiller controls who can access its data | apisix-fulfiller-external (`openid-connect`) |
| Consent checked against OPA policy | apisix-fulfiller-external (`opa`, via the token's fhirContext) |

The symmetric flow for **Fulfiller web-app reading Placer data** is identical,
targeting `apisix-placer-external` (:8081) and signing with `fulfiller-client-l2`.

---

### APISIX Plugins

The gateways use a mix of built-in APISIX plugins and three custom Lua plugins.

#### Built-in plugins used

| Plugin | Phase | Used on | Purpose |
|---|---|---|---|
| `openid-connect` | access (2599) | all authenticated routes | RS256 JWT validation via Keycloak JWKS; sets `X-Access-Token` |
| `opa` | access | external gateway FHIR reads | Consent gate — calls OPA via `apisix.rego` adapter |
| `proxy-rewrite` | — | all routes | URL prefix rewriting (e.g. `/fhir/*` → `/fhir/fulfiller/*`) |
| `serverless-pre-function` | access | `/__health` | In-process health response (no upstream) |

#### Custom plugin — `umzh-role-check`

**File:** `services/apisix/plugins/umzh-role-check.lua`  
**Priority:** 2500 (after `openid-connect` at 2599)

Reads the `Authorization: Bearer <token>` header, decodes the JWT payload without re-verifying the signature (already verified by `openid-connect`), and checks that `realm_roles` contains `conf.required_role`. Returns 403 if the role is absent.

```yaml
umzh-role-check:
  required_role: "placer"   # or "fulfiller"
```

Used on all internal gateway routes. Registered via `plugins:` list in the internal gateways' `config.yaml` and volume-mounted into both internal containers.

#### M2M token acquisition

The caller — the web-app (in-browser Web Crypto, see
`web-app/src/services/l2-signing.ts`), `tests/scripts/get-token.sh`, or the
Kestra flow — signs its own L2 `private_key_jwt` assertion and exchanges it at
Keycloak directly. Clinical
reads include RFC 9396 `authorization_details` so the issued token carries the
ServiceRequest `fhirContext` the partner's OPA gate checks; Task list/create
omit it (not fhirContext-gated).

The matching JWK Set is served by each party's external APISIX gateway at
`/jwks.json` (host ports 8081/8083) — same origin as the FHIR API, the SMART
Backend Services discovery shape. The realm export points each L2 client's
`jwks.url` attribute at the external gateway, and Keycloak fetches it to verify
the assertion.

#### Custom plugin — `umzh-capability-guard`

**File:** `services/apisix/plugins/umzh-capability-guard.lua`  
**Priority:** 2400 (after `openid-connect` at 2599, before `opa` at 2001)

Deny-by-default allowlist for FHIR query parameters, `_include` values, and JSON-Patch fields on external gateway routes, enforcing the static API contract from the IG CapabilityStatement at the edge. A request passes only if:

- every name in `require` is present (e.g. `_id` for ServiceRequest search)
- `_id` (when allowed) is single-valued — no comma-OR, no repeats
- `_include` values are in `allow_includes` — rejects `*`, `:iterate`, and any non-enumerated include
- every other query key's base name is in `allow_params` — no `:modifier`, no `.chain`
- on PATCH routes: every JSON-Patch op's `path` (and `from`) root is in `patchable_fields`

Violations return **400 + OperationOutcome** (FHIR `handling=strict` behaviour). `_revinclude`, `_has`, `_filter`, `_query`, modifiers, chained params, and generic control params (`_format`, `_count`, …) are all blocked by not being in the allowlist.

```yaml
umzh-capability-guard:
  require: ["_id"]           # optional: params that MUST be present
  allow_params: ["_id"]      # params that MAY be present
  allow_includes:
    - "ServiceRequest:patient"
    - "ServiceRequest:ch-umzhconnectig-servicerequest-supportinginfo"
  patchable_fields: ["input", "owner", "focus", "businessStatus"]  # PATCH only
```

Used on all external gateway FHIR routes. Registered in the external gateways' `config.yaml` and volume-mounted into both external containers. The allowlists are sourced from the IG [CapabilityStatement](https://build.fhir.org/ig/umzhconnect/umzhconnect-ig/CapabilityStatement-ChUmzhConnectCapabilityStatement.html).

#### OPA adapter — `apisix.rego`

**File:** `services/opa/policies/apisix.rego`  
**Package:** `umzh.authz.apisix`

The built-in `opa` plugin sends its own input shape (`input.request.headers`, `input.request.path`, etc.). The adapter maps this to `main.rego`'s expected shape using `with input as`:

```rego
package umzh.authz.apisix
import data.umzh.authz

allow if {
    authz.allow with input as mapped_input
}
```

Per-party values (`fhir_base`, `required_role`) come from OPA data documents mounted as `/config.json` in each OPA container (`services/opa/config-placer.json` / `config-fulfiller.json`).

**Non-obvious detail:** APISIX's `core.request.headers(ctx)` is snapshot-cached before `openid-connect` runs, so `X-Access-Token` is invisible to the opa plugin. The adapter reads from `input.request.headers["authorization"]` (the original Bearer token, always present and already validated).

---

### Security Model

The sandbox implements both client authentication levels of the IG's staged model:

| Level | Method | Status | Use Case |
|-------|--------|--------|----------|
| **Level 1** | `client_secret` — shared secret | ✅ Active | Sandbox, PoC, early pilots |
| **Level 2** | `private_key_jwt` — asymmetric keys | ✅ Active | Production baseline |
| Level 3 | mTLS — mutual TLS | Planned | Highest-risk scopes, regulated workflows |

Both L1 and L2 issue structurally identical tokens. The only difference is how the client authenticates to Keycloak's token endpoint. Run tests under L2 with `./tests/scripts/run-tests.sh -l2`.

**Token flow for a cross-party request (placer reads fulfiller data):**

```
1. Browser signs an L2 assertion in-browser (Web Crypto, key from /l2-keys/)
2. Browser → Keycloak  (client_credentials, client_assertion=<JWT>,
                        authorization_details=[{type:umzh-connect-context,
                                                identifier:ServiceRequest/<id>}])
3. Keycloak → Browser  (M2M JWT with organization_reference, scope, fhirContext)
4. Browser → apisix-fulfiller-external  (Bearer <M2M>)   ← direct, no proxy
5. apisix-fulfiller-external: openid-connect validates the JWT (Keycloak JWKS)
6. apisix-fulfiller-external: opa plugin enforces the fhirContext consent policy
7. apisix-fulfiller-external → nginx-proxy:83 → hapi-fhir (fulfiller partition)
8. nginx-proxy:83 rewrites HAPI self-links → apisix-fulfiller-external base URL
9. Browser receives the Bundle; references already point at :8083, so any
   follow-up read repeats the same direct flow
```

**JWT claims used by OPA (read from the `Authorization` header):**

| JWT Claim | Purpose |
|-----------|---------|
| `extensions.umzhconnect.organization_reference` | Caller's registry URL — exact-matched against `Consent.provision.actor.reference` |
| `scope` | SMART resource-level permissions (`system/<Resource>.<perms>`) — RFC 9068 standard claim |
| `fhirContext` | Array of `{reference}` objects — identifies the ServiceRequest workflow context |

**SMART on FHIR system scopes** embedded in M2M tokens:

| Scope | Permission |
|-------|-----------|
| `system/Patient.r` | Read patient demographics |
| `system/Task.cru` | Create, read, update Tasks |
| `system/ServiceRequest.rs` | Read and search ServiceRequests |
| `system/Condition.r` | Read conditions |
| `system/MedicationStatement.r` | Read medication statements |
| `system/AllergyIntolerance.r` | Read allergies |
| `system/Coverage.r` | Read coverage |
| `system/Observation.r` | Read observations |
| `system/Procedure.r` | Read procedures |
| `system/Immunization.r` | Read immunisations |
| `system/DiagnosticReport.r` | Read diagnostic reports |
| `system/QuestionnaireResponse.cru` | Create, read, update QuestionnaireResponses |

---

### Consent Enforcement — OPA Gate

Both external gateway read endpoints enforce two layers before the FHIR backend is called:

1. **`umzh-capability-guard`** (priority 2400) — deny-by-default allowlist of query params and `_include` values; invalid or unsupported parameters → **400**.
2. **`opa` plugin** (priority 2001) — consent / fhirContext-graph authorization; unauthorized resource → **403**.

| Endpoint | Query constraint | Guards |
|---|---|---|
| `GET /fhir/Task` | `owner/requester/status/_id/_include` enumerated | `umzh-capability-guard` → `opa` |
| `GET /fhir/ServiceRequest` | `_id` required, `_include` enumerated | `umzh-capability-guard` → `opa` |
| `GET /fhir/{resource}/{id}` | no query params | `umzh-capability-guard` → `opa` |

#### Architecture

```
Client
  │  GET /fhir/Condition/SuspectedACLRupture
  │  Authorization: Bearer <JWT with fhirContext = ServiceRequest/ReferralOrthopedicSurgery>
  ▼
apisix-*-external
  │
  ├─── openid-connect ── validates JWT, sets X-Access-Token
  │
  ├─── umzh-capability-guard ── allowlist check (params + _include)
  │    • disallowed param / _include → HTTP 400 immediately
  │
  ├─── opa plugin ─────────────────────────────────────────────────────────┐
  │    POST /v1/data/umzh/authz/allow                                       │
  │    Input built by apisix.rego adapter from request headers + path       │
  │    Returns: { "result": true } or { "result": false }                   │
  │    • allow == false → HTTP 403 returned to client immediately           │
  │    • allow == true  → continue to proxy-rewrite + upstream              │
  │                                                                          │
  └─── proxy-rewrite + upstream (nginx-proxy:8x → HAPI FHIR) ────────────▶│
       GET /fhir/{party}/Condition/SuspectedACLRupture                      │
       Returns FHIR resource to client ────────────────────────────────────-┘
```

#### JWT claims → OPA

The `openid-connect` plugin sets `X-Access-Token` from the validated JWT. The `apisix.rego` adapter reads JWT claims from `input.request.headers["authorization"]` (the original Bearer token — `X-Access-Token` is snapshot-cached before openid-connect runs and is not available to the opa plugin's input builder).

OPA receives the full OPA input shape (method, path, resource_type, resource_id, token claims, fhir_base) assembled by the adapter from APISIX request context.

#### OPA Package-Level Query

The gateway queries the package-level endpoint (`POST /v1/data/umzh/authz`) rather than the rule-level boolean endpoint (`/v1/data/umzh/authz/allow`). This returns all top-level rule values in a single response body:

```json
{
  "result": {
    "allow":       true,
    "http_status": 200,
    "decision":    { "allow": true, "consent_id": "...", "reason": "..." }
  }
}
```

Note that OPA's own REST API always returns HTTP 200 for a successful evaluation regardless of the `http_status` rule value — the numeric field is purely a convention for callers that need a numeric status (e.g. the older `policy/check` passthrough). The APISIX `opa` plugin uses the boolean `allow` field directly.

#### Bruno Policy Requests

`requests/policies/` contains five ready-to-run OPA queries demonstrating all policy scenarios. Each request uses `{{opaPlacerUrl}}` (default: `http://localhost:8181`):

| File | OPA Endpoint | Scenario |
|------|-------------|---------|
| `01-allow-granted.bru` | `/v1/data/umzh/authz/allow` | Resource in consent graph → `{ "result": true }` |
| `02-allow-denied.bru` | `/v1/data/umzh/authz/allow` | Resource NOT in consent graph → `{ "result": false }` |
| `03-full-decision.bru` | `/v1/data/umzh/authz/decision` | Full decision object with human-readable `reason` |
| `04-package-eval.bru` | `/v1/data/umzh/authz` | Package-level query — same endpoint the gateway uses |
| `05-task-no-consent.bru` | `/v1/data/umzh/authz/decision` | Task resource — Rule 1, no consent check required |

---

### Clinical Order Workflow

The sandbox follows the **Task at Fulfiller** model from the UMZH Connect IG:

```
Phase 1 — Referral
  Placer creates: ServiceRequest + Consent + Task (owner: Fulfiller)
  Task status: ready

Phase 2 — Data Fetch
  Fulfiller reads Task, fetches clinical data directly from Placer's external
  gateway (apisix-placer-external :8081) with an in-browser M2M token
  Resources: Patient, Conditions, Medications, Documents, Imaging

Phase 3 — Information Request
  Fulfiller creates Questionnaire, flips Task owner to Placer
  Task status: in-progress

Phase 4 — Response
  Placer completes QuestionnaireResponse, flips Task owner back to Fulfiller

Phase 5 — Completion
  Fulfiller creates outputs (report, appointment)
  Task status: completed
```

---

## Quick Start

### Prerequisites

- [Docker](https://docs.docker.com/get-docker/) and Docker Compose v2+
- At least 4 GB RAM available for Docker

### Build and Run

```bash
# Clone the repository and navigate to it
cd Sandbox

# Start all services
docker compose up -d --build

# Wait ~90 seconds for all health checks to pass.
# The seed-loader runs once on first start and populates FHIR data.
```

### Open the App

1. Open http://localhost:3000
2. Log in as `placer-user` / `placer123` (see [Default Credentials](#default-credentials) below)
3. You start in the **Placer** role — the patient list shows
   PetraMeier and her referrals. Switch role (Placer/Fulfiller/Registry)
   from the header.

The app requires login (Keycloak PKCE) — without it the patient list is
empty even though the FHIR data is loaded.

### Verify Services

| Service | URL | Check |
|---------|-----|-------|
| Web App | http://localhost:3000 | React SPA login |
| HAPI FHIR | http://localhost:8090/fhir/placer/metadata | CapabilityStatement JSON |
| Keycloak | http://localhost:8180 | Admin console |
| APISIX Placer (internal) | http://localhost:8080/__health | `{"status":"ok"}` |
| APISIX Placer (external) | http://localhost:8081/__health | `{"status":"ok"}` |
| APISIX Fulfiller (internal) | http://localhost:8082/__health | `{"status":"ok"}` |
| APISIX Fulfiller (external) | http://localhost:8083/__health | `{"status":"ok"}` |
| Registry | http://localhost:8084/fhir/Organization/HospitalP | Organization JSON |
| OPA Placer | http://localhost:8181/v1/health | `{"status":"ok"}` |
| OPA Fulfiller | http://localhost:8182/v1/health | `{"status":"ok"}` |

### Default Credentials

**Web App Users:**

| Username | Password | Role |
|----------|----------|------|
| `placer-user` | `placer123` | Placer (Dr. Hans Muster @ HospitalP) |
| `fulfiller-user` | `fulfiller123` | Fulfiller (Anna Schmidt @ HospitalF) |
| `admin-user` | `admin123` | Admin (all roles) |

**M2M Clients — Level 1 (shared secret):**

| Client ID | Secret | Party | `tenant` |
|-----------|--------|-------|---------|
| `placer-client` | `placer-secret-2025` | HospitalP | `placer` |
| `fulfiller-client` | `fulfiller-secret-2025` | HospitalF | `fulfiller` |

**M2M Clients — Level 2 (private_key_jwt):**

| Client ID | Private key (committed) | JWKS URL Keycloak fetches | Party | `tenant` |
|-----------|-------------------------|---------------------------|-------|---------|
| `placer-client-l2` | `services/keys/placer-l2.key` | `http://localhost:8081/jwks.json` | HospitalP | `placer` |
| `fulfiller-client-l2` | `services/keys/fulfiller-l2.key` | `http://localhost:8083/jwks.json` | HospitalF | `fulfiller` |

The demo keys are committed to the repo on purpose — same posture as the L1 secrets above, never use in production. See `services/keys/README.md`.

**Keycloak Admin:** `admin` / `admin` at http://localhost:8180/admin

### Tear Down

```bash
# Stop services (data preserved)
docker compose down

# Stop and wipe all volumes (clean slate)
docker compose down -v
```

---

## Configuration Reference

### Environment Variables

All configuration lives in `.env` at the project root:

```ini
# PostgreSQL
POSTGRES_USER=umzh
POSTGRES_PASSWORD=umzh_sandbox_2025
POSTGRES_DB=hapi_fhir

# HAPI FHIR
HAPI_FHIR_PORT=8090

# Keycloak
KEYCLOAK_ADMIN=admin
KEYCLOAK_ADMIN_PASSWORD=admin
KEYCLOAK_PORT=8180
KEYCLOAK_REALM=umzh-connect

# OAuth Clients — Level 1 (shared secret)
PLACER_CLIENT_ID=placer-client
PLACER_CLIENT_SECRET=placer-secret-2025
FULFILLER_CLIENT_ID=fulfiller-client
FULFILLER_CLIENT_SECRET=fulfiller-secret-2025

# OAuth Clients — Level 2 (private_key_jwt; demo keys committed under services/keys/)
PLACER_L2_CLIENT_ID=placer-client-l2
FULFILLER_L2_CLIENT_ID=fulfiller-client-l2

# APISIX — two gateways per party (internal + external)
APISIX_PLACER_PORT=8080
APISIX_PLACER_EXTERNAL_PORT=8081      # also serves /jwks.json for placer-client-l2
APISIX_FULFILLER_PORT=8082
APISIX_FULFILLER_EXTERNAL_PORT=8083   # also serves /jwks.json for fulfiller-client-l2

# Registry — public mCSD directory (nginx-proxy port 84)
REGISTRY_PORT=8084

# OPA — one instance per party
OPA_PLACER_PORT=8181
OPA_FULFILLER_PORT=8182

# Web App
WEB_APP_PORT=3000
VITE_KEYCLOAK_URL=http://localhost:8180
VITE_KEYCLOAK_REALM=umzh-connect
VITE_KEYCLOAK_CLIENT_ID=web-app
VITE_PLACER_URL=http://localhost:8080
VITE_PLACER_EXTERNAL_URL=http://localhost:8081
VITE_FULFILLER_URL=http://localhost:8082
VITE_FULFILLER_EXTERNAL_URL=http://localhost:8083
VITE_REGISTRY_URL=http://localhost:8084
```

---

### HAPI FHIR Server

**Config:** `services/hapi-fhir/application.yaml`

| Setting | Value |
|---------|-------|
| FHIR version | R4 |
| Multi-tenancy | URL-based (`/fhir/{tenant}/Resource`) |
| Partitions | `placer`, `fulfiller`, `registry` |
| Cross-partition references | Disabled |
| External (absolute) references | Allowed |
| Default encoding | JSON |
| Validation | Disabled (sandbox flexibility) |
| `autoCreatePlaceholderReferenceTargets` | Enabled |
| Database | PostgreSQL via `postgres` service |

**Direct FHIR access (bypasses gateways):**

```bash
# Placer partition
curl http://localhost:8090/fhir/placer/Patient/PetraMeier

# Fulfiller partition
curl http://localhost:8090/fhir/fulfiller/Task
```

---

### Keycloak — Authorization Server

**Config:** `services/keycloak/realm-export.json`
**Realm:** `umzh-connect`
**Feature flags:** `--features=dynamic-scopes` (enabled in `docker-compose.yml`)

#### Clients

| Client | Type | Auth method | Purpose |
|--------|------|-------------|---------|
| `web-app` | Public | Authorization Code + PKCE | React SPA browser login |
| `placer-client` | Confidential | `client_secret` (L1) | HospitalP M2M — pilot/sandbox |
| `fulfiller-client` | Confidential | `client_secret` (L1) | HospitalF M2M — pilot/sandbox |
| `placer-client-l2` | Confidential | `private_key_jwt` (L2) | HospitalP M2M — production baseline |
| `fulfiller-client-l2` | Confidential | `private_key_jwt` (L2) | HospitalF M2M — production baseline |

L2 client keys are RSA-2048, committed to the repo at `services/keys/` (see `services/keys/README.md` for the trust model — these are demo keys, never use in production). Each client's matching JWK Set is published by the party's external APISIX gateway at `/jwks.json` (host ports 8081 for placer, 8083 for fulfiller) — same origin as the FHIR API, matching the SMART Backend Services discovery shape. The realm export points each L2 client's `jwks.url` attribute at the external gateway, and Keycloak fetches the JWKS to verify every `private_key_jwt` client assertion. No admin-API provisioning step required.

Under the hood, the external gateway proxies `/jwks.json` to a small static-file server (an internal nginx-proxy server block on port 85/86) that reads `services/keys/<party>-l2.jwks.json`. That keeps the keys directory mount off the public-facing gateway container — APISIX never touches the file, it just routes the request.

#### Hardcoded Token Claims (M2M Clients)

Every M2M token (L1 and L2) includes the following hardcoded claims — identical across both levels:

| Claim | HospitalP clients | HospitalF clients | Purpose |
|-------|------------------|-------------------|---------|
| `extensions.umzhconnect.organization_reference` | `http://localhost:8084/fhir/Organization/HospitalP` | `http://localhost:8084/fhir/Organization/HospitalF` | Caller-org registry URL — enforced by OPA consent check |
| `tenant` | `placer` | `fulfiller` | FHIR partition routing |
| `scope` | `system/Task.cru system/Patient.r ...` | `system/Task.cru system/Patient.r ...` | SMART system scopes (RFC 9068 standard claim) |

#### Client Scopes

SMART `system/<Resource>.<perms>` scopes (Task.cru, Patient.r, ServiceRequest.r/.rs, Condition.r, Observation.r, …) are assigned as **default** scopes per M2M client and bundled into every issued token. They are the substrate read by OPA's `has_smart_scope` check (`services/opa/policies/main.rego`).

| Scope Name | Type | Description |
|------------|------|-------------|
| **`consent`** | **Dynamic** | **Parameterised consent scope (see below)** |

---

### Dynamic Consent Scope

The `consent` client scope enables **per-request consent context** to be embedded in the JWT, enabling fine-grained authorisation at the remote API gateway without a separate consent ID header.

#### How It Works

1. The client requests a token with `scope=openid consent:<consentId>`
2. Keycloak matches the `consent:(.*)` dynamic scope regexp and grants it
3. The resulting JWT's `scope` claim carries the full parameterised value:

```json
{
  "scope": "openid consent:ConsentOrthopedicReferral",
  "extensions": {
    "umzhconnect": {
      "organization_reference": "http://localhost:8084/fhir/Organization/HospitalP"
    }
  },
  "scope": "system/Task.cru system/Patient.r ...",
  "tenant": "placer"
}
```

4. APISIX's `openid-connect` plugin sets `X-Access-Token` from the validated JWT
5. The `apisix.rego` adapter reads `scope` from the JWT and OPA extracts the consent ID for policy enforcement

#### Token Request

```bash
# Without consent context (bare M2M token)
curl -X POST http://localhost:8180/realms/umzh-connect/protocol/openid-connect/token \
  -H "Content-Type: application/x-www-form-urlencoded" \
  -d "grant_type=client_credentials" \
  -d "client_id=placer-client" \
  -d "client_secret=placer-secret-2025" \
  -d "scope=openid"

# With consent context (adds consent_id to JWT scope claim)
curl -X POST http://localhost:8180/realms/umzh-connect/protocol/openid-connect/token \
  -H "Content-Type: application/x-www-form-urlencoded" \
  -d "grant_type=client_credentials" \
  -d "client_id=placer-client" \
  -d "client_secret=placer-secret-2025" \
  -d "scope=openid consent:ConsentOrthopedicReferral"
```

#### Scope Configuration in `realm-export.json`

```json
{
  "name": "consent",
  "description": "Dynamic consent scope — parameterized as consent:<consentId>.",
  "protocol": "openid-connect",
  "attributes": {
    "is.dynamic.scope": "true",
    "dynamic.scope.regexp": "consent:(.*)"
  }
}
```

> **Note on Keycloak 25:** The dedicated `oidc-allowed-dynamic-scope-mapper` is not yet available in Keycloak 25's experimental dynamic-scopes implementation. The consent ID is therefore carried in the standard `scope` JWT claim rather than as a standalone `consent_id` claim. OPA extracts it from the scope string using Rego string operations. This is standards-compliant OAuth2 dynamic scope semantics.

#### Web UI

In the **Credentials tab**, enter an optional Consent ID before requesting a token. The UI shows the scope string that will be sent and highlights the JWT `scope` claim in the decoded response.

---

### APISIX API Gateways

**Configs:** All four instances share two template files under `services/apisix/`:
- `internal/apisix.yaml` — shared route + plugin config template for internal gateways; `PARTY`, `PARTNER`, `NGINX_OWN_PORT`, `PARTNER_EXTERNAL_URL`, `OWN_URL` substituted at container start
- `external/apisix.yaml` — shared route + plugin config template for external gateways; `PARTY`, `NGINX_OWN_PORT` substituted at container start
- `internal/config.yaml` — global APISIX config for internal gateways (plugin list; whitelists `CLIENT_ID`/`CLIENT_SECRET` env vars via `main_configuration_snippet`)
- `external/config.yaml` — global APISIX config for external gateways (plugin list)
- `entrypoint.sh` — shared across all four gateways; substitutes template variables then starts APISIX
- `plugins/umzh-role-check.lua` — custom role-check plugin (mounted only in internal gateways)

> **Network addressing:** All inter-service communication uses Docker Compose service names (e.g. `keycloak:8080`, `apisix-fulfiller-external:9080`) rather than `localhost` ports. Inside a Docker container `localhost` refers to the container itself, not the host machine.

> **Keycloak back-channel:** Keycloak's `KC_HOSTNAME` is `http://localhost:8180` (browser-facing). `KC_HOSTNAME_BACKCHANNEL_DYNAMIC=true` is set on the Keycloak service so that server-side back-channel requests (e.g. JWKS fetches from APISIX) receive discovery documents with URLs resolved from the incoming `Host` header (`keycloak:8080`) rather than the browser-facing hostname. This makes JWKS validation work inside Docker without any nginx workaround.

All four gateways use the same `openid-connect` plugin config pattern:

```yaml
openid-connect:
  discovery: "http://keycloak:8080/realms/umzh-connect/.well-known/openid-configuration"
  bearer_only: true
  use_jwks: true
  set_access_token_header: true
  set_userinfo_header: false
  client_id: "unused"
  client_secret: "unused"
```

#### Full Endpoint Reference — Placer Internal Gateway (`:8080`)

| Category | Endpoint | Method | Upstream | Rewritten path | Auth |
|----------|----------|--------|----------|---------------|------|
| Metadata | `/fhir/metadata` | GET | `nginx-proxy:80` | `/fhir/placer/metadata` | None |
| 1 – Internal | `/fhir/*` | GET, POST, PUT, PATCH, DELETE | `nginx-proxy:80` | `/fhir/placer/*` | JWT + role |
| 2 – Policy | `/api/policy/check` | POST | `opa-placer:8181` | `/v1/data/umzh/authz/allow` | None |

#### Full Endpoint Reference — Placer External Gateway (`:8081`)

| Endpoint | Method | Query params | Upstream | Rewritten path | Auth |
|----------|--------|-------------|----------|---------------|------|
| `/fhir/*` (read by id) | GET | — | `nginx-proxy:81` | `/fhir/placer/*` | JWT + OPA |
| `/fhir/*` (search) | GET | `_id` required | `nginx-proxy:81` | `/fhir/placer/*` | JWT + OPA |
| `/fhir/Task` | POST | — | `nginx-proxy:81` | `/fhir/placer/Task` | JWT |

#### Full Endpoint Reference — Fulfiller Internal Gateway (`:8082`)

| Category | Endpoint | Method | Upstream | Rewritten path | Auth |
|----------|----------|--------|----------|---------------|------|
| Metadata | `/fhir/metadata` | GET | `nginx-proxy:82` | `/fhir/fulfiller/metadata` | None |
| 1 – Internal | `/fhir/*` | GET, POST, PUT, PATCH, DELETE | `nginx-proxy:82` | `/fhir/fulfiller/*` | JWT + role |
| 2 – Policy | `/api/policy/check` | POST | `opa-fulfiller:8181` | `/v1/data/umzh/authz/allow` | None |

#### Full Endpoint Reference — Fulfiller External Gateway (`:8083`)

| Endpoint | Method | Query params | Upstream | Rewritten path | Auth |
|----------|--------|-------------|----------|---------------|------|
| `/fhir/*` (read by id) | GET | — | `nginx-proxy:83` | `/fhir/fulfiller/*` | JWT + OPA |
| `/fhir/*` (search) | GET | `_id` required | `nginx-proxy:83` | `/fhir/fulfiller/*` | JWT + OPA |
| `/fhir/Task` | POST | — | `nginx-proxy:83` | `/fhir/fulfiller/Task` | JWT |
| `/fhir/Task/*` | PATCH | — | `nginx-proxy:83` | `/fhir/fulfiller/Task/*` | JWT |

---

### OPA Policy Engine

**Policy files:** `services/opa/policies/main.rego`
**Package:** `umzh.authz`
**OPA version:** 0.70.0 (Rego v1 syntax with `import rego.v1`)

Each party has its own OPA instance (opa-placer, opa-fulfiller) loaded with the same policy. The policy enforces consent-centric access control by evaluating:
> *"Is the requesting party associated to an active consent, and is the requested resource part of the ServiceRequest graph that consent references?"*

Resource scope is derived dynamically: OPA follows `Consent.sourceReference` to fetch the ServiceRequest and collects all resources referenced by its `subject`, `requester`, `reasonReference`, `supportingInfo`, and `insurance` fields. `Consent.provision.data` is not used; the ServiceRequest graph is the single source of truth for what a given consent covers.

#### Input Schema

The policy expects a JSON input document sent by the gateway or client:

```json
{
  "method":        "GET",
  "path":          "/fhir/Patient/PetraMeier",
  "resource_type": "Patient",
  "resource_id":   "PetraMeier",
  "token": {
    "organization_reference": "http://localhost:8084/fhir/Organization/HospitalF",
    "scope":                  "system/Patient.r system/Task.cru ...",
    "fhir_context":           [{"reference": "ServiceRequest/ReferralOrthopedicSurgery"}]
  },
  "fhir_base":  "http://nginx-proxy:81/fhir/placer"
}
```

#### Authorization Rules

| Rule | Condition | Notes |
|------|-----------|-------|
| **1 – Task** | `resource_type == "Task"` + SMART scope | Owner-based, no consent check |
| **2 – QuestionnaireResponse** | `resource_type == "QuestionnaireResponse"` + SMART scope | No consent check |
| **3 – Questionnaire read** | `resource_type == "Questionnaire"` + GET + SMART scope | No consent check |
| **4 – Clinical resource read** | GET + SMART scope + `valid_consent` + `resource_in_consent_scope` | Consent active + resource in SR graph |
| **5 – Metadata** | `path == "/fhir/metadata"` | Always allowed |
| **6 – Directory** | GET + `Organization \| Practitioner \| PractitionerRole` + SMART scope | No consent check |

#### Consent and ServiceRequest Resolution

The policy resolves scope in two sequential HTTP fetches, both cached by OPA for the lifetime of the process:

**1. Resolve consent ID** (`effective_consent_id`):
- Priority 1: `input.consent_id` if non-empty (legacy explicit override, currently always `""` from the gateway)
- Priority 2: extract the `consent:<id>` dynamic scope from the JWT `scope` claim

**2. Fetch Consent from HAPI** using `input.fhir_base + "/Consent/" + effective_consent_id`. If unreachable or not HTTP 200, all rules that depend on `valid_consent` fail → deny.

**3. Fetch ServiceRequest from HAPI** via `Consent.sourceReference.reference`. Collects references from:

| SR field | Cardinality | Example |
|---|---|---|
| `subject` | single | `Patient/PetraMeier` |
| `requester` | single | `PractitionerRole/HansMusterRole` |
| `reasonReference` | array | `Condition/SuspectedACLRupture` |
| `supportingInfo` | array | `MedicationStatement/MedicationEntresto` |
| `insurance` | array | `Coverage/CoverageMeier` |
| *(SR itself)* | — | `ServiceRequest/ReferralOrthopedicSurgery` |

`SR.performer` is intentionally excluded — the receiving organisation is a directory resource already accessible via Rule 6. `Consent.provision.data` is not consulted; the SR graph is the sole source of scope.

`resource_in_consent_scope` checks whether `{resource_type}/{resource_id}` matches the tail of any collected reference, using `endswith` to handle both relative (`Patient/X`) and absolute URL references.

#### OPA Endpoints

Both OPA instances expose the same HTTP API on their respective ports (8181/8182):

| Endpoint | Returns | Use case |
|----------|---------|----------|
| `POST /v1/data/umzh/authz/allow` | `{ "result": true \| false }` | **Used by APISIX `opa` plugin** (external gateway) and internal `/api/policy/check` |
| `POST /v1/data/umzh/authz` | All rule values incl. `http_status` | Package-level query — debug/audit use |
| `POST /v1/data/umzh/authz/decision` | Full decision object with `reason` | Debug, audit, explicit policy check |
| `GET /v1/health` | `{ "status": "ok" }` | Health check |

#### Example Policy Calls

```bash
# Direct OPA evaluation — access granted (fhirContext + organization_reference match consent)
curl -s -X POST http://localhost:8182/v1/data/umzh/authz/decision \
  -H "Content-Type: application/json" \
  -d '{
    "input": {
      "method": "GET",
      "resource_type": "Patient",
      "resource_id": "PetraMeier",
      "token": {
        "organization_reference": "http://localhost:8084/fhir/Organization/HospitalF",
        "scope": "system/Patient.r system/Task.cru",
        "fhir_context": [{"reference": "ServiceRequest/ReferralOrthopedicSurgery"}]
      },
      "fhir_base": "http://localhost:8090/fhir/placer"
    }
  }' | jq '.result'
# → { "allow": true, "reason": "Resource access granted via valid consent" }
```

> **Note:** The gateway's `/api/policy/check` proxies to `/v1/data/umzh/authz/allow` (the boolean endpoint). For the full `decision` object, call OPA directly on ports 8181/8182.

---

### Seed Data

**Loader:** `services/seed/` (Docker init container)

The seed loader has one responsibility: waits for HAPI, creates partitions (`placer`, `fulfiller`, `registry`), POSTs transaction bundles with placeholder substitution.

L2 (`private_key_jwt`) keys are not provisioned at runtime — they're committed to the repo at `services/keys/` and exposed by Keycloak's `jwks.url` mechanism. See [Hospital Identity](#hospital-identity-clients-roles-users) and `services/keys/README.md`.

Before posting bundles, `seed.sh` substitutes template placeholders with environment variable values:

| Placeholder | Variable | Default |
|-------------|----------|---------|
| `__PLACER_EXTERNAL_URL__` | `PLACER_EXTERNAL_URL` | `http://localhost:8081` |
| `__FULFILLER_EXTERNAL_URL__` | `FULFILLER_EXTERNAL_URL` | `http://localhost:8083` |
| `__REGISTRY_URL__` | `REGISTRY_EXTERNAL_URL` | `http://localhost:8084` |

#### Registry Partition — mCSD Directory (public)

4 resources providing the mCSD-based organization directory:

| Resource Type | ID | Key Fields |
|---------------|----|------------|
| Organization | `HospitalP` | `alias: ["HospitalP"]`, `endpoint → EndpointHospitalP` |
| Organization | `HospitalF` | `alias: ["HospitalF"]`, `endpoint → EndpointHospitalF` |
| Endpoint | `EndpointHospitalP` | `address: __PLACER_EXTERNAL_URL__/fhir`, `connectionType: hl7-fhir-rest` |
| Endpoint | `EndpointHospitalF` | `address: __FULFILLER_EXTERNAL_URL__/fhir`, `connectionType: hl7-fhir-rest` |

The web-app fetches `Organization?_include=Organization:endpoint` from the registry (no auth) to discover both organizations and their external gateway URLs in a single request.

#### Placer Partition — HospitalP

17 resources covering two referral use cases (Organization resources are in the registry, not here):

| Resource Type | ID / Description |
|---------------|-----------------|
| Patient | PetraMeier (F, 1992-03-26, Zürich) |
| Practitioner | Dr. med. Hans Muster |
| PractitionerRole | HansMusterRole |
| Condition | SuspectedACLRupture, HeartFailureHFrEF, SarcomaKnee |
| MedicationStatement | Entresto 200mg, Concor 10mg |
| Coverage | CoverageMeier (Krankenkasse AG) |
| AllergyIntolerance | AllergyGado (Gadolinium contrast) |
| DocumentReference | Cardiology attachment PDF |
| ImagingStudy | CT knee, PET whole-body |
| ServiceRequest | ReferralOrthopedicSurgery, ReferralTumorboard |
| Consent | ConsentOrthopedicReferral, ConsentTumorboardReferral |

All cross-party references (e.g. `ServiceRequest.performer`, `Consent.organization`) point to absolute registry URLs (`__REGISTRY_URL__/fhir/Organization/HospitalF`).

#### Fulfiller Partition — HospitalF

The fulfiller partition starts empty — Tasks are created at runtime by the Placer during the workflow. No seed data is loaded into this partition.

#### Use Cases

| | UC 1 — Orthopedic Referral | UC 2 — Tumor Board |
|--|---------------------------|---------------------|
| **Patient** | Petra Meier | Petra Meier |
| **Diagnosis** | Suspected left ACL rupture | Synovial sarcoma, right knee |
| **ServiceRequest** | ReferralOrthopedicSurgery | ReferralTumorboard |
| **Consent** | ConsentOrthopedicReferral | ConsentTumorboardReferral |
| **Task owner** | HospitalF | HospitalF |

---

### Web Application

**Stack:** React 18 + TypeScript + Vite + TailwindCSS
**Routing:** react-router-dom v6
**Data fetching:** TanStack Query v5
**Auth:** Keycloak JS adapter v25 (PKCE flow)

| Route | Page | Description |
|-------|------|-------------|
| `/` | Dashboard | Architecture panel, embedded Workflow Wizard, resource counts, sandbox capabilities |
| `/resources` | Resources | Browse, search, create, and edit FHIR resources |
| `/tasks` | Tasks | Task list with source badges (local/remote); create, update, and load linked content |
| `/credentials` | Credentials | M2M token tool with optional consent scope input |

> **Note:** The Protocol Log is a slide-out panel (bottom-right of the layout) available on every page — not a dedicated route. The Workflow Wizard is embedded directly in the Dashboard and resets automatically when switching between Placer and Fulfiller roles.

---

## Usage Guide

### Standard Workflow (Placer → Fulfiller)

1. Open http://localhost:3000, log in as `placer-user`
2. **Dashboard** → Workflow Wizard → run the 3-step **Placer** flow:
   - Step 1: Create ServiceRequest (pre-filled for Petra Meier, Ortho referral)
   - Step 2: Create Consent (linked to the ServiceRequest)
   - Step 3: Create Task at Fulfiller (SR and Consent pre-selected)
3. **Tasks tab** → verify the new Task appears (tagged `local` — lives on your partition, also visible `remote` from fulfiller)
4. Switch role to **HospitalF (Fulfiller)** using the role toggle in the header
5. **Dashboard** → Workflow Wizard → run the 3-step **Fulfiller** flow:
   - Step 1: Select the incoming Task from the task picker
   - Step 2: Load Content — fetches the linked ServiceRequest directly from the Placer's external gateway (in-browser M2M token bound to the SR as fhirContext)
   - Step 3: Update Status — sets Task to `in-progress` via the edit form
6. **Tasks tab** → verify the updated Task status

### Testing Client Credentials (L1 and L2)

1. Open **Credentials tab**, select `Placer Client` or `Fulfiller Client`
2. Pick the level — L1 (`client_secret`) or L2 (`private_key_jwt`, signed in-browser via Web Crypto)
3. Click **Request Access Token**
4. Inspect the decoded JWT — `extensions.umzhconnect.organization_reference`, `tenant`, and the `system/*` scopes. For a clinical cross-party read, the token also carries a `fhirContext` derived from RFC 9396 `authorization_details`.

### cURL Quickstart

```bash
# ── Step 1: Get a placer token ─────────────────────────────────────────────
TOKEN=$(curl -s -X POST \
  http://localhost:8180/realms/umzh-connect/protocol/openid-connect/token \
  -d "grant_type=client_credentials" \
  -d "client_id=placer-client" \
  -d "client_secret=placer-secret-2025" | jq -r '.access_token')

# ── Read own resources (Placer internal gateway) ───────────────────────────
curl -H "Authorization: Bearer $TOKEN" \
  http://localhost:8080/fhir/Patient/PetraMeier

# ── List Fulfiller Tasks directly (Fulfiller external gateway) ─────────────
# Task search is not fhirContext-gated; the requester filter returns only the
# Tasks this caller (HospitalP) requested. No proxy — call :8083 directly.
curl -H "Authorization: Bearer $TOKEN" \
  http://localhost:8083/fhir/Task

# ── Create a Task at Fulfiller directly (Fulfiller external gateway) ───────
curl -X POST http://localhost:8083/fhir/Task \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/fhir+json" \
  -d '{ "resourceType": "Task", "status": "requested", "intent": "order" }'

# ── Cross-party clinical read needs a fhirContext-scoped token ─────────────
# Easiest via the helper, which signs L2 + adds authorization_details:
CTX=$(./tests/scripts/get-token.sh fulfiller-l2-context ReferralOrthopedicSurgery)
curl -H "Authorization: Bearer $CTX" \
  "http://localhost:8081/fhir/ServiceRequest?_id=ReferralOrthopedicSurgery"

# ── Direct OPA policy evaluation ───────────────────────────────────────────
curl -s -X POST http://localhost:8182/v1/data/umzh/authz/decision \
  -H "Content-Type: application/json" \
  -d '{
    "input": {
      "method": "GET",
      "resource_type": "Patient",
      "resource_id": "PetraMeier",
      "token": {
        "organization_reference": "http://localhost:8084/fhir/Organization/HospitalF",
        "scope": "system/Patient.r",
        "fhir_context": [{"reference": "ServiceRequest/ReferralOrthopedicSurgery"}]
      }
    }
  }' | jq '.result | {allow, consent_id, reason}'
```

---

## Bruno API Collection

The `requests/` directory contains a [Bruno](https://www.usebruno.com) collection covering every API endpoint in the sandbox. Bruno is an open-source, Git-native API client — collections are plain `.bru` text files and require no account or cloud sync.

### Setup

**VS Code extension**
1. Install the **Bruno** extension (search `Bruno` in the VS Code marketplace)
2. Click the Bruno icon in the Activity Bar → **Open Collection** → select `requests/`
3. In the collection panel, select the **local** environment from the environment dropdown

**Desktop app**
1. Download from [usebruno.com](https://www.usebruno.com) and open
2. Click **Open Collection** → select `requests/`
3. Select **local** from the environment dropdown in the top-right

**CLI (for scripting / CI)**
```bash
npm install -g @usebruno/cli

# Run a single request
bru run requests/auth/get-admin-token.bru --env local

# Run the entire collection in sequence
bru run requests/ --env local --recursive
```

> **Note:** Auth tokens are stored as runtime variables (`bru.setVar`) and are session-scoped. Always run the three auth requests before making API calls. When running via the CLI, execute the `auth/` folder first or use `--recursive` to run the full collection in sequence.

---

### Auth Mechanism — Internal vs External APIs

The sandbox uses two distinct token models, reflecting how real-world deployments separate intra-hospital access from inter-hospital access.

#### Internal gateways — role-based access (`adminToken`)

| Gateway | Port | Keycloak grant | Client | Required role |
|---|---|---|---|---|
| apisix-placer-internal | 8080 | `password` | `web-app` | `placer` |
| apisix-fulfiller-internal | 8082 | `password` | `web-app` | `fulfiller` |

Internal gateways represent access from within the hospital (e.g. a clinical web application or admin tool). They validate JWT signatures and check that the token carries the correct **realm role** — `placer` for the Placer gateway, `fulfiller` for the Fulfiller gateway. No SMART scopes or consent claims are required.

The `admin-user` account holds both `placer` and `fulfiller` roles, making it suitable for exercising all internal endpoints in the sandbox.

```
Web app / admin tool
        │
        │  POST /token  grant_type=password  client=web-app
        ▼
    Keycloak ──────► JWT with realm_roles: ["placer", "fulfiller", "admin"]
        │
        │  Authorization: Bearer <adminToken>
        ▼
apisix-placer-internal :8080  (validates role == "placer")
apisix-fulfiller-internal :8082  (validates role == "fulfiller")
```

`get-admin-token.bru` fetches this token and stores it as `{{adminToken}}`.

#### External gateways — SMART scopes + consent (`placerToken` / `fulfillerToken`)

| Gateway | Port | Keycloak grant | Client | Validated by |
|---|---|---|---|---|
| apisix-placer-external | 8081 | `client_credentials` | `fulfiller-client` | OPA (party + scope + consent) |
| apisix-fulfiller-external | 8083 | `client_credentials` | `placer-client` | OPA (party + scope + consent) |

External gateways represent access from a **partner hospital**. They validate the JWT and then pass token claims to OPA for policy evaluation. OPA enforces:

- **Organization check**: `extensions.umzhconnect.organization_reference` must exactly match the actor reference in the Consent resource
- **SMART scope check**: token must carry the required system-level SMART scope (e.g. `system/Patient.r`)
- **Consent check**: OPA searches `Consent?data=<ServiceRequest>&status=active` and verifies the consent grants access; Task resources are exempt

```
Partner hospital system
        │
        │  POST /token  grant_type=client_credentials  (L1: secret, L2: private_key_jwt)
        ▼
    Keycloak ──────► JWT with extensions.umzhconnect.organization_reference,
                       scope (SMART system scopes), fhirContext
        │
        │  Authorization: Bearer <token>
        ▼
apisix-fulfiller-external :8083
        │  openid-connect validates JWT; opa plugin enforces consent
        ▼
      OPA  ──────► allow / deny based on organization_reference + scopes + consent
        │
        ▼
   HAPI FHIR (fulfiller partition)
```

`get-placer-token.bru` and `get-fulfiller-token.bru` fetch these tokens using the consent ID from `{{consentId}}` (default: `ConsentOrthopedicReferral`) and store them as `{{placerToken}}` and `{{fulfillerToken}}`.

#### Cross-domain calls — the caller mints its own M2M token

There is no gateway-side token exchange. The caller (web-app, `get-token.sh`, or
the Kestra flow) performs the L2 client_credentials flow itself and calls the
partner's external gateway directly:

```
Web app  ──►  signs L2 assertion in-browser (key from /l2-keys/, kid=placer-l2)
                     │
                     │  POST /token  grant_type=client_credentials
                     │               client_assertion=<JWT>
                     │               authorization_details=[…ServiceRequest…]  (clinical reads)
                     ▼
                 Keycloak  ──► M2M JWT (placer-client-l2 + fhirContext)
                     │
                     │  Authorization: Bearer <m2mToken>
                     ▼
          apisix-fulfiller-external :8083  (openid-connect + OPA: org + scopes + consent)
```

The web-app holds the party's L2 credentials, so it authenticates cross-domain
calls directly — no internal gateway involvement.

---

### Collection Structure

```
requests/
├── auth/
│   ├── get-placer-token.bru          M2M token for placer-client (→ {{placerToken}})
│   ├── get-fulfiller-token.bru       M2M token for fulfiller-client (→ {{fulfillerToken}})
│   ├── get-fulfiller-context-token.bru  M2M token + fhirContext for a ServiceRequest (→ {{fulfillerContextToken}})
│   └── get-admin-token.bru           User token for admin-user (→ {{adminToken}})
│
├── placer-internal/                  Own-partition calls to apisix-placer-internal :8080
│   ├── 01-metadata.bru               FHIR /metadata (no auth)
│   ├── 02-read-patient.bru           Read own Patient resource
│   ├── 03-read-service-requests.bru  Read own ServiceRequests
│   ├── 04-read-tasks.bru             Read own Tasks
│   └── 05-policy-check.bru           Direct OPA policy evaluation via /api/policy/check
│
├── fulfiller-internal/               Own-partition calls to apisix-fulfiller-internal :8082
│   └── 01-read-tasks.bru             Read own Tasks
│
├── placer-external/                  Cross-party: Fulfiller reads Placer data directly (:8081)
│   ├── 01-read-patient.bru           Read Placer Patient (→ {{fulfillerContextToken}})
│   └── 02-read-service-request.bru   Read Placer ServiceRequest + graph (→ {{fulfillerContextToken}})
│
├── fulfiller-external/               Cross-party: Placer reads/writes Fulfiller data directly (:8083)
│   ├── 01-read-tasks.bru             List Fulfiller Tasks (→ {{placerToken}})
│   └── 02-create-task.bru            Create Task at Fulfiller (→ {{placerToken}})
│
├── policies/                         Direct OPA queries — no auth required (uses {{opaPlacerUrl}})
│   ├── 01-allow-granted.bru          Resource in consent graph → true
│   ├── 02-allow-denied.bru           Resource NOT in consent graph → false
│   ├── 03-full-decision.bru          Full decision object with reason string
│   ├── 04-package-eval.bru           Package-level query (same endpoint the gateway uses)
│   └── 05-task-no-consent.bru        Task resource — Rule 1, no consent check
│
└── environments/
    └── local.bru                     Base URLs + serviceRequestId + OPA URLs for local Docker Compose
```

Cross-party requests are made **directly to the partner's external gateway** —
there are no `/proxy/*` or `/api/actions/*` collections because those routes no
longer exist. Clinical reads use `get-fulfiller-context-token` (carries the
fhirContext the OPA gate checks); Task list/create use a plain party token.

---

### Running Requests

#### Recommended sequence

Always run the auth requests first in the same session before making API calls. Tokens are short-lived (5 minutes by default) and must be refreshed by re-running the auth requests.

```
1. auth/get-placer-token            → sets {{placerToken}}
2. auth/get-fulfiller-token         → sets {{fulfillerToken}}
3. auth/get-fulfiller-context-token → sets {{fulfillerContextToken}} (for clinical cross-party reads)
4. auth/get-admin-token             → sets {{adminToken}}

5. placer-internal/* , fulfiller-internal/*   → own-partition reads
6. fulfiller-external/*   → Placer acts cross-party (use {{placerToken}})
7. placer-external/*      → Fulfiller acts cross-party (use {{fulfillerContextToken}})
```

#### Environment variables

| Variable | Default | Description |
|---|---|---|
| `keycloakUrl` | `http://localhost:8180` | Keycloak base URL |
| `placerUrl` | `http://localhost:8080` | Placer internal gateway |
| `placerExternalUrl` | `http://localhost:8081` | Placer external gateway |
| `fulfillerUrl` | `http://localhost:8082` | Fulfiller internal gateway |
| `fulfillerExternalUrl` | `http://localhost:8083` | Fulfiller external gateway |
| `serviceRequestId` | `ReferralOrthopedicSurgery` | ServiceRequest bound as fhirContext in the context token |

---

## Testing

### Test Framework

The integration tests use **[Hurl](https://hurl.dev)** — a plain-text HTTP testing tool that executes sequences of requests with assertions, captures, and variable interpolation. Each `.hurl` file is self-describing and can be read like a test script without any test framework knowledge.

**Install Hurl:**

```bash
# macOS
brew install hurl

# Linux
curl -LO https://github.com/Orange-OpenSource/hurl/releases/latest/download/hurl-x.y.z-x86_64-linux.tar.gz
# (or use the installer from https://hurl.dev/docs/installation.html)

# Verify
hurl --version
```

---

### Test Suite Overview

Ten test files in `tests/hurl/`, run in numeric order:

| File | What it tests |
|---|---|
| `01-health.hurl` | All service health endpoints respond — smoke test for the full stack |
| `02-auth.hurl` | Keycloak token acquisition for all client types; asserts `extensions.umzhconnect.organization_reference` claim |
| `03-fhir-crud.hurl` | FHIR CRUD on both internal gateways; registry reads (Organization + Endpoint, `_include` search) |
| `04-security-negative.hurl` | JWT enforcement — missing/invalid tokens must return 401; partition isolation |
| `05-cross-party-context.hurl` | Fulfiller reads Placer data through the external gateway with a context-scoped token; both consent scenarios |
| `06-workflow.hurl` | End-to-end clinical order workflow: create Task at Fulfiller → read via proxy → update status |
| `07-storage.hurl` | FHIR write operations and partition isolation verification |
| `08-context-enforcement.hurl` | Detailed OPA consent-graph enforcement: resources inside and outside consent scope |
| `09-org-reference-exact-match.hurl` | Security regression: `organization_reference` exact-match (substring/prefix attacks must be denied) |
| `10-l2-auth.hurl` | L2 (`private_key_jwt`) token structure — `*-l2` azp, org-reference / realm-role / smart-scope claims, and an end-to-end cross-party FHIR read |

---

### Running the Tests

Ensure all services are running first (`docker compose up -d`), then:

```bash
# Run the full suite (L1 — client_secret)
./tests/scripts/run-tests.sh

# Run the full suite with L2 (private_key_jwt) tokens
./tests/scripts/run-tests.sh -l2

# Run a single file manually — get-token.sh acquires a token for either level
# (L2 signs a private_key_jwt assertion locally)
TOKEN=$(./tests/scripts/get-token.sh placer)        # or: placer-l2 for private_key_jwt

hurl --test \
  --variable "placer_url=http://localhost:8080" \
  --variable "placer_token=$TOKEN" \
  tests/hurl/01-health.hurl
```

**Expected output:**
```
=============================================
 UMZH Connect Sandbox — Integration Tests
 Auth mode: Level 1 (client_secret)
=============================================
=== Waiting for services ===
  Waiting for Keycloak...              OK (0s)
  Waiting for HAPI FHIR...             OK (0s)
  ...
=== All tokens acquired ===

--- Running: 01-health ---
--- Running: 02-auth ---
...
=============================================
 Results: 10/10 passed, 0 failed
=============================================
```

---

### How the Runner Works

`tests/scripts/run-tests.sh` orchestrates three steps:

**1. Wait for services** (`wait-for-services.sh`)

Polls all service health endpoints with a configurable timeout (default 120 s, `MAX_WAIT` env var). Fails fast if any service is unreachable.

**2. Acquire tokens** (`get-token.sh`)

Fetches eight tokens before any test runs — all injected as Hurl variables so test files contain no credentials. With `-l2`, `placer_token`, `fulfiller_token`, and `fulfiller_context_token` are replaced by their L2 equivalents (identical variable names, different token content):

| Variable | Client / User | Auth method | Scope |
|---|---|---|---|
| `placer_token` | `placer-client` (L1) / `placer-client-l2` (L2) | secret / private_key_jwt | SMART scopes |
| `fulfiller_token` | `fulfiller-client` / `fulfiller-client-l2` | secret / private_key_jwt | SMART scopes |
| `fulfiller_context_token` | `fulfiller-client` / `fulfiller-client-l2` | secret / private_key_jwt | SMART + `fhirContext` |
| `placer_user_token` | `placer-user` / `web-app` | password | SMART scopes |
| `fulfiller_user_token` | `fulfiller-user` / `web-app` | password | SMART scopes |
| `placer_l2_token` | `placer-client-l2` | private_key_jwt | SMART scopes |
| `fulfiller_l2_token` | `fulfiller-client-l2` | private_key_jwt | SMART scopes |
| `fulfiller_l2_context_token` | `fulfiller-client-l2` | private_key_jwt | SMART + `fhirContext` |

**3. Run each Hurl file**

Each file is executed with `hurl --test`, injecting all URL variables and tokens. Results are written as JUnit XML to `tests/reports/`. The runner tracks pass/fail counts and exits with a non-zero code if any file fails — suitable for use in CI pipelines.

**Environment variable overrides** (useful in CI or Docker-based runs):

| Variable | Default | Description |
|---|---|---|
| `KEYCLOAK_URL` | `http://localhost:8180` | Keycloak base URL |
| `APISIX_PLACER_URL` | `http://localhost:8080` | Placer internal gateway |
| `APISIX_PLACER_EXT_URL` | `http://localhost:8081` | Placer external gateway |
| `APISIX_FULFILLER_URL` | `http://localhost:8082` | Fulfiller internal gateway |
| `APISIX_FULFILLER_EXT_URL` | `http://localhost:8083` | Fulfiller external gateway |
| `HAPI_FHIR_URL` | `http://localhost:8090` | HAPI FHIR direct access |
| `REGISTRY_URL` | `http://localhost:8084` | Registry public gateway |
| `ADMIN_API_URL` | `http://localhost:9000` | Admin API (reseed + onboarding) |
| `OPA_PLACER_URL` | `http://localhost:8181` | OPA Placer |
| `OPA_FULFILLER_URL` | `http://localhost:8182` | OPA Fulfiller |
| `MAX_WAIT` | `120` | Max seconds to wait for services before timing out |

---

### Reports

JUnit XML reports are written to `tests/reports/` after each run (one file per `.hurl` file). The directory is gitignored — only a `.gitkeep` placeholder is tracked.

```bash
# View a report summary (requires xmllint or a JUnit viewer)
cat tests/reports/05-cross-party-context.xml
```

Reports can be consumed directly by CI systems (GitHub Actions, Jenkins, GitLab CI) as JUnit test results.

---

## Development

### Local Web App Development

```bash
cd web-app
npm install
npm run dev          # Hot-reload dev server at http://localhost:3000
npx tsc --noEmit     # Type check without building
npm run build        # Production build
```

The Vite dev proxy forwards `/fhir*`, `/proxy*`, `/api*` to the internal gateway at port 8080.

### Rebuild a Single Service

```bash
# Rebuild and restart just the web app
docker compose up -d --build web-app

# Re-seed FHIR data (requires fresh HAPI FHIR)
docker compose up -d --build seed-loader

# Reload gateway config (apisix.yaml is a template rendered by entrypoint.sh at start —
# restart re-runs entrypoint.sh, re-renders the template from env vars, then starts APISIX)
docker compose restart apisix-placer-external apisix-fulfiller-external
docker compose restart apisix-placer-internal apisix-fulfiller-internal

# Reload nginx-proxy config
docker compose restart nginx-proxy

# Reload OPA policy (policies/ is volume-mounted — restart picks up changes)
docker compose restart opa-placer opa-fulfiller
```

### Logs

```bash
docker compose logs -f                             # All services
docker compose logs -f apisix-placer-internal     # Placer internal gateway
docker compose logs -f apisix-placer-external     # Placer external gateway
docker compose logs -f apisix-fulfiller-internal  # Fulfiller internal gateway
docker compose logs -f apisix-fulfiller-external  # Fulfiller external gateway
docker compose logs -f nginx-proxy                # nginx self-link rewriting
docker compose logs -f keycloak                   # Keycloak events
docker compose logs -f opa-placer                 # Placer policy engine
docker compose logs -f hapi-fhir                  # FHIR server
docker compose logs -f seed-loader               # Seed load output
```

### Reset Everything

```bash
docker compose down -v   # Remove all containers and volumes
docker compose up -d --build
```

---

## Project Structure

```
Sandbox/
├── docker-compose.yml              # 12 services, one network, one volume
├── .env                            # Port and credential configuration
│
├── docs/
│   ├── sandbox-architecture-and-requirements.md
│   └── security-concept.md
│
├── services/
│   │
│   ├── postgres/
│   │   └── init-databases.sql      # Creates the 'keycloak' database
│   │
│   ├── hapi-fhir/
│   │   └── application.yaml        # URL-partitioned FHIR R4 config
│   │
│   ├── keycloak/
│   │   └── realm-export.json       # Realm, clients, scopes
│   │
│   ├── nginx-proxy/
│   │   └── nginx.conf              # 5 server blocks (ports 80–84), one sub_filter each
│   │                               # Port 84 = public registry gateway (no auth)
│   │                               # Rewrites HAPI self-links to gateway base URLs
│   │
│   ├── apisix/
│   │   ├── internal/
│   │   │   ├── apisix.yaml         # Shared route + plugin config template for internal gateways
│   │   │   └── config.yaml         # Global APISIX config (plugin list, env whitelist for secrets)
│   │   ├── external/
│   │   │   ├── apisix.yaml         # Shared route + plugin config template for external gateways
│   │   │   └── config.yaml         # Global APISIX config (plugin list)
│   │   ├── entrypoint.sh           # Shared; substitutes PARTY/PARTNER/NGINX_OWN_PORT then starts APISIX
│   │   └── plugins/
│   │       └── umzh-role-check.lua # Custom plugin — JWT realm-role enforcement
│   │
│   ├── opa/
│   │   ├── policies/
│   │   │   ├── main.rego           # Consent-centric authz (6 rules, effective_consent_id)
│   │   │   └── apisix.rego         # APISIX input adapter (maps plugin shape → main.rego)
│   │   ├── config-placer.json      # Per-party OPA data (fhir_base, required_role)
│   │   └── config-fulfiller.json
│   │
│   ├── admin-api/
│   │   ├── Dockerfile
│   │   ├── openapi.yaml            # OpenAPI spec for onboarding + reseed endpoints
│   │   └── index.js                # Admin API: /reseed + /invites /register /clients
│   │
│   └── seed/
│       ├── Dockerfile
│       ├── seed.sh                 # Partition creation + bundle upload with URL substitution
│       └── bundles/
│           ├── shared-bundle.json     # Shared conformance resources (Questionnaire)
│           ├── placer-bundle.json     # 17 resources (HospitalP partition — no Organizations)
│           ├── fulfiller-bundle.json  # Fulfiller partition seed (Tasks created at runtime)
│           └── registry-bundle.json  # 4 mCSD resources: Organization×2 + Endpoint×2
│
└── web-app/
    ├── Dockerfile                  # Multi-stage build (Node → Nginx)
    ├── nginx.conf                  # Reverse proxy config
    ├── package.json
    ├── vite.config.ts
    ├── tailwind.config.ts
    └── src/
        ├── config/
        │   └── keycloak.ts
        ├── contexts/
        │   ├── AuthContext.tsx
        │   ├── RoleContext.tsx      # Placer / Fulfiller role switcher + gateway URLs
        │   └── LogContext.tsx
        ├── services/
        │   └── fhir-client.ts      # FHIR client + postAction / fetchAction
        ├── hooks/
        │   ├── useFhirClient.ts
        │   └── useFhirSearch.ts    # useAllTasks, useFhirSearch hooks
        ├── types/
        │   └── fhir.ts
        ├── components/
        │   ├── common/
        │   │   ├── JsonViewer.tsx
        │   │   ├── LoadingSpinner.tsx
        │   │   └── StatusBadge.tsx
        │   ├── fhir/
        │   │   ├── CreateResourceModal.tsx  # Create form for all supported FHIR types
        │   │   ├── CreateTaskModal.tsx      # Cross-party Task creation with consent picker
        │   │   ├── ResourceEditForm.tsx     # Inline edit form (all supported types)
        │   │   ├── ResourceList.tsx
        │   │   ├── ResourcePickerModal.tsx
        │   │   └── TaskList.tsx             # Source badges (local/remote), update + load flow
        │   ├── layout/
        │   │   ├── Header.tsx               # Role toggle, user info
        │   │   ├── ProtocolLogPanel.tsx     # Slide-out real-time request/response log
        │   │   └── Sidebar.tsx
        │   └── workflow/
        │       └── WorkflowWizard.tsx       # Step-by-step wizard (Placer + Fulfiller flows)
        └── pages/
            ├── Dashboard.tsx                # Architecture panel, Workflow Wizard, resource counts
            ├── ResourcesPage.tsx
            ├── TasksPage.tsx                # "Create new" button + merged task list
            └── CredentialsPage.tsx          # M2M token tool + optional consent scope input
```

---

## License

Open source. See repository for license details.
