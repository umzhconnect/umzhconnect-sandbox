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
│   /fhir/*        own data       │     │   /fhir/*        own data                  │
│   /proxy/fhir/*  partner data   │     │   /proxy/fhir/*  partner data              │
│   /api/actions/* orchestration  │     │   /api/actions/* orchestration             │
│                                 │     │                                            │
│  apisix-placer-external  :8081  │     │  apisix-fulfiller-external     :8083       │
│  (external gateway)             │◄───►│  (external gateway)                        │
│   /fhir/*  Fulfiller reads      │     │   /fhir/*  Placer reads                    │
│            Placer data          │     │            Fulfiller data                  │
└──────────────────┬──────────────┘     └─────────────────────┬──────────────────────┘
                   │                                          │
                   └────────────────────┬─────────────────────┘
                                        │
                              ┌─────────▼─────────┐
                              │   nginx-proxy     │
                              │  (no host port)   │
                              │  ports 80–83      │
                              │  self-link        │
                              │  rewriting        │
                              └─────────┬─────────┘
                                        │
                              ┌─────────▼──────────┐
                              │    HAPI FHIR       │
                              │  localhost:8090    │
                              │  /fhir/placer/     │← HospitalP partition
                              │  /fhir/fulfiller/  │← HospitalF partition
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
| `hapi-fhir` | `hapiproject/hapi:v7.4.0` | 8090 | FHIR R4 server (URL-partitioned) |
| `nginx-proxy` | `nginx:alpine` | — (internal) | Self-link rewriting proxy (ports 80–83) |
| `opa-placer` | `openpolicyagent/opa:0.70.0` | 8181 | Policy engine for HospitalP |
| `opa-fulfiller` | `openpolicyagent/opa:0.70.0` | 8182 | Policy engine for HospitalF |
| `apisix-placer-internal` | `apache/apisix:3.9.0-debian` | 8080 | Internal API gateway for HospitalP |
| `apisix-placer-external` | `apache/apisix:3.9.0-debian` | 8081 | External API gateway for HospitalP |
| `apisix-fulfiller-internal` | `apache/apisix:3.9.0-debian` | 8082 | Internal API gateway for HospitalF |
| `apisix-fulfiller-external` | `apache/apisix:3.9.0-debian` | 8083 | External API gateway for HospitalF |
| `seed-loader` | custom | — | Init container (loads FHIR data) |
| `web-app` | Node 20 + Nginx | 3000 | React SPA |

---

### Dual-Gateway Pattern — Internal and External

Each party operates **two dedicated APISIX gateways** (standalone mode — YAML config, hot-reloaded): an *internal* gateway for its own web-app and an *external* gateway that the partner calls. The split enforces a clean security boundary — the external gateway is purpose-built to serve cross-party requests and always returns consistent responses regardless of who calls it.

```
                     ── HospitalP (Placer) ────────────────────────────────────────
                    │                                                              │
  Placer web-app    │  apisix-placer-internal  :8080                               │
  ─────────────────►│   /fhir/*            → own FHIR partition (nginx-proxy:80)   │
                    │   /proxy/fhir/*      → fulfiller data (token exchange + fwd) │
                    │   /api/actions/*     → orchestration (create-task, all-tasks)│
                    │                                                              │
                    │  apisix-placer-external  :8081                               │
  Fulfiller calls  ►│   GET /fhir/{resource}?_id=<id>  → OPA → placer partition   │
                    │   GET /fhir/{resource}/{id}      → OPA → placer partition   │
                    │   POST /fhir/Task                → placer partition          │
                     ──────────────────────────────────────────────────────────────

                     ── HospitalF (Fulfiller) ───────────────────────────────────
                    │                                                              │
  Fulfiller web-app │  apisix-fulfiller-internal  :8082                            │
  ─────────────────►│   /fhir/*            → own FHIR partition (nginx-proxy:82)   │
                    │   /proxy/fhir/*      → placer data (token exchange + fwd)    │
                    │   /api/actions/*     → orchestration                         │
                    │                                                              │
                    │  apisix-fulfiller-external  :8083                            │
  Placer calls     ►│   GET  /fhir/{resource}?_id=<id>  → OPA → fulfiller partition│
                    │   GET  /fhir/{resource}/{id}      → OPA → fulfiller partition│
                    │   POST /fhir/Task                 → fulfiller partition      │
                    │   PUT  /fhir/Task/{id}            → fulfiller partition      │
                     ──────────────────────────────────────────────────────────────
```

**Design principles:**

- **External gateways are stateless and consistent.** They always return the same self-link URLs (e.g. `http://localhost:8083/fhir/...` for fulfiller-external) regardless of which party calls them.
- **URL rewriting is owned by the calling party's internal gateway.** nginx-proxy rewrites HAPI self-links for own-data requests; the internal gateway's `response-rewrite` plugin rewrites partner external URLs in cross-party proxy responses into the party's own `/proxy/fhir/` path.
- **Double JWT validation.** A request from the placer web-app routed via the proxy path is validated twice: once at `apisix-placer-internal` (the user's gateway) and once at `apisix-fulfiller-external` (the partner's gateway). The Fulfiller retains full control over who can access its data.

Both gateways share the **same Keycloak realm** and the **same HAPI FHIR instance** (via different URL partitions). In a production deployment, each gateway would typically live in its own network perimeter.

---

### FHIR Server — URL-based Partitioning

A single HAPI FHIR v7.4 instance provides two logical partitions via URL-based multi-tenancy:

| Partition | Base URL | Tenant |
|-----------|----------|--------|
| **Placer (HospitalP)** | `http://hapi-fhir:8080/fhir/placer/` | `placer` |
| **Fulfiller (HospitalF)** | `http://hapi-fhir:8080/fhir/fulfiller/` | `fulfiller` |

Resources in different partitions have **partition-scoped IDs**:
- `Organization/placer-HospitalP` exists only in the placer partition
- `Organization/fulfiller-HospitalP` is the placer org as registered in the fulfiller partition

**Cross-partition references** use absolute URLs (stored verbatim by HAPI — no placeholder creation):

```
Task.owner.reference = "http://localhost:8083/fhir/Organization/fulfiller-HospitalF"
Task.basedOn[0].reference = "http://localhost:8080/fhir/ServiceRequest/ReferralOrthopedicSurgery"
```

The absolute URL base for each partition is injected into the seed data at container start-up via environment variable substitution (`__PLACER_EXTERNAL_URL__` / `__FULFILLER_EXTERNAL_URL__`), making the external gateway addresses configurable without touching the bundle files.

---

### nginx-proxy — Self-Link Rewriting Layer

HAPI FHIR embeds its own base URL in every resource's self-link (`fullUrl`, `Bundle.link`, pagination URLs). Without rewriting, clients would always receive `http://localhost:8090/fhir/{partition}/...` self-links — internal addresses that are inaccessible outside the Docker network.

`nginx-proxy` is a single nginx container that listens on **four internal ports**, each with a dedicated `sub_filter` rewrite rule. The correct port is selected by the APISIX upstream `host` configuration.

```
nginx-proxy internal ports
─────────────────────────────────────────────────────────────────────────────────

Ports 80–83: proxy to hapi-fhir:8080
  Each port rewrites HAPI's raw partition URL to the correct APISIX gateway URL.

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
```

Cross-party proxy responses (`/proxy/fhir/*`, `/api/actions/all-tasks`) are rewritten by APISIX's `response-rewrite` plugin on the internal gateways — partner external URLs are replaced with the calling party's `/proxy/fhir/` base path. nginx is not involved in cross-party response rewriting.

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

Both read endpoints (`/fhir/{resource}` and `/fhir/{resource}/{id}`) run through the APISIX `opa` plugin before the FHIR backend is called. Task write endpoints are not consent-gated.

**apisix-placer-external `:8081`** — consumed by the Fulfiller to read Placer data and write Tasks:

| Endpoint | Method | Query params | Backend | OPA gate |
|----------|--------|-------------|---------|----------|
| `/fhir/{resource}` | GET | `_id` (required), `_include` | `opa-placer:8181` → `nginx-proxy:81` | ✅ built-in `opa` plugin |
| `/fhir/{resource}/{id}` | GET | — | `opa-placer:8181` → `nginx-proxy:81` | ✅ built-in `opa` plugin |
| `/fhir/Task` | POST | — | `nginx-proxy:81` | — |

**apisix-fulfiller-external `:8083`** — consumed by the Placer to read Fulfiller data and write/update Tasks:

| Endpoint | Method | Query params | Backend | OPA gate |
|----------|--------|-------------|---------|----------|
| `/fhir/{resource}` | GET | `_id` (required), `_include` | `opa-fulfiller:8181` → `nginx-proxy:83` | ✅ built-in `opa` plugin |
| `/fhir/{resource}/{id}` | GET | — | `opa-fulfiller:8181` → `nginx-proxy:83` | ✅ built-in `opa` plugin |
| `/fhir/Task` | POST | — | `nginx-proxy:83` | — |
| `/fhir/Task/{id}` | PUT | — | `nginx-proxy:83` | — |

#### Category 3 — Internal Proxy API (internal gateways only)

The internal gateway proxies requests from the web-app into the **partner's FHIR partition**. Traffic is routed through a dedicated nginx-proxy port that enforces the partner's external gateway security and rewrites response self-links to the calling party's own `/proxy/fhir/` base path.

| Endpoint | Method | Backend (placer) | Backend (fulfiller) |
|----------|--------|-----------------|---------------------|
| `/proxy/fhir/{resource}` | GET | `apisix-fulfiller-external:9080` | `apisix-placer-external:9080` |
| `/proxy/fhir/{resource}/{id}` | GET | `apisix-fulfiller-external:9080` | `apisix-placer-external:9080` |

The internal gateway's `serverless-post-function` performs an M2M token exchange before forwarding; the partner's external gateway enforces its own JWT validation and OPA consent check. The `response-rewrite` plugin rewrites partner external URLs in the response body to the calling party's `/proxy/fhir/` path.

Consent is enforced on both read endpoints of each external gateway via the OPA gate (`/fhir/{resource}?_id=` and `/fhir/{resource}/{id}`); the consent ID is extracted from the JWT `scope` claim (`consent:<id>`) rather than a separate header.

#### Category 4 — Actions & Business API (internal gateways only)

Orchestrated endpoints that fan-out to multiple backends or route to the partner gateway.

| Endpoint | Method | Description | Backend(s) |
|----------|--------|-------------|------------|
| `/api/actions/create-task` | POST | Create a Task at the partner | Direct call to partner's external gateway `/fhir/Task` |
| `/api/actions/all-tasks` | GET | Merge local + remote Task bundles | `local`: own FHIR partition; `remote`: partner external gateway `/fhir/Task` |
| `/api/actions/create-referral` | POST | Create ServiceRequest at Placer | Placer FHIR partition (Placer only) |
| `/api/policy/check` | POST | Direct OPA policy evaluation | Own OPA instance |

The `all-tasks` endpoint fans out to both own FHIR partition and partner external gateway in a single `serverless-post-function` and returns a merged JSON object:

```json
{
  "local":  { "resourceType": "Bundle", "entry": [ ... ] },
  "remote": { "resourceType": "Bundle", "entry": [ ... ] }
}
```

---

### Proxy Walk-Through — Placer Web-App Reads Fulfiller Data

When a response crosses a domain boundary (placer reads fulfiller data or vice versa), the FHIR URLs embedded in that response still point to the originating server. They need to be rewritten to navigable URLs on the receiving party's gateway so that pagination links and resource references resolve correctly for the caller.

This diagram traces a `GET /proxy/fhir/Task` request from the placer web-app, showing every hop and transformation.

```
Placer web-app                                         Fulfiller
localhost:3000                                         (enforces its own security)
     │
     │  GET /proxy/fhir/Task
     │  Authorization: Bearer <JWT-placer>
     │
     ▼
┌────────────────────────────────────────────────────────────────────────────────┐
│  apisix-placer-internal  :8080                                                 │
│                                                                                │
│  1. openid-connect plugin — JWT validation                                     │
│     · Fetches JWKS from keycloak:8080                                          │
│     · Verifies RS256 signature, issuer, expiry — 401 if invalid                │
│                                                                                │
│  2. umzh-role-check plugin — checks realm_role == "placer"                     │
│                                                                                │
│  3. serverless-post-function — M2M token exchange                              │
│     · POST /token client_credentials (placer-client + consent scope)           │
│     · Replaces Authorization header with M2M token                             │
│                                                                                │
│  4. proxy-rewrite — strips /proxy/fhir prefix                                  │
│     · forwards to apisix-fulfiller-external:9080  /fhir/Task                  │
└────────────────────────────┬───────────────────────────────────────────────────┘
                             │  GET /fhir/Task
                             │  Authorization: Bearer <M2M-token>
                             ▼
┌────────────────────────────────────────────────────────────────────────────────┐
│  apisix-fulfiller-external  :8083                                              │
│                                                                                │
│  5. openid-connect plugin — JWT validation (second, independent check)         │
│     · Fulfiller controls this gateway — 401 if JWT is invalid or expired       │
│     · Sets X-Access-Token from validated M2M token                             │
│                                                                                │
│  6. opa plugin — consent gate (apisix.rego adapter → main.rego)                │
│     · Reads party_id, scope, smart_scopes from JWT via X-Access-Token          │
│     · 403 if OPA denies                                                        │
│                                                                                │
│  7. proxy-rewrite — /fhir/Task → /fhir/fulfiller/Task                          │
│     · upstream: nginx-proxy:83                                                 │
└────────────────────────────┬───────────────────────────────────────────────────┘
                             │  GET /fhir/fulfiller/Task
                             ▼
┌────────────────────────────────────────────────────────────────────────────────┐
│  nginx-proxy  port 83                                                          │
│                                                                                │
│  8. proxy_pass → hapi-fhir:8080                                                │
│  9. sub_filter (streaming):                                                    │
│     "http://localhost:8090/fhir/fulfiller/" → "http://localhost:8083/fhir/"    │
│     · Self-links now point to apisix-fulfiller-external's base URL             │
└────────────────────────────┬───────────────────────────────────────────────────┘
                             │  200 OK  (FHIR Bundle)
                             │  self-links: http://localhost:8083/fhir/Task/...
                             ▼
         ┌───────────────────────────────────────────────────────────────────────┐
         │  apisix-placer-internal  :8080  (response path)                       │
         │                                                                       │
         │  10. response-rewrite plugin:                                         │
         │      "http://localhost:8083/fhir/"                                    │
         │      → "http://localhost:8080/proxy/fhir/"                            │
         │      · Self-links now point to apisix-placer-internal's proxy path    │
         └───────────────────────────────────────────────────────────────────────┘
                             │  200 OK  (FHIR Bundle)
                             │  self-links: http://localhost:8080/proxy/fhir/Task/...
                             ▼
                     Placer web-app
                     ─────────────
                     Receives Bundle where every self-link is navigable via:
                     http://localhost:8080/proxy/fhir/{resource}/{id}
                     → routed again through apisix-placer-internal
                       → apisix-fulfiller-external → nginx-proxy:83 → HAPI
```

**Security properties of this flow:**

| Property | Where enforced |
|----------|---------------|
| JWT is valid and not expired | apisix-placer-internal (step 1) |
| Fulfiller controls who can access its data | apisix-fulfiller-external (step 5) |
| Consent checked against OPA policy | apisix-fulfiller-external (step 6) |
| Response self-links are navigable by the placer web-app | apisix-placer-internal response-rewrite (step 10) |
| Placer web-app never needs a direct route to the fulfiller's external gateway | The proxy path is entirely managed by apisix-placer-internal |

The symmetric flow for **Fulfiller web-app reading Placer data** follows the same pattern targeting `apisix-placer-external`. The placer's external gateway enforces consent on all FHIR read requests via the OPA gate; consent identity is carried in the JWT `scope` claim.

---

### APISIX Plugins

The gateways use a mix of built-in APISIX plugins and one custom Lua plugin.

#### Built-in plugins used

| Plugin | Phase | Used on | Purpose |
|---|---|---|---|
| `openid-connect` | access (2599) | all authenticated routes | RS256 JWT validation via Keycloak JWKS; sets `X-Access-Token` |
| `opa` | access | external gateway FHIR reads | Consent gate — calls OPA via `apisix.rego` adapter |
| `proxy-rewrite` | — | all routes | URL prefix rewriting (e.g. `/fhir/*` → `/fhir/fulfiller/*`) |
| `response-rewrite` | — | internal gateway `/fhir/*` + `/proxy/fhir/*` | Regex URL rewriting in response body |
| `serverless-post-function` | access (1) | internal gateway proxy + action routes | M2M token exchange and `/all-tasks` fan-out |
| `serverless-pre-function` | access | `/__health` | In-process health response (no upstream) |

#### Custom plugin — `umzh-role-check`

**File:** `services/apisix/plugins/umzh-role-check.lua`  
**Priority:** 2500 (after `openid-connect` at 2599, before `serverless-post-function` at 1)

Reads the `Authorization: Bearer <token>` header, decodes the JWT payload without re-verifying the signature (already verified by `openid-connect`), and checks that `realm_roles` contains `conf.required_role`. Returns 403 if the role is absent.

```yaml
umzh-role-check:
  required_role: "placer"   # or "fulfiller"
```

Used on all internal gateway routes. Registered via `plugins:` list in the internal gateways' `config.yaml` and volume-mounted into both internal containers.

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

The sandbox implements **Level 1** (basic client credentials) of the three-level security model:

| Level | Method | Status | Use Case |
|-------|--------|--------|----------|
| **Level 1** | Client credentials — shared secret | ✅ Active | Sandbox, PoC, early pilots |
| Level 2 | `private_key_jwt` — asymmetric keys | Planned | Production, external partners |
| Level 3 | mTLS — mutual TLS | Planned | Highest-risk scopes, regulated workflows |

**Token flow for a cross-party proxy request:**

```
1. Browser → Keycloak  (client_credentials, scope=openid [consent:<id>])
2. Keycloak → Browser  (JWT with party_id, smart_scopes, scope claims)
3. Browser → apisix-placer-internal  (Bearer <JWT>)
4. apisix-placer-internal: openid-connect validates JWT (Keycloak JWKS)
5. apisix-placer-internal: umzh-role-check enforces realm_role == "placer"
6. apisix-placer-internal: serverless-post-function exchanges for M2M token
7. apisix-placer-internal forwards to apisix-fulfiller-external (Bearer <M2M>)
8. apisix-fulfiller-external: openid-connect validates M2M JWT (independent check)
9. apisix-fulfiller-external: opa plugin enforces consent policy
10. apisix-fulfiller-external → nginx-proxy:83 → hapi-fhir (fulfiller partition)
11. nginx-proxy:83 rewrites HAPI self-links → apisix-fulfiller-external base URL
12. apisix-placer-internal response-rewrite rewrites those → /proxy/fhir/ base URL
13. Browser receives navigable self-links for its own gateway
```

**JWT claims used by OPA (read via `X-Access-Token` header set by `openid-connect`):**

| JWT Claim | Purpose |
|-----------|---------|
| `party_id` | Organisation identifier for policy enforcement (e.g. `hospitalf`) |
| `smart_scopes` | SMART resource-level permissions |
| `scope` | Full scope string — OPA extracts `consent:<id>` from here |

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

Both external gateway read endpoints enforce consent **at the gateway** using APISIX's built-in `opa` plugin. The policy decision is taken before the FHIR backend is called — OPA denies return HTTP **403** directly.

| Endpoint | Query constraint | OPA enforcement |
|---|---|---|
| `GET /fhir/{resource}` | `_id` required, `_include` optional | `opa` plugin — resource ID from `_id` query param |
| `GET /fhir/{resource}/{id}` | — | `opa` plugin — resource ID from URL path |

#### Architecture

```
Client
  │  GET /fhir/Condition/SuspectedACLRupture
  │  Authorization: Bearer <JWT with scope=consent:ConsentOrthopedicReferral>
  ▼
apisix-*-external
  │
  ├─── openid-connect ── validates JWT, sets X-Access-Token
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
  Fulfiller reads Task, fetches clinical data from Placer via /proxy/fhir/*
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
| OPA Placer | http://localhost:8181/v1/health | `{"status":"ok"}` |
| OPA Fulfiller | http://localhost:8182/v1/health | `{"status":"ok"}` |

### Default Credentials

**Web App Users:**

| Username | Password | Role |
|----------|----------|------|
| `placer-user` | `placer123` | Placer (Dr. Hans Muster @ HospitalP) |
| `fulfiller-user` | `fulfiller123` | Fulfiller (Anna Schmidt @ HospitalF) |
| `admin-user` | `admin123` | Admin (all roles) |

**M2M Clients:**

| Client ID | Secret | Party | `party_id` | `tenant` |
|-----------|--------|-------|------------|---------|
| `placer-client` | `placer-secret-2025` | HospitalP | `hospitalp` | `placer` |
| `fulfiller-client` | `fulfiller-secret-2025` | HospitalF | `hospitalf` | `fulfiller` |

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

# OAuth Clients (Level 1)
PLACER_CLIENT_ID=placer-client
PLACER_CLIENT_SECRET=placer-secret-2025
FULFILLER_CLIENT_ID=fulfiller-client
FULFILLER_CLIENT_SECRET=fulfiller-secret-2025

# APISIX — two gateways per party (internal + external)
APISIX_PLACER_PORT=8080
APISIX_PLACER_EXTERNAL_PORT=8081
APISIX_FULFILLER_PORT=8082
APISIX_FULFILLER_EXTERNAL_PORT=8083

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
```

---

### HAPI FHIR Server

**Config:** `services/hapi-fhir/application.yaml`

| Setting | Value |
|---------|-------|
| FHIR version | R4 |
| Multi-tenancy | URL-based (`/fhir/{tenant}/Resource`) |
| Partitions | `placer`, `fulfiller` |
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

| Client | Type | Grant Type | Purpose |
|--------|------|------------|---------|
| `web-app` | Public | Authorization Code + PKCE | React SPA browser login |
| `placer-client` | Confidential | Client Credentials | HospitalP M2M |
| `fulfiller-client` | Confidential | Client Credentials | HospitalF M2M |

**CORS:** `placer-client` and `fulfiller-client` both have `webOrigins: ["http://localhost:3000"]` so the browser can call the token endpoint directly from the React SPA.

#### Hardcoded Token Claims (M2M Clients)

Every client credentials token for the M2M clients includes the following hardcoded claims:

| Claim | `placer-client` | `fulfiller-client` | Purpose |
|-------|-----------------|---------------------|---------|
| `party_id` | `hospitalp` | `hospitalf` | Organisation identifier for policy enforcement |
| `party_name` | `HospitalP` | `HospitalF` | Display name |
| `tenant` | `placer` | `fulfiller` | FHIR partition routing |
| `smart_scopes` | `system/Task.cru system/Patient.r ...` | `system/Task.cru system/Patient.r ...` | SMART permissions |

#### Client Scopes

| Scope Name | Type | Description |
|------------|------|-------------|
| `smart-patient-read` | Static | Adds `system/Patient.r` to token |
| `smart-task-write` | Static | SMART Task create/update permission |
| `smart-servicerequest-read` | Static | SMART ServiceRequest read |
| `smart-clinical-read` | Static | Conditions, medications, allergies, etc. |
| `smart-questionnaire-write` | Static | QuestionnaireResponse create/update |
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
  "party_id": "hospitalp",
  "smart_scopes": "system/Task.cru system/Patient.r ...",
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

**Configs:** Each gateway instance has its own directory under `services/apisix/`:
- `{party}-internal/apisix.yaml` — route + plugin config template; rendered at container start via `entrypoint.sh`
- `{party}-external/apisix.yaml` — route + plugin config (hot-reloaded, standalone mode)
- `{party}-{internal,external}/config.yaml` — global APISIX config (plugin list; internal gateways also whitelist `CLIENT_ID`/`CLIENT_SECRET` env vars via `main_configuration_snippet`)
- `{party}-internal/entrypoint.sh` — renders `apisix.yaml` template (substitutes `PARTNER_EXTERNAL_URL`/`OWN_URL`) then starts APISIX
- `plugins/umzh-role-check.lua` — custom role-check plugin (mounted only in internal gateways)

> **Network addressing:** All inter-service communication uses Docker Compose service names (e.g. `keycloak:8080`, `apisix-fulfiller-external:9080`) rather than `localhost` ports. Inside a Docker container `localhost` refers to the container itself, not the host machine.

> **Keycloak back-channel:** Keycloak's `KC_HOSTNAME` is `http://localhost:8180` (browser-facing). `KC_HOSTNAME_BACKCHANNEL_DYNAMIC=true` is set on the Keycloak service so that server-side back-channel requests (e.g. JWKS fetches from APISIX) receive discovery documents with URLs resolved from the incoming `Host` header (`keycloak:8080`) rather than the browser-facing hostname. This makes JWKS validation work inside Docker without any nginx workaround.

All four gateways use the same `openid-connect` plugin config pattern:

```yaml
openid-connect:
  discovery: "http://keycloak:8080/realms/umzh-connect/.well-known/openid-configuration"
  bearer_only: true
  use_jwks: true
  set_access_token_header: true   # false on proxy-out routes (int-proxy-partner)
  set_userinfo_header: false
  client_id: "unused"
  client_secret: "unused"
```

#### Full Endpoint Reference — Placer Internal Gateway (`:8080`)

| Category | Endpoint | Method | Upstream | Rewritten path | Auth |
|----------|----------|--------|----------|---------------|------|
| Metadata | `/fhir/metadata` | GET | `nginx-proxy:80` | `/fhir/placer/metadata` | None |
| 1 – Internal | `/fhir/*` | GET, POST, PUT, PATCH, DELETE | `nginx-proxy:80` | `/fhir/placer/*` | JWT + role |
| 3 – Proxy | `/proxy/fhir/*` | GET | `apisix-fulfiller-external:9080` | `/fhir/*` | JWT + role + M2M exchange |
| 4 – Actions | `/api/actions/create-task` | POST | `apisix-fulfiller-external:9080` | `/fhir/Task` | JWT + role + M2M exchange |
| 4 – Actions | `/api/actions/all-tasks` | GET | — (fan-out) | — | JWT + role + M2M exchange |
| 4 – Policy | `/api/policy/check` | POST | `opa-placer:8181` | `/v1/data/umzh/authz/allow` | None |

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
| 3 – Proxy | `/proxy/fhir/*` | GET | `apisix-placer-external:9080` | `/fhir/*` | JWT + role + M2M exchange |
| 4 – Actions | `/api/actions/create-task` | POST | `apisix-placer-external:9080` | `/fhir/Task` | JWT + role + M2M exchange |
| 4 – Actions | `/api/actions/all-tasks` | GET | — (fan-out) | — | JWT + role + M2M exchange |
| 4 – Policy | `/api/policy/check` | POST | `opa-fulfiller:8181` | `/v1/data/umzh/authz/allow` | None |

#### Full Endpoint Reference — Fulfiller External Gateway (`:8083`)

| Endpoint | Method | Query params | Upstream | Rewritten path | Auth |
|----------|--------|-------------|----------|---------------|------|
| `/fhir/*` (read by id) | GET | — | `nginx-proxy:83` | `/fhir/fulfiller/*` | JWT + OPA |
| `/fhir/*` (search) | GET | `_id` required | `nginx-proxy:83` | `/fhir/fulfiller/*` | JWT + OPA |
| `/fhir/Task` | POST | — | `nginx-proxy:83` | `/fhir/fulfiller/Task` | JWT |
| `/fhir/Task/*` | PUT | — | `nginx-proxy:83` | `/fhir/fulfiller/Task/*` | JWT |

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
    "party_id":    "hospitalf",
    "smart_scopes": "system/Patient.r system/Task.cru ...",
    "tenant":      "fulfiller",
    "scope":       "openid consent:ConsentOrthopedicReferral"
  },
  "consent_id": "",
  "consent":    null,
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
TOKEN=$(curl -s -X POST http://localhost:8180/realms/umzh-connect/protocol/openid-connect/token \
  -d "grant_type=client_credentials&client_id=fulfiller-client&client_secret=fulfiller-secret-2025&scope=openid consent:ConsentOrthopedicReferral" \
  | jq -r '.access_token')

# Direct OPA evaluation — access granted (consent in JWT scope)
curl -s -X POST http://localhost:8182/v1/data/umzh/authz/decision \
  -H "Content-Type: application/json" \
  -d '{
    "input": {
      "method": "GET",
      "resource_type": "Patient",
      "resource_id": "PetraMeier",
      "token": {
        "party_id": "hospitalf",
        "smart_scopes": "system/Patient.r system/Task.cru",
        "scope": "openid consent:ConsentOrthopedicReferral"
      },
      "consent_id": "",
      "consent": null,
      "fhir_base": "http://localhost:8090/fhir/placer"
    }
  }' | jq '.result'
# → { "allow": true, "consent_id": "ConsentOrthopedicReferral", "reason": "Resource access granted via valid consent" }
```

> **Note:** The gateway's `/api/policy/check` proxies to `/v1/data/umzh/authz/allow` (the boolean endpoint). For the full `decision` object, call OPA directly on ports 8181/8182.

---

### Seed Data

**Loader:** `services/seed/` (Docker init container)

The seed loader waits for HAPI FHIR readiness, creates the two partitions, then POSTs FHIR transaction bundles. Before posting, `seed.sh` substitutes `__PLACER_EXTERNAL_URL__` and `__FULFILLER_EXTERNAL_URL__` placeholders in the bundle files with the values from the `PLACER_EXTERNAL_URL` / `FULFILLER_EXTERNAL_URL` environment variables (defaults: `http://localhost:8081` / `http://localhost:8083`).

#### Placer Partition — HospitalP

19 resources covering two referral use cases:

| Resource Type | ID / Description |
|---------------|-----------------|
| Organization | HospitalP (self), HospitalF (partner) |
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

#### Fulfiller Partition — HospitalF

| Resource Type | ID / Description |
|---------------|-----------------|
| Organization | HospitalF (self), HospitalP (partner) |

Each Organization carries two FHIR meta tags used by the web-app for cross-party routing:
- `urn:umzh:keycloak:client-id` — the Keycloak client ID for M2M token requests
- `urn:umzh:api:external-host` — the base URL of the party's external APISIX gateway

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
   - Step 2: Load Content — fetches the linked ServiceRequest from the Placer via `/proxy/fhir/*`
   - Step 3: Update Status — sets Task to `in-progress` via the edit form
6. **Tasks tab** → verify the updated Task status

### Testing Client Credentials + Consent Scope

1. Open **Credentials tab**, select `Placer Client` or `Fulfiller Client`
2. Enter a Consent ID, e.g. `ConsentOrthopedicReferral`
3. Click **Request Access Token**
4. Inspect the decoded JWT — the `scope` field carries `openid consent:ConsentOrthopedicReferral`

### cURL Quickstart

```bash
# ── Step 1: Get a placer token (with consent) ──────────────────────────────
TOKEN=$(curl -s -X POST \
  http://localhost:8180/realms/umzh-connect/protocol/openid-connect/token \
  -d "grant_type=client_credentials" \
  -d "client_id=placer-client" \
  -d "client_secret=placer-secret-2025" \
  -d "scope=openid consent:ConsentOrthopedicReferral" | jq -r '.access_token')

# ── Read own resources (Placer internal) ───────────────────────────────────
curl -H "Authorization: Bearer $TOKEN" \
  http://localhost:8080/fhir/Patient/PetraMeier

# ── Read Fulfiller resources via proxy path ────────────────────────────────
# (apisix-placer-internal → M2M exchange → apisix-fulfiller-external → HAPI)
# Self-links in the response will be navigable via localhost:8080/proxy/fhir/
curl -H "Authorization: Bearer $TOKEN" \
  http://localhost:8080/proxy/fhir/Task

# ── Read Placer data via external gateway (as Fulfiller) ───────────────────
FTOKEN=$(curl -s -X POST \
  http://localhost:8180/realms/umzh-connect/protocol/openid-connect/token \
  -d "grant_type=client_credentials" \
  -d "client_id=fulfiller-client" \
  -d "client_secret=fulfiller-secret-2025" \
  -d "scope=openid consent:ConsentOrthopedicReferral" | jq -r '.access_token')

curl -H "Authorization: Bearer $FTOKEN" \
  "http://localhost:8081/fhir/Patient/PetraMeier"

# ── Create a Task at Fulfiller via Placer actions ──────────────────────────
curl -X POST http://localhost:8080/api/actions/create-task \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{ "resourceType": "Task", "status": "requested", "intent": "order" }'

# ── Fetch merged task list ─────────────────────────────────────────────────
curl -H "Authorization: Bearer $TOKEN" \
  http://localhost:8080/api/actions/all-tasks | jq '{local: .local.total, remote: .remote.total}'

# ── Direct OPA policy evaluation ───────────────────────────────────────────
curl -s -X POST http://localhost:8182/v1/data/umzh/authz/decision \
  -H "Content-Type: application/json" \
  -d '{
    "input": {
      "method": "GET",
      "resource_type": "Patient",
      "resource_id": "PetraMeier",
      "token": {
        "party_id": "hospitalf",
        "smart_scopes": "system/Patient.r",
        "scope": "openid consent:ConsentOrthopedicReferral"
      },
      "consent_id": "",
      "consent": null
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

External gateways represent access from a **partner hospital**. They validate the JWT and then forward token claims (`party_id`, `smart_scopes`, `scope`) to OPA for policy evaluation. OPA enforces:

- **Party check**: the token's `party_id` must match the expected partner (e.g. `hospitalp` calling the Fulfiller external gateway)
- **SMART scope check**: token must carry the required system-level SMART scope (e.g. `system/Patient.r`)
- **Consent check**: for Patient and ServiceRequest resources the token's `scope` must carry `consent:<id>` matching a valid Consent resource; Task resources are exempt

```
Partner hospital system
        │
        │  POST /token  grant_type=client_credentials  client=placer-client
        ▼
    Keycloak ──────► JWT with party_id, smart_scopes, scope=consent:<id>
        │
        │  Authorization: Bearer <placerToken>
        ▼
apisix-fulfiller-external :8083
        │  openid-connect validates JWT; opa plugin checks consent
        ▼
      OPA  ──────► allow / deny based on party + scopes + consent
        │
        ▼
   HAPI FHIR (fulfiller partition)
```

`get-placer-token.bru` and `get-fulfiller-token.bru` fetch these tokens using the consent ID from `{{consentId}}` (default: `ConsentOrthopedicReferral`) and store them as `{{placerToken}}` and `{{fulfillerToken}}`.

#### Cross-domain calls — automatic M2M token exchange

For internal endpoints that call the partner's external gateway (`/proxy/fhir/*`, `/api/actions/create-task`, `/api/actions/all-tasks`), the internal gateway performs a silent **M2M token exchange** on behalf of the caller:

```
Web app  ──►  apisix-placer-internal :8080  (validates adminToken, role=placer)
                     │
                     │  POST /token  grant_type=client_credentials
                     ▼
                 Keycloak  ──► M2M JWT (placer-client + consent scope)
                     │
                     │  Authorization: Bearer <m2mToken>  (injected by serverless-post-function)
                     ▼
          apisix-fulfiller-external :8083  (OPA: party + scopes + consent)
```

The caller only ever sends `adminToken`. The gateway handles obtaining and injecting the correct M2M credential automatically.

---

### Collection Structure

```
requests/
├── auth/
│   ├── get-placer-token.bru       Fetches M2M token for placer-client (→ {{placerToken}})
│   ├── get-fulfiller-token.bru    Fetches M2M token for fulfiller-client (→ {{fulfillerToken}})
│   └── get-admin-token.bru        Fetches user token for admin-user (→ {{adminToken}})
│
├── placer/                         All calls to apisix-placer-internal :8080 — requires {{adminToken}}
│   ├── 01-metadata.bru            FHIR /metadata (no auth)
│   ├── 02-read-patient.bru        Read own Patient resource
│   ├── 03-read-service-requests.bru  Read own ServiceRequests
│   ├── 04-read-tasks.bru          Read own Tasks
│   ├── 05-create-task-at-fulfiller.bru  Create Task at Fulfiller via /api/actions/create-task
│   ├── 06-all-tasks.bru           Fetch merged Task list (local + remote) via /api/actions/all-tasks
│   ├── 07-proxy-read-fulfiller-tasks.bru  Read Fulfiller Tasks via /proxy/fhir/* (consent-gated)
│   └── 08-policy-check.bru        Direct OPA policy evaluation via /api/policy/check
│
├── fulfiller/                      All calls to apisix-fulfiller-internal :8082 — requires {{adminToken}}
│   ├── 01-read-tasks.bru          Read own Tasks
│   ├── 02-proxy-read-placer-patient.bru  Read Placer Patient via /proxy/fhir/* (consent-gated)
│   └── 03-all-tasks.bru           Fetch merged Task list (local + remote)
│
├── external/                       Direct calls to external gateways — requires party token
│   ├── 01-placer-external-read-patient.bru   Fulfiller reads Placer Patient (→ {{fulfillerToken}})
│   ├── 02-fulfiller-external-read-tasks.bru  Placer reads Fulfiller Tasks (→ {{placerToken}})
│   └── 03-fulfiller-external-create-task.bru Placer creates Task at Fulfiller (→ {{placerToken}})
│
├── policies/                       Direct OPA queries — no auth required (uses {{opaPlacerUrl}})
│   ├── 01-allow-granted.bru       Resource in consent graph → true
│   ├── 02-allow-denied.bru        Resource NOT in consent graph → false
│   ├── 03-full-decision.bru       Full decision object with reason string
│   ├── 04-package-eval.bru        Package-level query (same endpoint the gateway uses)
│   └── 05-task-no-consent.bru     Task resource — Rule 1, no consent check
│
└── environments/
    └── local.bru                  Base URLs + consentId + OPA URLs for local Docker Compose setup
```

---

### Running Requests

#### Recommended sequence

Always run the auth requests first in the same session before making API calls. Tokens are short-lived (5 minutes by default) and must be refreshed by re-running the auth requests.

```
1. auth/get-placer-token       → sets {{placerToken}}
2. auth/get-fulfiller-token    → sets {{fulfillerToken}}
3. auth/get-admin-token        → sets {{adminToken}}

4. placer/*                    → use {{adminToken}}
5. fulfiller/*                 → use {{adminToken}}
6. external/*                  → use {{placerToken}} or {{fulfillerToken}}
```

#### Environment variables

| Variable | Default | Description |
|---|---|---|
| `keycloakUrl` | `http://localhost:8180` | Keycloak base URL |
| `placerUrl` | `http://localhost:8080` | Placer internal gateway |
| `placerExternalUrl` | `http://localhost:8081` | Placer external gateway |
| `fulfillerUrl` | `http://localhost:8082` | Fulfiller internal gateway |
| `fulfillerExternalUrl` | `http://localhost:8083` | Fulfiller external gateway |
| `consentId` | `ConsentOrthopedicReferral` | Consent ID used when requesting scoped party tokens |

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

Seven test files in `tests/hurl/`, run in numeric order:

| File | What it tests |
|---|---|
| `01-health.hurl` | All service health endpoints respond — smoke test for the full stack |
| `02-auth.hurl` | Keycloak token acquisition for all client types (M2M + user password grant) |
| `03-fhir-crud.hurl` | FHIR read and search operations on both internal gateways |
| `04-security-negative.hurl` | JWT enforcement — missing/invalid tokens must return 401; partition isolation |
| `05-cross-party-consent.hurl` | Fulfiller reads Placer data through the external gateway with a consent-scoped token; both consent scenarios |
| `06-workflow.hurl` | End-to-end clinical order workflow: create Task at Fulfiller → read via proxy → update status |
| `07-storage.hurl` | FHIR write operations and partition isolation verification |

---

### Running the Tests

Ensure all services are running first (`docker compose up -d`), then:

```bash
# Run the full suite
./tests/scripts/run-tests.sh

# Run a single file manually
hurl --test \
  --variable "placer_url=http://localhost:8080" \
  --variable "placer_token=<token>" \
  tests/hurl/01-health.hurl
```

**Expected output:**
```
=============================================
 UMZH Connect Sandbox — Integration Tests
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
 Results: 7/7 passed, 0 failed
=============================================
```

---

### How the Runner Works

`tests/scripts/run-tests.sh` orchestrates three steps:

**1. Wait for services** (`wait-for-services.sh`)

Polls all service health endpoints with a configurable timeout (default 120 s, `MAX_WAIT` env var). Fails fast if any service is unreachable.

**2. Acquire tokens** (`get-token.sh`)

Fetches five tokens from Keycloak before any test runs — all are injected as Hurl variables so individual test files do not contain credentials:

| Variable | Grant type | Client / User | Scope |
|---|---|---|---|
| `placer_token` | `client_credentials` | `placer-client` | SMART scopes (no consent) |
| `fulfiller_token` | `client_credentials` | `fulfiller-client` | SMART scopes (no consent) |
| `fulfiller_consent_token` | `client_credentials` | `fulfiller-client` | SMART + `consent:ConsentOrthopedicReferral` |
| `placer_user_token` | `password` | `placer-user` / `web-app` | SMART scopes |
| `fulfiller_user_token` | `password` | `fulfiller-user` / `web-app` | SMART scopes |

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
| `OPA_PLACER_URL` | `http://localhost:8181` | OPA Placer |
| `OPA_FULFILLER_URL` | `http://localhost:8182` | OPA Fulfiller |
| `MAX_WAIT` | `120` | Max seconds to wait for services before timing out |

---

### Reports

JUnit XML reports are written to `tests/reports/` after each run (one file per `.hurl` file). The directory is gitignored — only a `.gitkeep` placeholder is tracked.

```bash
# View a report summary (requires xmllint or a JUnit viewer)
cat tests/reports/05-cross-party-consent.xml
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

The Vite dev proxy forwards `/fhir*`, `/proxy*`, `/api*` to APISIX at port 8080.

### Rebuild a Single Service

```bash
# Rebuild and restart just the web app
docker compose up -d --build web-app

# Re-seed FHIR data (requires fresh HAPI FHIR)
docker compose up -d --build seed-loader

# Reload external gateway config (apisix.yaml is volume-mounted directly — hot-reloaded by APISIX)
docker compose restart apisix-placer-external apisix-fulfiller-external

# Reload internal gateway config (apisix.yaml is a template rendered by entrypoint.sh at start —
# restart re-runs entrypoint.sh, re-renders the template, then starts APISIX)
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
│   │   └── realm-export.json       # Realm, clients, scopes (incl. dynamic consent scope)
│   │
│   ├── nginx-proxy/
│   │   └── nginx.conf              # 4 server blocks (ports 80–83), one sub_filter each
│   │                               # Rewrites HAPI self-links to APISIX gateway base URLs
│   │
│   ├── apisix/
│   │   ├── placer-internal/
│   │   │   ├── apisix.yaml         # Route + plugin config template (envsubst rendered at start)
│   │   │   ├── config.yaml         # Global APISIX config (plugin list, env whitelist for secrets)
│   │   │   └── entrypoint.sh       # Renders apisix.yaml template then starts APISIX
│   │   ├── placer-external/
│   │   │   ├── apisix.yaml         # Route + plugin config (port 8081, hot-reloaded)
│   │   │   └── config.yaml         # Global APISIX config (plugin list)
│   │   ├── fulfiller-internal/
│   │   │   ├── apisix.yaml         # Route + plugin config template (envsubst rendered at start)
│   │   │   ├── config.yaml         # Global APISIX config (plugin list, env whitelist for secrets)
│   │   │   └── entrypoint.sh       # Renders apisix.yaml template then starts APISIX
│   │   ├── fulfiller-external/
│   │   │   ├── apisix.yaml         # Route + plugin config (port 8083, hot-reloaded)
│   │   │   └── config.yaml         # Global APISIX config (plugin list)
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
│   └── seed/
│       ├── Dockerfile
│       ├── seed.sh                 # Partition creation + bundle upload with URL substitution
│       └── bundles/
│           ├── shared-bundle.json     # Shared conformance resources (Questionnaire)
│           ├── placer-bundle.json     # 19 resources (HospitalP partition)
│           └── fulfiller-bundle.json  # 2 Organization resources (HospitalF partition)
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
