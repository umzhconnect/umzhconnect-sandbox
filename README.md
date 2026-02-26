# UMZH-Connect COW Sandbox

Reference implementation of the **Clinical Order Workflow (COW)** between two healthcare parties
(PartyA/Placer and PartyB/Fulfiller) as defined in the
[UMZH-Connect FHIR IG](https://build.fhir.org/ig/umzhconnect/umzhconnect-ig/).

---

## Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                    Browser (React SPA)                        │
│          OIDC/PKCE login via keycloak-js                     │
└──────────────────────┬──────────────────────────────────────┘
                       │ HTTP (JWT)
                       ▼
┌─────────────────────────────────────────────────────────────┐
│               FastAPI BFF (port 8000)                        │
│  /auth  /fhir  /workflow  /onboarding  /trust-bundle        │
│  ↳ client credentials cached server-side                    │
│  ↳ protocol log middleware                                   │
└───────┬──────────────────────────────┬───────────────────────┘
        │                              │
        ▼                              ▼
┌───────────────┐              ┌───────────────┐
│  KrakenD-A    │              │  KrakenD-B    │
│  (port 8484)  │              │  (port 8485)  │
│  partyA GW    │              │  partyB GW    │
│  JWT validate │              │  JWT validate │
└───────┬───────┘              └───────┬───────┘
        │ OPA check                    │ OPA check
        ▼                              ▼
┌───────────────┐              ┌───────────────┐
│   OPA-A       │              │   OPA-B       │
│  (port 8181)  │              │  (port 8182)  │
│  consent pol. │              │  consent pol. │
└───────────────┘              └───────────────┘
        │                              │
        └──────────────┬───────────────┘
                       ▼
┌─────────────────────────────────────────────────────────────┐
│              HAPI FHIR (port 8282)                           │
│  Single instance — partitioned (partyA | partyB)            │
│  R4 mode — PostgreSQL backend                               │
└─────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────┐
│                 Keycloak (port 8180)                         │
│  Realm: umzh-sandbox                                        │
│  Clients: frontend-client, placer-client, fulfiller-client  │
│  SMART on FHIR scopes, OIDC discovery                       │
└─────────────────────────────────────────────────────────────┘
```

---

## Quick Start

### Prerequisites

- Docker + Docker Compose v2
- `make` (optional but convenient)

### Start the Stack

```bash
git clone https://github.com/umzhconnect/umzhconnect-sandbox
cd umzhconnect-sandbox

# Copy and review environment config
cp .env.example .env

# Start all services
make up
# or: docker compose up -d --build
```

Wait ~60s for Keycloak to initialize. Then visit:

| Service | URL |
|---|---|
| Frontend (SPA) | http://localhost:3000 |
| Backend API docs | http://localhost:8000/docs |
| Keycloak Admin | http://localhost:8180/admin (admin/admin) |
| HAPI FHIR | http://localhost:8282/fhir/metadata |
| KrakenD PartyA | http://localhost:8484 |
| KrakenD PartyB | http://localhost:8485 |

### Demo Credentials

```
Email:    demo@umzh-sandbox.local
Password: demo
```

Or register a new user at the Keycloak login page.

---

## Clinical Order Workflow Walkthrough

The COW implements this sequence:

```
PartyA (Placer)                    PartyB (Fulfiller)
─────────────────                  ──────────────────
1. Identify patient (Petra Meier)
2. Create ServiceRequest
   (orthopedic referral)
3. Create Consent
   (grants partyB access)
4. Create Task at partyB ────────► 5. Task appears in queue
                                   6. Fetch ServiceRequest
                                      from partyA (cross-party)
                                   7. Review clinical context
                                      (conditions, medications)
                                   8. Create Appointment
                                   9. Update Task → completed
10. Read updated Task ◄────────────
    (sees output reference)
```

### Step-by-Step in the UI

1. Login at http://localhost:3000
2. Click **Initialize Sandbox** — seeds Petra Meier and clinical data
3. **PartyA tab** → select patient → fill ServiceRequest form
4. Create Consent with partyB's organization ID
5. Create Task at partyB
6. Switch to **PartyB tab** → see the Task in queue
7. Click the Task → **Fetch ServiceRequest** → watch OAuth negotiation in Log Panel
8. Update Task status and add output reference
9. Switch back to PartyA → Task shows output

---

## Seed Data

Run manually: `make seed`

PartyA resources:
- `Patient`: Petra Meier (born 1975, Zürich)
- `Practitioner`: Hans Muster
- `Organization`: University Hospital Zurich — Cardiology
- `Condition`: Heart failure HFrEF + Suspected ACL Rupture
- `Medication`: Concor, Entresto
- `MedicationStatement`: active medications

PartyB resources:
- `Organization`: Balgrist — Orthopedics
- `Practitioner`: Anna Schmidt

---

## Makefile Targets

```bash
make up        # Start all services
make down      # Stop all services
make reset     # Full reset (removes volumes)
make seed      # Load FHIR seed data
make logs      # Tail all logs
make test      # Run backend unit tests
make e2e       # Run end-to-end test script
make dev       # Start with hot-reload (dev mode)
```

---

## Security Level Configuration

Set `AUTH_LEVEL` in `.env`:

| Level | Method | How to enable |
|---|---|---|
| 1 | `client_secret_basic` | Default — shared secret in `.env` |
| 2 | `private_key_jwt` | Set `AUTH_LEVEL=2`; register JWKS in Keycloak |
| 3 | mTLS | Set `AUTH_LEVEL=3`; configure KrakenD mTLS |

See [doc/SECURITY.md](doc/SECURITY.md) for details.

---

## Repository Structure

```
cow-sandbox/
├── docker-compose.yml          # Full stack (10 services)
├── docker-compose.dev.yml      # Dev overrides (hot-reload)
├── .env.example                # Environment variable template
├── Makefile                    # Convenience targets
├── infrastructure/
│   ├── keycloak/
│   │   └── realm-export.json  # Realm config (auto-imported)
│   ├── hapi-fhir/
│   │   └── application.yaml   # HAPI config (partitioning)
│   ├── krakend/
│   │   ├── krakend-a.json     # partyA gateway
│   │   └── krakend-b.json     # partyB gateway
│   └── opa/
│       ├── policy.rego        # Consent-based authorization
│       └── data.json          # Static policy data
├── services/
│   ├── backend/               # FastAPI BFF
│   └── frontend/              # React + TypeScript SPA
├── scripts/
│   └── e2e_test.sh            # End-to-end test script
├── k8s/                       # Kubernetes manifests
└── doc/                       # Specification documents
```

---

## FHIR Resources & SMART Scopes

| Resource | Party | Scope |
|---|---|---|
| `Patient` | A | `system/Patient.r` |
| `ServiceRequest` | A | `system/ServiceRequest.cruds` |
| `Consent` | A | `system/Consent.cruds` |
| `Task` | B | `system/Task.cruds` |
| `Condition` | A | `system/Condition.r` |
| `Medication` | A | `system/Medication.r` |
| `Appointment` | B | `system/Appointment.cruds` |

---

## License

MIT — See LICENSE for details.
