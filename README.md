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
  - [Security Model](#security-model)
  - [Clinical Order Workflow](#clinical-order-workflow)
- [Quick Start](#quick-start)
- [Configuration Reference](#configuration-reference)
  - [Environment Variables](#environment-variables)
  - [HAPI FHIR Server](#hapi-fhir-server)
  - [Keycloak — Authorization Server](#keycloak--authorization-server)
  - [Dynamic Consent Scope](#dynamic-consent-scope)
  - [KrakenD API Gateways](#krakend-api-gateways)
  - [OPA Policy Engine](#opa-policy-engine)
  - [Seed Data](#seed-data)
  - [Web Application](#web-application)
- [Usage Guide](#usage-guide)
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
│  krakend-placer          :8080  │     │  krakend-fulfiller             :8082       │
│  (internal gateway)             │     │  (internal gateway)                        │
│   /fhir/*        own data       │     │   /fhir/*        own data                  │
│   /proxy/fhir/*  partner data   │     │   /proxy/fhir/*  partner data              │
│   /api/actions/* orchestration  │     │   /api/actions/* orchestration             │
│                                 │     │                                            │
│  krakend-placer-external :8081  │     │  krakend-fulfiller-external    :8083       │
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
                              │  ports 80–85      │
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
| `nginx-proxy` | `nginx:alpine` | — (internal) | Self-link rewriting proxy (ports 80–85) |
| `opa-placer` | `openpolicyagent/opa:0.70.0` | 8181 | Policy engine for HospitalP |
| `opa-fulfiller` | `openpolicyagent/opa:0.70.0` | 8182 | Policy engine for HospitalF |
| `krakend-placer` | `devopsfaith/krakend:2.7` | 8080 | Internal API gateway for HospitalP |
| `krakend-placer-external` | `devopsfaith/krakend:2.7` | 8081 | External API gateway for HospitalP |
| `krakend-fulfiller` | `devopsfaith/krakend:2.7` | 8082 | Internal API gateway for HospitalF |
| `krakend-fulfiller-external` | `devopsfaith/krakend:2.7` | 8083 | External API gateway for HospitalF |
| `seed-loader` | custom | — | Init container (loads FHIR data) |
| `web-app` | Node 20 + Nginx | 3000 | React SPA |

---

### Dual-Gateway Pattern — Internal and External

Each party operates **two dedicated KrakenD gateways**: an *internal* gateway for its own web-app and an *external* gateway that the partner calls. The split enforces a clean security boundary — the external gateway is purpose-built to serve cross-party requests and always returns consistent responses regardless of who calls it.

```
                     ── HospitalP (Placer) ────────────────────────────────────────
                    │                                                              │
  Placer web-app    │  krakend-placer (internal)  :8080                            │
  ─────────────────►│   /fhir/*            → own FHIR partition (nginx-proxy:80)   │
                    │   /proxy/fhir/*      → fulfiller data via nginx-proxy:84     │
                    │   /api/actions/*     → orchestration (create-task, all-tasks)│
                    │                                                              │
                    │  krakend-placer-external :8081                               │
  Fulfiller calls  ►│   GET /fhir/{resource}   → placer partition (nginx-proxy:81) │
                    │   GET /fhir/{resource}/{id}                                  │
                    │   POST /fhir/Task        → placer partition (nginx-proxy:81) │
                     ──────────────────────────────────────────────────────────────

                     ── HospitalF (Fulfiller) ───────────────────────────────────
                    │                                                              │
  Fulfiller web-app │  krakend-fulfiller (internal)  :8082                         │
  ─────────────────►│   /fhir/*            → own FHIR partition (nginx-proxy:82)   │
                    │   /proxy/fhir/*      → placer data via nginx-proxy:85        │
                    │   /api/actions/*     → orchestration                         │
                    │                                                              │
                    │  krakend-fulfiller-external :8083                            │
  Placer calls     ►│   GET  /fhir/{resource}     → fulfiller partition (nginx-proxy:83) │
                    │   GET  /fhir/{resource}/{id}                                 │
                    │   POST /fhir/Task            → fulfiller partition           │
                    │   PUT  /fhir/Task/{id}       → fulfiller partition           │
                     ──────────────────────────────────────────────────────────────
```

**Design principles:**

- **External gateways are stateless and consistent.** They always return the same self-link URLs (e.g. `http://localhost:8083/fhir/...` for fulfiller-external) regardless of which party calls them. No caller-specific body manipulation takes place at the external gateway.
- **URL rewriting is owned by the calling party's internal gateway.** When a web-app navigates FHIR self-links through the proxy path, the internal gateway routes the request through a dedicated nginx-proxy port that rewrites the partner's external URLs into the party's own `/proxy/fhir/` path (see [nginx-proxy](#nginx-proxy--self-link-rewriting-layer)).
- **Double JWT validation.** A request from the placer web-app routed via the proxy path is validated twice: once at `krakend-placer` (the user's gateway) and once at `krakend-fulfiller-external` (the partner's gateway). The Fulfiller retains full control over who can access its data.

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

`nginx-proxy` is a single nginx container that listens on **six internal ports**, each with a dedicated `sub_filter` rewrite rule. The correct port is selected by the KrakenD backend `host` configuration — no conditionals or request-header inspection are needed.

```
nginx-proxy internal ports
─────────────────────────────────────────────────────────────────────────────────

Ports 80–83: proxy to hapi-fhir:8080
  Each port rewrites HAPI's raw partition URL to the correct KrakenD gateway URL.

  Port 80 ─ Placer internal (krakend-placer :8080)
    proxy_pass: hapi-fhir:8080
    sub_filter: "http://localhost:8090/fhir/placer/"  →  "http://localhost:8080/fhir/"
    Used by: krakend-placer (Category 1 — own data), /api/actions/create-referral

  Port 81 ─ Placer external (krakend-placer-external :8081)
    proxy_pass: hapi-fhir:8080
    sub_filter: "http://localhost:8090/fhir/placer/"  →  "http://localhost:8081/fhir/"
    Used by: krakend-placer-external (Category 2 — Fulfiller reads Placer data)

  Port 82 ─ Fulfiller internal (krakend-fulfiller :8082)
    proxy_pass: hapi-fhir:8080
    sub_filter: "http://localhost:8090/fhir/fulfiller/"  →  "http://localhost:8082/fhir/"
    Used by: krakend-fulfiller (Category 1 — own data), /api/actions/create-task

  Port 83 ─ Fulfiller external (krakend-fulfiller-external :8083)
    proxy_pass: hapi-fhir:8080
    sub_filter: "http://localhost:8090/fhir/fulfiller/"  →  "http://localhost:8083/fhir/"
    Used by: krakend-fulfiller-external (Category 2 — Placer reads Fulfiller data)

─────────────────────────────────────────────────────────────────────────────────

Ports 84–85: proxy to external KrakenD gateways (NOT hapi-fhir)
  These ports are used exclusively by the /proxy/fhir/* endpoints on the internal
  gateways. They forward through the partner's external gateway (enforcing its JWT
  validation) and rewrite the partner's external self-links in the response body
  to the calling party's own /proxy/fhir/ path.

  Port 84 ─ Placer internal proxy reads Fulfiller (krakend-placer :8080 /proxy/fhir/*)
    proxy_pass: krakend-fulfiller-external:8080     ← enforces Fulfiller's JWT rules
    sub_filter: "http://localhost:8083/fhir/"  →  "http://localhost:8080/proxy/fhir/"
    Used by: krakend-placer's /proxy/fhir/* backend
    Result: Placer web-app receives URLs it can navigate via its own /proxy/fhir/ path

  Port 85 ─ Fulfiller internal proxy reads Placer (krakend-fulfiller :8082 /proxy/fhir/*)
    proxy_pass: krakend-placer-external:8080        ← enforces Placer's JWT + consent rules
    sub_filter: "http://localhost:8081/fhir/"  →  "http://localhost:8082/proxy/fhir/"
    Used by: krakend-fulfiller's /proxy/fhir/* backend
    Result: Fulfiller web-app receives URLs it can navigate via its own /proxy/fhir/ path
```

**Why nginx `sub_filter` and not KrakenD body manipulation?**
KrakenD in `no-op` encoding mode passes the response body through unchanged, which is required for FHIR (preserving all fields and content types). nginx `sub_filter` performs streaming string replacement on the response body without parsing it, making it ideal for URL rewriting at high throughput without schema awareness.

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

**krakend-placer-external `:8081`** — consumed by the Fulfiller to read Placer data and write Tasks:

| Endpoint | Method(s) | Backend | Propagated Claims |
|----------|-----------|---------|-------------------|
| `/fhir/{resource}` | GET | `nginx-proxy:81/fhir/placer/{resource}` | `party_id`, `smart_scopes`, `tenant`, `scope` |
| `/fhir/{resource}/{id}` | GET | `nginx-proxy:81/fhir/placer/{resource}/{id}` | `party_id`, `smart_scopes`, `tenant`, `scope` |
| `/fhir/Task` | POST | `nginx-proxy:81/fhir/placer/Task` | `party_id`, `smart_scopes`, `scope` |

**krakend-fulfiller-external `:8083`** — consumed by the Placer to write and read Fulfiller Tasks:

| Endpoint | Method(s) | Backend | Propagated Claims |
|----------|-----------|---------|-------------------|
| `/fhir/{resource}` | GET | `nginx-proxy:83/fhir/fulfiller/{resource}` | `party_id`, `smart_scopes`, `scope` |
| `/fhir/{resource}/{id}` | GET | `nginx-proxy:83/fhir/fulfiller/{resource}/{id}` | `party_id`, `smart_scopes`, `scope` |
| `/fhir/Task` | POST | `nginx-proxy:83/fhir/fulfiller/Task` | `party_id`, `smart_scopes`, `scope` |
| `/fhir/Task/{id}` | PUT | `nginx-proxy:83/fhir/fulfiller/Task/{id}` | — |

#### Category 3 — Internal Proxy API (internal gateways only)

The internal gateway proxies requests from the web-app into the **partner's FHIR partition**. Traffic is routed through a dedicated nginx-proxy port that enforces the partner's external gateway security and rewrites response self-links to the calling party's own `/proxy/fhir/` base path.

| Endpoint | Method | Backend (placer) | Backend (fulfiller) |
|----------|--------|-----------------|---------------------|
| `/proxy/fhir/{resource}` | GET | `nginx-proxy:84/fhir/{resource}` | `nginx-proxy:85/fhir/{resource}` |
| `/proxy/fhir/{resource}/{id}` | GET | `nginx-proxy:84/fhir/{resource}/{id}` | `nginx-proxy:85/fhir/{resource}/{id}` |

`nginx-proxy:84` forwards to `krakend-fulfiller-external` (second JWT validation)
`nginx-proxy:85` forwards to `krakend-placer-external` (second JWT validation + consent check)

The `X-Consent-Id` header is passed through on the fulfiller's proxy path because placer data is consent-gated.

#### Category 4 — Actions & Business API (internal gateways only)

Orchestrated endpoints that fan-out to multiple backends or route to the partner gateway.

| Endpoint | Method | Description | Backend(s) |
|----------|--------|-------------|------------|
| `/api/actions/create-task` | POST | Create a Task at the partner | Direct call to partner's external gateway `/fhir/Task` |
| `/api/actions/all-tasks` | GET | Merge local + remote Task bundles | `local`: own FHIR partition; `remote`: partner external gateway `/fhir/Task` |
| `/api/actions/create-referral` | POST | Create ServiceRequest at Placer | Placer FHIR partition (Placer only) |
| `/api/policy/check` | POST | Direct OPA policy evaluation | Own OPA instance |

The `all-tasks` endpoint uses KrakenD's **multi-backend fan-out** with `group` keys:

```json
{
  "local":  { "resourceType": "Bundle", "entry": [ ... ] },
  "remote": { "resourceType": "Bundle", "entry": [ ... ] }
}
```

---

### Proxy Walk-Through — Placer Web-App Reads Fulfiller Data

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
│  krakend-placer  :8080                                                         │
│                                                                                │
│  1. JWT validation                                                             │
│     · Fetches JWKS from keycloak:8080                                          │
│     · Verifies RS256 signature, issuer, expiry                                 │
│     · 401 if invalid                                                           │
│                                                                                │
│  2. Routes to backend:                                                         │
│     · endpoint /proxy/fhir/{resource}                                          │
│     · backend  nginx-proxy:84  /fhir/{resource}                                │
│     · Forwards Authorization header                                            │
└────────────────────────────┬───────────────────────────────────────────────────┘
                             │  GET /fhir/Task
                             │  Authorization: Bearer <JWT-placer>
                             ▼
┌────────────────────────────────────────────────────────────────────────────────┐
│  nginx-proxy  port 84                                                          │
│                                                                                │
│  3. Request forwarding                                                         │
│     · proxy_pass → krakend-fulfiller-external:8080                             │
│     · All headers forwarded (including Authorization)                          │
│     · Accept-Encoding: "" (disables compression for sub_filter)                │
│                                                                                │
│  [Response comes back later — see step 9]                                      │
└────────────────────────────┬───────────────────────────────────────────────────┘
                             │  GET /fhir/Task
                             │  Authorization: Bearer <JWT-placer>
                             ▼
┌────────────────────────────────────────────────────────────────────────────────┐
│  krakend-fulfiller-external  :8083                                             │
│                                                                                │
│  4. JWT validation (second, independent check)                                 │
│     · Same Keycloak JWKS endpoint, same RS256 verification                     │
│     · Fulfiller controls this gateway — 401 if JWT is invalid or expired       │
│                                                                                │
│  5. Claim propagation (x-party-id, x-smart-scopes, x-scope)                    │
│                                                                                │
│  6. Routes to backend:                                                         │
│     · endpoint GET /fhir/{resource}                                            │
│     · backend  nginx-proxy:83  /fhir/fulfiller/{resource}                      │
└────────────────────────────┬───────────────────────────────────────────────────┘
                             │  GET /fhir/fulfiller/Task
                             │  X-Party-Id: hospitalp
                             │  X-Smart-Scopes: system/Task.cru ...
                             ▼
┌────────────────────────────────────────────────────────────────────────────────┐
│  nginx-proxy  port 83                                                          │
│                                                                                │
│  7. proxy_pass → hapi-fhir:8080                                                │
│                                                                                │
│  8. Response body rewriting (sub_filter, streaming)                            │
│     · Replaces ALL occurrences:                                                │
│       "http://localhost:8090/fhir/fulfiller/"                                  │
│       → "http://localhost:8083/fhir/"                                          │
│     · Self-links now point to krakend-fulfiller-external's base URL            │
└────────────────────────────┬───────────────────────────────────────────────────┘
                             │  200 OK  (FHIR Bundle)
                             │  self-links: http://localhost:8083/fhir/Task/...
                             ▼
         ┌───────────────────────────────────────────────────────────────────────┐
         │  nginx-proxy  port 84  (response path)                                │
         │                                                                       │
         │  9. Response body rewriting (sub_filter, streaming)                   │
         │     · Replaces ALL occurrences:                                       │
         │       "http://localhost:8083/fhir/"                                   │
         │       → "http://localhost:8080/proxy/fhir/"                           │
         │     · Self-links now point to krakend-placer's proxy path             │
         └───────────────────────────────────────────────────────────────────────┘
                             │  200 OK  (FHIR Bundle)
                             │  self-links: http://localhost:8080/proxy/fhir/Task/...
                             ▼
         ┌───────────────────────────────────────────────────────────────────────┐
         │  krakend-placer  :8080  (response pass-through, no-op encoding)       │
         └───────────────────────────────────────────────────────────────────────┘
                             │
                             ▼
                     Placer web-app
                     ─────────────
                     Receives Bundle where every self-link is navigable via:
                     http://localhost:8080/proxy/fhir/{resource}/{id}
                     → routed again through krakend-placer → nginx-proxy:84
                       → krakend-fulfiller-external → nginx-proxy:83 → HAPI
```

**Security properties of this flow:**

| Property | Where enforced |
|----------|---------------|
| JWT is valid and not expired | krakend-placer (step 1) |
| Fulfiller controls who can access its data | krakend-fulfiller-external (step 4) |
| Response self-links are navigable by the placer web-app | nginx-proxy:84 (step 9) |
| Placer web-app never needs a direct route to the fulfiller's external gateway | The proxy path is entirely managed by krakend-placer |

The symmetric flow for **Fulfiller web-app reading Placer data** follows the same pattern using `nginx-proxy:85 → krakend-placer-external`. The placer's external gateway additionally enforces the `X-Consent-Id` header for consent-gated access.

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
3. Browser → krakend-placer  (Bearer <JWT>)
4. krakend-placer validates JWT (Keycloak JWKS)
5. krakend-placer routes to nginx-proxy:84  (proxy backend)
6. nginx-proxy:84 forwards to krakend-fulfiller-external
7. krakend-fulfiller-external validates JWT (same Keycloak JWKS — independent check)
8. krakend-fulfiller-external propagates claims as X-* headers
9. krakend-fulfiller-external → nginx-proxy:83 → hapi-fhir (fulfiller partition)
10. nginx-proxy:83 rewrites HAPI self-links → krakend-fulfiller-external base URL
11. nginx-proxy:84 rewrites those → krakend-placer /proxy/fhir/ base URL
12. Browser receives navigable self-links for its own gateway
```

**JWT claims propagated as HTTP headers:**

| JWT Claim | HTTP Header | Example Value |
|-----------|-------------|---------------|
| `party_id` | `X-Party-Id` | `hospitalf` |
| `smart_scopes` | `X-Smart-Scopes` | `system/Task.cru system/Patient.r ...` |
| `tenant` | `X-Tenant` | `fulfiller` |
| `scope` | `X-Scope` | `openid consent:ConsentOrthopedicReferral` |

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
| KrakenD Placer (internal) | http://localhost:8080/__health | `{"status":"ok"}` |
| KrakenD Placer (external) | http://localhost:8081/__health | `{"status":"ok"}` |
| KrakenD Fulfiller (internal) | http://localhost:8082/__health | `{"status":"ok"}` |
| KrakenD Fulfiller (external) | http://localhost:8083/__health | `{"status":"ok"}` |
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

# KrakenD — two gateways per party (internal + external)
KRAKEND_PLACER_PORT=8080
KRAKEND_PLACER_EXTERNAL_PORT=8081
KRAKEND_FULFILLER_PORT=8082
KRAKEND_FULFILLER_EXTERNAL_PORT=8083

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

4. KrakenD propagates the `scope` claim as `X-Scope` header to all backends
5. OPA extracts the consent ID from `X-Scope` for fine-grained policy enforcement

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

### KrakenD API Gateways

**Configs:**
- `services/krakend-placer/krakend.json` (internal, port 8080)
- `services/krakend-placer-external/krakend.json` (external, port 8081)
- `services/krakend-fulfiller/krakend.json` (internal, port 8082)
- `services/krakend-fulfiller-external/krakend.json` (external, port 8083)

All four gateways use the same JWT validation configuration:

```json
"auth/validator": {
  "alg": "RS256",
  "jwk_url": "http://keycloak:8080/realms/umzh-connect/protocol/openid-connect/certs",
  "issuer": "http://localhost:8180/realms/umzh-connect",
  "disable_jwk_security": true,
  "cache": true
}
```

#### Full Endpoint Reference — Placer Internal Gateway (`:8080`)

| Category | Endpoint | Method | Backend host | Backend path | Auth | Propagates |
|----------|----------|--------|-------------|--------------|------|------------|
| Metadata | `/fhir/metadata` | GET | `nginx-proxy:80` | `/fhir/placer/metadata` | None | — |
| 1 – Internal | `/fhir/{resource}` | GET, POST | `nginx-proxy:80` | `/fhir/placer/{resource}` | JWT | — |
| 1 – Internal | `/fhir/{resource}/{id}` | GET, PUT | `nginx-proxy:80` | `/fhir/placer/{resource}/{id}` | JWT | — |
| 3 – Proxy | `/proxy/fhir/{resource}` | GET | `nginx-proxy:84` | `/fhir/{resource}` | JWT | — |
| 3 – Proxy | `/proxy/fhir/{resource}/{id}` | GET | `nginx-proxy:84` | `/fhir/{resource}/{id}` | JWT | — |
| 4 – Actions | `/api/actions/create-referral` | POST | `nginx-proxy:80` | `/fhir/placer` | JWT | — |
| 4 – Actions | `/api/actions/create-task` | POST | `krakend-fulfiller-external:8080` | `/fhir/Task` | JWT | party_id, smart_scopes, scope |
| 4 – Actions | `/api/actions/all-tasks` | GET | `nginx-proxy:80` + `krakend-fulfiller-external:8080` | `/fhir/placer/Task` + `/fhir/Task` | JWT | party_id, smart_scopes, scope |
| 4 – Policy | `/api/policy/check` | POST | `opa-placer:8181` | `/v1/data/umzh/authz/allow` | None | — |

#### Full Endpoint Reference — Placer External Gateway (`:8081`)

| Endpoint | Method | Backend host | Backend path | Auth | Propagates |
|----------|--------|-------------|--------------|------|------------|
| `/fhir/{resource}` | GET | `nginx-proxy:81` | `/fhir/placer/{resource}` | JWT | party_id, smart_scopes, tenant, scope |
| `/fhir/{resource}/{id}` | GET | `nginx-proxy:81` | `/fhir/placer/{resource}/{id}` | JWT | party_id, smart_scopes, tenant, scope |
| `/fhir/Task` | POST | `nginx-proxy:81` | `/fhir/placer/Task` | JWT | party_id, smart_scopes, scope |

#### Full Endpoint Reference — Fulfiller Internal Gateway (`:8082`)

| Category | Endpoint | Method | Backend host | Backend path | Auth | Propagates |
|----------|----------|--------|-------------|--------------|------|------------|
| Metadata | `/fhir/metadata` | GET | `nginx-proxy:82` | `/fhir/fulfiller/metadata` | None | — |
| 1 – Internal | `/fhir/{resource}` | GET, POST | `nginx-proxy:82` | `/fhir/fulfiller/{resource}` | JWT | — |
| 1 – Internal | `/fhir/{resource}/{id}` | GET, PUT | `nginx-proxy:82` | `/fhir/fulfiller/{resource}/{id}` | JWT | — |
| 3 – Proxy | `/proxy/fhir/{resource}` | GET | `nginx-proxy:85` | `/fhir/{resource}` | JWT | party_id, smart_scopes, tenant, scope |
| 3 – Proxy | `/proxy/fhir/{resource}/{id}` | GET | `nginx-proxy:85` | `/fhir/{resource}/{id}` | JWT | party_id, smart_scopes, tenant, scope |
| 4 – Actions | `/api/actions/create-task` | POST | `krakend-placer-external:8080` | `/fhir/Task` | JWT | party_id, smart_scopes, scope |
| 4 – Actions | `/api/actions/all-tasks` | GET | `nginx-proxy:82` + `krakend-placer-external:8080` | `/fhir/fulfiller/Task` + `/fhir/Task` | JWT | party_id, smart_scopes, scope |
| 4 – Policy | `/api/policy/check` | POST | `opa-fulfiller:8181` | `/v1/data/umzh/authz/allow` | None | — |

#### Full Endpoint Reference — Fulfiller External Gateway (`:8083`)

| Endpoint | Method | Backend host | Backend path | Auth | Propagates |
|----------|--------|-------------|--------------|------|------------|
| `/fhir/{resource}` | GET | `nginx-proxy:83` | `/fhir/fulfiller/{resource}` | JWT | party_id, smart_scopes, scope |
| `/fhir/{resource}/{id}` | GET | `nginx-proxy:83` | `/fhir/fulfiller/{resource}/{id}` | JWT | party_id, smart_scopes, scope |
| `/fhir/Task` | POST | `nginx-proxy:83` | `/fhir/fulfiller/Task` | JWT | party_id, smart_scopes, scope |
| `/fhir/Task/{id}` | PUT | `nginx-proxy:83` | `/fhir/fulfiller/Task/{id}` | JWT | — |

---

### OPA Policy Engine

**Policy files:** `services/opa/policies/main.rego`
**Package:** `umzh.authz`
**OPA version:** 0.70.0 (Rego v1 syntax with `import rego.v1`)

Each party has its own OPA instance (opa-placer, opa-fulfiller) loaded with the same policy. The policy enforces consent-centric access control by evaluating:
> *"Does the requesting party hold a valid consent that covers the requested resource?"*

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
  "consent":    null
}
```

#### Authorization Rules

| Rule | Condition | Notes |
|------|-----------|-------|
| **1 – Task** | `resource_type == "Task"` + SMART scope | Owner-based, no consent check |
| **2 – QuestionnaireResponse** | `resource_type == "QuestionnaireResponse"` + SMART scope | No consent check |
| **3 – Questionnaire read** | `resource_type == "Questionnaire"` + GET + SMART scope | No consent check |
| **4 – Clinical resource read** | GET + SMART scope + `valid_consent` + `resource_in_consent_scope` | Requires valid consent |
| **5 – Metadata** | `path == "/fhir/metadata"` | Always allowed |
| **6 – Directory** | GET + `Organization \| Practitioner \| PractitionerRole` + SMART scope | No consent check |

#### `effective_consent_id` Helper

```rego
# Priority 1: explicit consent_id field in the request body
effective_consent_id := input.consent_id if {
    input.consent_id != ""
}

# Priority 2: extract from JWT scope claim (consent:<id> dynamic scope)
effective_consent_id := id if {
    input.consent_id == ""
    scope_parts := split(input.token.scope, " ")
    some part in scope_parts
    startswith(part, "consent:")
    id := substring(part, count("consent:"), -1)
    id != ""
}
```

#### OPA Endpoints

Both OPA instances expose the same HTTP API on their respective ports (8181/8182):

| Endpoint | Returns | Use case |
|----------|---------|----------|
| `POST /v1/data/umzh/authz/allow` | `{ "result": true \| false }` | Simple boolean — used by KrakenD proxy |
| `POST /v1/data/umzh/authz/decision` | Full decision object | Debug, audit, explicit policy check |
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
      "consent": null
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
- `urn:umzh:api:external-host` — the base URL of the party's external KrakenD gateway

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
# (krakend-placer → nginx-proxy:84 → krakend-fulfiller-external → HAPI)
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

## Development

### Local Web App Development

```bash
cd web-app
npm install
npm run dev          # Hot-reload dev server at http://localhost:3000
npx tsc --noEmit     # Type check without building
npm run build        # Production build
```

The Vite dev proxy forwards `/fhir*`, `/proxy*`, `/api*` to KrakenD at port 8080.

### Rebuild a Single Service

```bash
# Rebuild and restart just the web app
docker compose up -d --build web-app

# Re-seed FHIR data (requires fresh HAPI FHIR)
docker compose up -d --build seed-loader

# Reload KrakenD config without rebuilding (config is volume-mounted)
docker compose restart krakend-placer krakend-fulfiller krakend-placer-external krakend-fulfiller-external

# Reload nginx-proxy config
docker compose restart nginx-proxy

# Reload OPA policy (policies/ is volume-mounted — restart picks up changes)
docker compose restart opa-placer opa-fulfiller
```

### Logs

```bash
docker compose logs -f                             # All services
docker compose logs -f krakend-placer             # Placer internal gateway
docker compose logs -f krakend-placer-external    # Placer external gateway
docker compose logs -f krakend-fulfiller          # Fulfiller internal gateway
docker compose logs -f krakend-fulfiller-external # Fulfiller external gateway
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
│   │   └── nginx.conf              # 6 server blocks (ports 80–85), one sub_filter each
│   │                               # Ports 80–83: HAPI self-link rewriting per gateway
│   │                               # Ports 84–85: rewriting proxy to external gateways
│   │
│   ├── krakend-placer/
│   │   └── krakend.json            # Placer internal gateway (port 8080)
│   │                               # Categories 1, 3, 4 — own + proxy + actions
│   │
│   ├── krakend-placer-external/
│   │   └── krakend.json            # Placer external gateway (port 8081)
│   │                               # Category 2 — Fulfiller reads/writes Placer data
│   │
│   ├── krakend-fulfiller/
│   │   └── krakend.json            # Fulfiller internal gateway (port 8082)
│   │                               # Categories 1, 3, 4 — own + proxy + actions
│   │
│   ├── krakend-fulfiller-external/
│   │   └── krakend.json            # Fulfiller external gateway (port 8083)
│   │                               # Category 2 — Placer reads/writes Fulfiller data
│   │
│   ├── opa/
│   │   └── policies/
│   │       └── main.rego           # Consent-centric authz (6 rules, effective_consent_id)
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
