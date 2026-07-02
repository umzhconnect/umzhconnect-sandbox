# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

### Web App (TypeScript/React)
```bash
cd web-app
npm run dev          # Hot-reload dev server on http://localhost:3000
npm run build        # Production build with Vite
npm run lint         # ESLint
npx tsc --noEmit     # Type check
```

### Full Stack (Docker Compose)
```bash
docker compose up -d --build          # Start all services
docker compose restart <service>      # Reload config without rebuild
docker compose down -v                # Stop and wipe all volumes
docker compose logs -f <service>      # Follow logs
```

### Integration Tests (Hurl)
```bash
./tests/scripts/run-tests.sh          # Run all tests with L1 (client_secret)
./tests/scripts/run-tests.sh -l2      # Same tests using L2 (private_key_jwt) tokens
```

To run a single test file, acquire a token first and then use hurl directly.
`get-token.sh` acquires a token for either level (L2 signs a `private_key_jwt`
assertion locally):
```bash
TOKEN=$(./tests/scripts/get-token.sh placer)        # or: placer-l2 for private_key_jwt

hurl --test \
  --variable "placer_url=http://localhost:8080" \
  --variable "fulfiller_url=http://localhost:8082" \
  --variable "placer_token=$TOKEN" \
  tests/hurl/05-cross-party-context.hurl
```

## Architecture

This is a reference implementation of a two-party healthcare order workflow (Placer and Fulfiller hospitals) using FHIR R4, OAuth2/SMART on FHIR, and consent-centric authorization.

### Services

| Service | Technology | Purpose |
|---------|-----------|---------|
| `web-app` | React 18 + TypeScript + Vite | Dual-role SPA (switch Placer/Fulfiller in UI) |
| `hapi-fhir` | HAPI FHIR v8.10.0 | Single FHIR server with URL-based multi-tenancy |
| `keycloak` | Keycloak 25.0 | OAuth2/OIDC authorization server |
| `apisix-placer-internal` / `apisix-fulfiller-internal` | APISIX 3.9.0 | Internal gateways (ports 8080/8082) for own web-app |
| `apisix-placer-external` / `apisix-fulfiller-external` | APISIX 3.9.0 | External gateways (ports 8081/8083) for cross-party access |
| `opa-placer` / `opa-fulfiller` | OPA 0.70.0 | Consent-based policy enforcement (Rego) |
| `nginx-proxy` | nginx:alpine | Self-link URL rewriting (ports 80–84); port 84 = public registry gateway |
| `admin-api` | Node.js | Admin HTTP API (port 9000): reseed FHIR data + self-service user/M2M-client onboarding |
| `postgres` | PostgreSQL 16 | Shared DB for HAPI FHIR + Keycloak |

### Dual-Gateway Pattern

Each hospital runs two APISIX gateways (standalone mode — YAML config, hot-reloaded):
- **Internal gateway**: Used by the party's own web-app; serves only the party's own FHIR partition (JWT + realm-role). It does **not** proxy cross-party traffic.
- **External gateway**: Exposed to the partner hospital; enforces OPA consent policies on every read

Cross-party calls are made **directly by the web-app** to the partner's external
gateway. The web-app signs its own L2 `private_key_jwt` assertion in-browser
(Web Crypto, using the keys at `/l2-keys/`), exchanges it at Keycloak for an M2M
token (with `authorization_details` = the ServiceRequest fhirContext when reading
clinical data), and calls the partner external gateway with that bearer. There is
no internal-gateway proxy, no `/proxy/*` routes, and no `/api/actions/*`
orchestration endpoints.

### FHIR Multi-Tenancy

Single HAPI instance with URL-based partitioning:
- `/fhir/placer/` → HospitalP partition
- `/fhir/fulfiller/` → HospitalF partition
- `/fhir/registry/` → mCSD registry partition (public, no auth — served via nginx port 84 → host port 8084)

Organization resources live only in the registry partition. Both party partitions reference Organizations via absolute registry URLs (`__REGISTRY_URL__/fhir/Organization/HospitalX`). Cross-partition references use absolute URLs configured at seed time via environment variable substitution.

### URL Rewriting Chain

HAPI embeds `http://localhost:8090/...` in self-links (internal Docker address). nginx-proxy rewrites these on ports 80–83 to the correct APISIX gateway URLs using `sub_filter`. Partner references in stored resources are absolute partner-external URLs and are left as-is, so the web-app calls them directly.

### Security Model

1. JWT validation (RS256, Keycloak JWKS) at both internal and external gateways
2. fhirContext-gated reads at external gateways via OPA sequential proxy
3. SMART on FHIR system scopes in M2M tokens
4. Cross-party requests carry an M2M JWT minted by the calling web-app (or workflow engine), validated at the partner's external gateway

APISIX policy enforcement uses the built-in `opa` plugin plus three custom Lua plugins (`services/apisix/plugins/`):
- `umzh-role-check` — enforces realm role on internal gateway routes
- `umzh-task-requester-inject` — injects `requester=<organization_reference>` on the external gateway's Task search, so a caller only sees Tasks it requested
- `umzh-capability-guard` — deny-by-default allowlist of query params, `_include` values, and (on PATCH routes) JSON-Patch `patchable_fields` per external-gateway route, derived from the IG CapabilityStatement

OPA policies are in `services/opa/policies/`.

### Key Configuration

- `.env` — ports, credentials, OAuth client secrets, gateway URLs
- `docker-compose.yml` — all service definitions with env-var substitution
- `services/apisix/{placer,fulfiller}-{internal,external}/apisix.yaml` — route + plugin config per gateway instance
- `services/apisix/{placer,fulfiller}-{internal,external}/config.yaml` — APISIX global config (plugin list, nginx snippets)
- `services/opa/config-{placer,fulfiller}.json` — per-party OPA data (fhir_base, required_role) read by `apisix.rego`
- `services/keycloak/realm-export.json` — full realm config including `consent:*` dynamic scopes
- `services/hapi-fhir/application.yaml` — FHIR R4 multitenancy, partitioning, CORS

### Default Credentials

Web App users: `placer-user/placer123`, `fulfiller-user/fulfiller123`, `admin-user/admin123`  
M2M clients L1 (shared secret): `placer-client/placer-secret-2025`, `fulfiller-client/fulfiller-secret-2025`  
M2M clients L2 (private_key_jwt): `placer-client-l2`, `fulfiller-client-l2` — demo private keys committed at `services/keys/`; matching JWK Sets exposed by each party's external APISIX gateway at `http://localhost:8081/jwks.json` (placer) and `http://localhost:8083/jwks.json` (fulfiller), and Keycloak fetches them via each L2 client's `jwks.url` attribute  
Keycloak admin: `admin/admin` at http://localhost:8180/admin

### Service URLs

- Web App: http://localhost:3000
- HAPI FHIR direct: http://localhost:8090
- Placer internal/external: http://localhost:8080 / :8081
- Fulfiller internal/external: http://localhost:8082 / :8083
- Registry (public): http://localhost:8084
- Placer/Fulfiller L2 JWKS: http://localhost:8081/jwks.json / :8083/jwks.json (served by the external gateways)
- OPA Placer/Fulfiller: http://localhost:8181 / :8182
- Admin API (reseed + onboarding): http://localhost:9000

### Test Suite

Tests are Hurl plain-text HTTP files in `tests/hurl/`. Files prefixed `0N-` run in order. The test runner (`tests/scripts/run-tests.sh`) waits for services, acquires Keycloak tokens (both L1 and L2), and executes each file, writing JUnit XML to `tests/reports/`. Pass `-l2` to run all tests using L2 tokens instead of L1.
