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
./tests/scripts/run-tests.sh          # Run all tests (acquires tokens automatically)
```

To run a single test file, acquire a token first and then use hurl directly:
```bash
TOKEN=$(curl -s -X POST http://localhost:8180/realms/umzh-connect/protocol/openid-connect/token \
  -H "Content-Type: application/x-www-form-urlencoded" \
  -d "grant_type=client_credentials&client_id=placer-client&client_secret=placer-secret-2025" \
  | jq -r '.access_token')

hurl --test \
  --variable "placer_url=http://localhost:8080" \
  --variable "fulfiller_url=http://localhost:8082" \
  --variable "placer_token=$TOKEN" \
  tests/hurl/05-cross-party-consent.hurl
```

## Architecture

This is a reference implementation of a two-party healthcare order workflow (Placer and Fulfiller hospitals) using FHIR R4, OAuth2/SMART on FHIR, and consent-centric authorization.

### Services

| Service | Technology | Purpose |
|---------|-----------|---------|
| `web-app` | React 18 + TypeScript + Vite | Dual-role SPA (switch Placer/Fulfiller in UI) |
| `hapi-fhir` | HAPI FHIR v7.4.0 | Single FHIR server with URL-based multi-tenancy |
| `keycloak` | Keycloak 25.0 | OAuth2/OIDC authorization server |
| `apisix-placer-internal` / `apisix-fulfiller-internal` | APISIX 3.9.0 | Internal gateways (ports 8080/8082) for own web-app |
| `apisix-placer-external` / `apisix-fulfiller-external` | APISIX 3.9.0 | External gateways (ports 8081/8083) for cross-party access |
| `opa-placer` / `opa-fulfiller` | OPA 0.70.0 | Consent-based policy enforcement (Rego) |
| `nginx-proxy` | nginx:alpine | Self-link URL rewriting (ports 80–83) |
| `postgres` | PostgreSQL 16 | Shared DB for HAPI FHIR + Keycloak |

### Dual-Gateway Pattern

Each hospital runs two APISIX gateways (standalone mode — YAML config, hot-reloaded):
- **Internal gateway**: Used by the party's own web-app; routes to own FHIR partition and proxies cross-party requests to the partner's external gateway
- **External gateway**: Exposed to the partner hospital; enforces OPA consent policies on every read

### FHIR Multi-Tenancy

Single HAPI instance with URL-based partitioning:
- `/fhir/placer/` → HospitalP partition
- `/fhir/fulfiller/` → HospitalF partition

Cross-partition references use absolute URLs configured at seed time. Resource IDs are partition-scoped (e.g., `Organization/placer-HospitalP`).

### URL Rewriting Chain

HAPI embeds `http://localhost:8090/...` in self-links (internal Docker address). nginx-proxy rewrites these on ports 80–83 to the correct APISIX gateway URLs using `sub_filter`. Cross-party proxy responses are then rewritten by APISIX's `response-rewrite` plugin, translating partner external URLs back to the calling party's `/proxy/fhir/` path.

### Security Model

1. JWT validation (RS256, Keycloak JWKS) at both internal and external gateways
2. Consent-gated reads at external gateways via OPA sequential proxy
3. SMART on FHIR system scopes in M2M tokens
4. Cross-party requests carry two JWTs (validated at each hop)

APISIX policy enforcement uses the built-in `opa` plugin plus a custom `umzh-role-check` Lua plugin (`services/apisix/plugins/`). OPA policies are in `services/opa/policies/`.

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
M2M clients: `placer-client/placer-secret-2025`, `fulfiller-client/fulfiller-secret-2025`  
Keycloak admin: `admin/admin` at http://localhost:8180/admin

### Service URLs

- Web App: http://localhost:3000
- HAPI FHIR direct: http://localhost:8090
- Placer internal/external: http://localhost:8080 / :8081
- Fulfiller internal/external: http://localhost:8082 / :8083
- OPA Placer/Fulfiller: http://localhost:8181 / :8182

### Test Suite

Tests are Hurl plain-text HTTP files in `tests/hurl/`. Files prefixed `0N-` run in order. The test runner (`tests/scripts/run-tests.sh`) waits for services, acquires Keycloak tokens, and executes each file, writing JUnit XML to `tests/reports/`.

