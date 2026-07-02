# Deployment Guide — UMZH Connect Sandbox on Infomaniak VPS

This guide covers deploying the full two-party sandbox to an Ubuntu VPS at
Infomaniak with Caddy as the TLS-terminating reverse proxy.

## Subdomain plan

The browser SPA makes direct calls to both the internal and external APISIX
gateways for each party, so eight public subdomains are required (you specified
four — the gateway and admin subdomains below are the additional ones needed):

| Subdomain | Service | Local port |
|-----------|---------|-----------|
| `sandbox.umzh-connect.ch` | Web app (SPA) | 3000 |
| `auth.sandbox.umzh-connect.ch` | Keycloak | 8180 |
| `registry.sandbox.umzh-connect.ch` | Registry (public mCSD, no auth) | 8084 |
| `admin.sandbox.umzh-connect.ch` | Admin API (reseed + onboarding, admin-token gated) | 9000 |
| `placer.sandbox.umzh-connect.ch` | Placer external gateway (cross-party) | 8081 |
| `placer-int.sandbox.umzh-connect.ch` | Placer internal gateway (own-party FHIR) | 8080 |
| `fulfiller.sandbox.umzh-connect.ch` | Fulfiller external gateway (cross-party) | 8083 |
| `fulfiller-int.sandbox.umzh-connect.ch` | Fulfiller internal gateway (own-party FHIR) | 8082 |

## 1. DNS

At Infomaniak's DNS console for `umzh-connect.ch`, create an A record for each
subdomain pointing to the VPS public IP. A wildcard covers all eight with a
single record:

```
*.sandbox    A    <VPS_PUBLIC_IP>    TTL 300
sandbox      A    <VPS_PUBLIC_IP>    TTL 300
```

Verify before continuing:

```bash
dig +short sandbox.umzh-connect.ch
dig +short auth.sandbox.umzh-connect.ch
```

## 2. VPS provisioning

Tested on Ubuntu 22.04 LTS. Minimum recommended: 4 vCPU, 8 GB RAM, 40 GB SSD.

### Install Docker

```bash
curl -fsSL https://get.docker.com | sh
sudo usermod -aG docker $USER
# Log out and back in so group membership takes effect
```

Confirm Compose and the build toolchain. Docker Compose **v5** removed its
internal builder and delegates `build` to **Docker Buildx / Bake**, so a working
`buildx` plugin is required for `docker compose ... up -d --build`:

```bash
docker compose version     # expect v2.24+ (v5.x recommended)
docker buildx version      # must print a version — buildx/bake backend for builds
docker buildx bake --help  # confirms the bake command resolves
```

The `get.docker.com` script installs `docker-buildx-plugin` already. If
`docker buildx version` reports "not a docker command", install it and retry:

```bash
sudo apt install -y docker-buildx-plugin
```

### Install Caddy

```bash
sudo apt install -y debian-keyring debian-archive-keyring apt-transport-https curl
curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/gpg.key' \
  | sudo gpg --dearmor -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt' \
  | sudo tee /etc/apt/sources.list.d/caddy-stable.list
sudo apt update && sudo apt install caddy
```

### Open firewall ports

```bash
sudo ufw allow 22/tcp    # SSH
sudo ufw allow 80/tcp    # HTTP (Caddy ACME challenge + redirect)
sudo ufw allow 443/tcp   # HTTPS
sudo ufw enable
```

## 3. Clone the repository

```bash
cd /opt
sudo git clone <repo-url> umzhconnect-sandbox
sudo chown -R $USER:$USER umzhconnect-sandbox
cd umzhconnect-sandbox
```

## 4. Environment configuration

### 4a. Create `.env`

Copy the production template and fill in strong passwords/secrets:

```bash
cp deployment/.env.prod.example .env
nano .env   # replace all <CHANGE_ME> values
```

Key values that differ from local dev:

```dotenv
VITE_KEYCLOAK_URL=https://auth.sandbox.umzh-connect.ch
VITE_PLACER_URL=https://placer-int.sandbox.umzh-connect.ch
VITE_PLACER_EXTERNAL_URL=https://placer.sandbox.umzh-connect.ch
VITE_FULFILLER_URL=https://fulfiller-int.sandbox.umzh-connect.ch
VITE_FULFILLER_EXTERNAL_URL=https://fulfiller.sandbox.umzh-connect.ch
VITE_REGISTRY_URL=https://registry.sandbox.umzh-connect.ch
VITE_ADMIN_API_URL=https://admin.sandbox.umzh-connect.ch
```

The `seed-loader` and `admin-api` read the `VITE_*_EXTERNAL_URL` variables at
start-up to embed the correct absolute references in FHIR resources (Organization
cross-references, Task.requester, etc.). They must be the public HTTPS URLs.

### 4b. nginx-proxy self-link rewriting — no action needed

`services/nginx-proxy/templates/servers.conf.template` uses `${VITE_*}` placeholders
that are resolved by `envsubst` when the container starts. The `VITE_*` values you
set in `.env` above are passed automatically to the nginx-proxy container via
`docker-compose.yml`, so self-link rewriting uses the correct public HTTPS URLs
without any file edits.

### 4c. Keycloak realm values — driven by `.env`

`services/keycloak/realm-export.json` no longer hardcodes deployment-specific
values. It uses Keycloak's native `${VAR:default}` placeholder substitution,
resolved from the container environment **at realm-import time**:

| Realm field(s) | Placeholder | `.env` variable |
|----------------|-------------|-----------------|
| web-app `rootUrl`, `redirectUris`, all clients' `webOrigins` | `${WEB_APP_PUBLIC_URL:http://localhost:3000}` | `WEB_APP_PUBLIC_URL` |
| `placer-client` secret | `${PLACER_CLIENT_SECRET:…}` | `PLACER_CLIENT_SECRET` |
| `fulfiller-client` secret | `${FULFILLER_CLIENT_SECRET:…}` | `FULFILLER_CLIENT_SECRET` |
| `placer/fulfiller/admin-user` passwords | `${*_USER_PASSWORD:…}` | `PLACER_USER_PASSWORD`, `FULFILLER_USER_PASSWORD`, `ADMIN_USER_PASSWORD` |
| `placer/fulfiller-client-l2` `jwks.url` | `${*_JWKS_URL:http://apisix-*-external:9080/jwks.json}` | `PLACER_JWKS_URL`, `FULFILLER_JWKS_URL` |

These variables are passed to the Keycloak container in `docker-compose.yml`, so
setting them in `.env` is all that's required — no edits to the realm file. The
`:default` after each placeholder reproduces the original local-dev value when a
variable is unset. Set `WEB_APP_PUBLIC_URL=https://sandbox.umzh-connect.ch` (and
strong secrets/passwords) in your production `.env`.

The L2 (`private_key_jwt`) clients authenticate by a signed assertion that
Keycloak verifies against each party's **public** JWK Set. Locally the default is
the internal Docker address (`http://apisix-*-external:9080/jwks.json`); in a
deployed scenario set the public partner subdomains so Keycloak fetches over
HTTPS — mirroring a real cross-org federation where each party hosts its own
JWKS:

```dotenv
PLACER_JWKS_URL=https://placer.sandbox.umzh-connect.ch/jwks.json
FULFILLER_JWKS_URL=https://fulfiller.sandbox.umzh-connect.ch/jwks.json
```

> Substitution happens **only at import time** (i.e. when the realm does not yet
> exist). Changing one of these later means re-importing the realm — see Section
> 10.

The custom `umzh-fhir-context-mapper` referenced by the realm is built by the
`keycloak-mapper-build` step into `services/keycloak/providers/` before Keycloak
starts, so the import resolves it automatically.

## 5. Caddy configuration

Copy the Caddyfile to the system location and reload:

```bash
sudo cp deployment/Caddyfile /etc/caddy/Caddyfile
sudo caddy validate --config /etc/caddy/Caddyfile
sudo systemctl reload caddy
```

Caddy will obtain a Let's Encrypt certificate for each subdomain on first
request. Ensure DNS is resolving to the VPS before reloading Caddy.

## 6. Start the stack

Use the production compose overlay, which sets the public Keycloak hostname,
the correct `private_key_jwt` audience for the key custodians, and — critically
— rebinds every Docker port to `127.0.0.1` so that only Caddy (running on the
host) can reach them. Without the overlay, Docker binds to `0.0.0.0`, making
raw HAPI (port 8090), OPA (8181/8182), Postgres (5431), and the key-custodian
ports world-reachable on the VPS, bypassing Caddy and all authentication.

```bash
docker compose \
  -f docker-compose.yml \
  -f deployment/docker-compose.prod.yml \
  up -d --build
```

Watch for readiness:

```bash
docker compose logs -f keycloak      # wait for "Started Keycloak"
docker compose logs -f seed-loader   # wait for "Seed complete"
docker compose logs -f web-app       # wait for nginx to start
```

## 7. Verify the deployment

### Keycloak discovery endpoint

```bash
curl -s https://auth.sandbox.umzh-connect.ch/realms/umzh-connect/.well-known/openid-configuration \
  | python3 -m json.tool | grep issuer
# Should print: "issuer": "https://auth.sandbox.umzh-connect.ch/realms/umzh-connect"
```

### Registry (public, no auth)

```bash
curl -s https://registry.sandbox.umzh-connect.ch/fhir/Organization \
  | python3 -m json.tool | grep '"resourceType"'
# Should print: "resourceType": "Bundle"
```

### FHIR gateway health

```bash
curl -s https://placer.sandbox.umzh-connect.ch/__health
curl -s https://placer-int.sandbox.umzh-connect.ch/__health
curl -s https://fulfiller.sandbox.umzh-connect.ch/__health
curl -s https://fulfiller-int.sandbox.umzh-connect.ch/__health
# Each should return: {"status":"ok"}
```

### Web app

Open `https://sandbox.umzh-connect.ch` in a browser, log in as
`placer-user / placer123`, and confirm the dashboard loads FHIR data.

### Integration tests (from a machine with Hurl installed)

The test scripts can target the VPS. Export the public base URLs and run:

```bash
export PLACER_TOKEN=$(KEYCLOAK_URL=https://auth.sandbox.umzh-connect.ch \
  ./tests/scripts/get-token.sh placer)

hurl --test \
  --variable "placer_url=https://placer-int.sandbox.umzh-connect.ch" \
  --variable "fulfiller_url=https://fulfiller-int.sandbox.umzh-connect.ch" \
  --variable "placer_token=$PLACER_TOKEN" \
  tests/hurl/05-cross-party-context.hurl
```

## 8. Re-seeding

If you need to wipe and reload FHIR data without restarting containers, use the
`admin-api`'s `POST /reseed` route. It is served publicly at
`https://admin.sandbox.umzh-connect.ch` but every privileged route requires a
Keycloak Bearer token with the `admin` realm role, so it is safe to expose:

```bash
ADMIN_TOKEN=$(curl -s \
  -d grant_type=password -d client_id=web-app \
  -d username=admin-user -d "password=$ADMIN_USER_PASSWORD" \
  https://auth.sandbox.umzh-connect.ch/realms/umzh-connect/protocol/openid-connect/token \
  | grep -o '"access_token":"[^"]*"' | cut -d'"' -f4)

curl -X POST https://admin.sandbox.umzh-connect.ch/reseed \
  -H "Authorization: Bearer $ADMIN_TOKEN"
```

If you prefer not to expose it, omit the `admin.` block from the Caddyfile and
reach the service over an SSH tunnel instead:

```bash
ssh -L 9000:localhost:9000 user@<VPS_PUBLIC_IP>
curl -X POST http://localhost:9000/reseed -H "Authorization: Bearer $ADMIN_TOKEN"
```

## 9. Updating the deployment

```bash
git pull
docker compose \
  -f docker-compose.yml \
  -f deployment/docker-compose.prod.yml \
  up -d --build
```

If only configuration files changed (APISIX YAML, OPA Rego, nginx.conf), you
can restart the affected service without a full rebuild:

```bash
docker compose restart nginx-proxy
docker compose restart apisix-placer-internal apisix-placer-external
```

## 10. Keycloak maintenance

Keycloak imports `services/keycloak/realm-export.json` **only when the realm does
not already exist** in its database. The realm is persisted in the `keycloak`
database inside the shared Postgres instance (separate from HAPI FHIR's
`hapi_fhir` database). So on a normal `docker compose restart`, edits to
`realm-export.json` are silently ignored — the realm is already there.

To apply a change you must force a (re-)import. Pick the lightest option that
covers your change.

### Option 1 — Partial import (runtime, no downtime)

**Use when:** you added or changed individual **clients, roles, client scopes,
groups, users, or identity providers** and want them applied without disturbing
anything else (onboarded clients, self-registered users, and active sessions all
survive).

```bash
docker compose exec keycloak sh -c '
  /opt/keycloak/bin/kcadm.sh config credentials \
    --server http://localhost:8080 --realm master \
    --user "$KEYCLOAK_ADMIN" --password "$KEYCLOAK_ADMIN_PASSWORD" &&
  /opt/keycloak/bin/kcadm.sh create partialImport -r umzh-connect \
    -f /opt/keycloak/data/import/realm-export.json \
    -s ifResourceExists=OVERWRITE
'
```

**What partial import does:** it reads the resource *collections* from the supplied
realm JSON (`clients`, `roles`, `clientScopes`, `groups`, `users`,
`identityProviders`) and merges them into the **existing** realm — the realm is
never deleted or recreated. Each resource is reconciled according to
`ifResourceExists`:

| `ifResourceExists` | Resource already present | Resource is new |
|--------------------|--------------------------|-----------------|
| `FAIL`             | abort the whole import   | created |
| `SKIP`             | left unchanged           | created |
| `OVERWRITE`        | replaced with the file's version | created |

`OVERWRITE` (above) makes the import idempotent for the resources in the file.
Resources **not** listed in the file are never touched, and resources that exist
only at runtime (onboarded M2M clients, registered users) are preserved.

**Limitation:** partial import only covers those resource collections. It does
**not** apply **realm-level settings** — token lifespans, SSL/`sslRequired`,
login/registration flags, password policy, smtp, etc. For those, use Option 2.

### Option 2 — Delete and re-import the realm (keeps FHIR data)

**Use when:** you changed **realm-level settings**, or you simply want a
guaranteed clean re-import of the whole realm from the file. This rebuilds the
realm from scratch but leaves HAPI FHIR's `hapi_fhir` database completely
untouched.

```bash
docker compose exec keycloak sh -c '
  /opt/keycloak/bin/kcadm.sh config credentials \
    --server http://localhost:8080 --realm master \
    --user "$KEYCLOAK_ADMIN" --password "$KEYCLOAK_ADMIN_PASSWORD" &&
  /opt/keycloak/bin/kcadm.sh delete realms/umzh-connect
'
docker compose restart keycloak     # empty of the realm → --import-realm re-imports it
docker compose up seed-loader       # re-apply env-driven user passwords (see below)
```

**Destroys:** everything that lived only in that realm — onboarded M2M clients,
self-registered users, and active sessions. **Preserves:** all FHIR data.

> After the re-import the three demo users carry the passwords hardcoded in
> `realm-export.json`, not your `.env` values, until the seed loader re-runs —
> hence the `docker compose up seed-loader` line. See *What the seed loader does
> to Keycloak* below.

### Option 3 — Full reset (`down -v`)

**Use when:** you want a total clean slate — both the Keycloak realm **and** all
FHIR data, plus the admin-api ledger. This wipes the `postgres_data` volume
(Keycloak + HAPI FHIR) and `admin_data`.

```bash
docker compose -f docker-compose.yml -f deployment/docker-compose.prod.yml down -v
docker compose -f docker-compose.yml -f deployment/docker-compose.prod.yml up -d --build
```

This is the heaviest option. Do not reach for it just to pick up a realm edit —
that is what Options 1 and 2 are for.

### What the seed loader does to Keycloak

The `seed-loader` (the `seed.sh` init container) touches Keycloak in exactly one
step (step 8). It authenticates to the **master** realm with the `admin-cli`
client using `KEYCLOAK_ADMIN` / `KEYCLOAK_ADMIN_PASSWORD` (password grant), then
for three pre-existing users resets the password via the admin REST API:

| User | Password source (`.env`) |
|------|--------------------------|
| `placer-user`    | `PLACER_USER_PASSWORD` |
| `fulfiller-user` | `FULFILLER_USER_PASSWORD` |
| `admin-user`     | `ADMIN_USER_PASSWORD` |

- **Created:** nothing. The seed loader never creates users, roles, clients, or
  scopes — those come **exclusively** from `realm-export.json` at import time.
- **Overwritten:** only the three users' passwords (a full credential replace,
  `temporary=false`).
- **Merged:** nothing — there is no field merging. If one of the three users does
  not exist, it logs a warning and skips it (it will not create the user).

This step exists so real passwords can come from `.env` instead of living in the
committed realm file. It runs once at stack startup; re-run it with
`docker compose up seed-loader` after any realm re-import (Options 2 and 3).

## 11. FHIR seed data

Steps 1–7 of the same `seed-loader` populate HAPI FHIR. It talks **directly** to
HAPI on the Docker network (`http://hapi-fhir:8080/fhir`), bypassing the APISIX
gateways, so no token is required for the writes.

### How it loads

1. **Wait for readiness** — polls `GET /fhir/DEFAULT/metadata` until HAPI answers.
2. **Create partitions** — `id 1 = placer`, `id 2 = fulfiller`, `id 3 = registry`
   via `$partition-management-create-partition`. **Idempotent:** an HTTP `409`
   (or `400 … already defined`) is treated as "already exists, skip" — existing
   partitions are never recreated or altered.
3. **Load four bundles**, one per partition, with placeholder substitution on the
   three party bundles (`__PLACER_EXTERNAL_URL__`, `__FULFILLER_EXTERNAL_URL__`,
   `__REGISTRY_URL__` → the `VITE_*_EXTERNAL_URL` values) so absolute
   cross-partition references resolve to the public gateway URLs:

   | Bundle | Target partition |
   |--------|------------------|
   | `shared-bundle.json`    | `/fhir/DEFAULT` (non-partitionable conformance) |
   | `placer-bundle.json`    | `/fhir/placer` |
   | `fulfiller-bundle.json` | `/fhir/fulfiller` |
   | `registry-bundle.json`  | `/fhir/registry` |

4. **Verify** — `GET`s a handful of known resource IDs and prints `OK`/`MISSING`.
   Read-only; changes nothing.

### Created, overwritten, or merged

Every bundle is a FHIR **`transaction`** Bundle and every entry uses
`PUT <ResourceType>/<fixed-id>`. PUT-by-ID is an **upsert**:

- **Created** — if the ID does not yet exist in that partition.
- **Overwritten** — if the ID exists, the resource is **fully replaced** with the
  bundle's version and HAPI increments its version id (`_history`). This is a
  whole-resource replace, **not** a field-level merge: any field absent from the
  bundle is dropped from the new version.
- **Never duplicated** — because IDs are fixed, re-running the loader produces no
  duplicates; it is idempotent.
- **Never deleted** — the loader does not remove resources that are absent from
  the bundles. Resources created at runtime (onboarded `Organization`s, `Task`s
  created in the app, etc.) under different IDs are left untouched.

> This differs from the admin-api `POST /reseed` (Section 8), which **expunges**
> each partition first and therefore *does* drop everything not in the bundles.
> Use the seed loader to top-up/repair base data without losing runtime data; use
> `/reseed` for a clean base-data reset.

### What gets seeded

| Partition | Resources |
|-----------|-----------|
| `DEFAULT`   | `Questionnaire/QuestionnaireSmokingStatus` |
| `placer`    | `Patient/PetraMeier`, `Practitioner/HansMuster`, `PractitionerRole/HansMusterRole`, `Condition/{SuspectedACLRupture, HeartFailureHFrEF, SarcomaKnee}`, `MedicationStatement/{MedicationEntresto, MedicationConcor}`, `Coverage/CoverageMeier`, `AllergyIntolerance/AllergyGado`, `DocumentReference/DocCardiologyAttachment`, `ImagingStudy/{ImagingCT, ImagingPET}`, `ServiceRequest/{ReferralOrthopedicSurgery, ReferralTumorboard}`, `Consent/{ConsentOrthopedicReferral, ConsentTumorboardReferral}` |
| `fulfiller` | `Task/{TaskOrthopedicReferral, TaskInternalLabReview}`, `Appointment/{AppointmentOrthopedicConsultation, AppointmentFulfillerInternal}`, `Consent/ConsentTaskOrthopedicReferral` |
| `registry`  | `Organization/{HospitalP, HospitalF}`, `Endpoint/{EndpointHospitalP, EndpointHospitalF}`, `HealthcareService/{ServiceOrthopedicSurgeryHospitalF, ServiceTumorboardHospitalF}` |

Re-run the whole loader at any time with `docker compose up seed-loader`.

## 12. Using a managed database service

By default the stack runs a bundled `postgres` container and creates the two
databases itself (`keycloak` via `services/postgres/init-databases.sql`,
`hapi_fhir` via `POSTGRES_DB`). On a managed PostgreSQL service you typically
**cannot** run `CREATE DATABASE` / `DROP DATABASE` from the application user, so
that automatic bootstrap does not apply and a few things shift.

The important distinction: you lose **`CREATE DATABASE`**, but Keycloak (Liquibase)
and HAPI FHIR (Hibernate `hbm2ddl.auto: update`) still build and migrate their
own **tables** on first start. That is *in-database* DDL (`CREATE TABLE`,
`CREATE SEQUENCE`, …), which the database **owner** is allowed to do. So the app
users must own their database (or have `CREATE` on the target schema) — only the
cluster-level `CREATE DATABASE` is off-limits.

### 12.1 Provision out-of-band (prerequisite)

Through the provider's console/API, before the first deploy:

1. Create **two databases** — e.g. `keycloak` and `hapi_fhir`.
2. Create a user for each (or one shared user) and make it the **owner** of its
   database, so table migrations succeed.
3. Note the host, port, and whether TLS is enforced (managed services usually
   require `sslmode=require`).

> Single-database providers: if you only get one database, separate the two apps
> by **schema** instead — see 12.4.

`services/postgres/init-databases.sql` is **not used** in this mode (it only ever
ran inside the bundled container).

### 12.2 Configure and deploy

Fill the managed-DB block in `.env` (uncomment it in
`deployment/.env.prod.example`):

```dotenv
DB_HOST=<your-managed-db-host>
DB_PORT=5432
DB_SSLMODE=require
KEYCLOAK_DB_NAME=keycloak
KEYCLOAK_DB_USER=<user>
KEYCLOAK_DB_PASSWORD=<password>
HAPI_DB_NAME=hapi_fhir
HAPI_DB_USER=<user>
HAPI_DB_PASSWORD=<password>
```

Then deploy with the extra overlay. It uses the `!reset` / `!override` YAML tags,
which need Docker Compose **≥ v2.24** (all v5.x qualify — check with
`docker compose version`):

```bash
docker compose \
  -f docker-compose.yml \
  -f deployment/docker-compose.prod.yml \
  -f deployment/docker-compose.managed-db.yml \
  up -d --build
```

`deployment/docker-compose.managed-db.yml` does three things: it parks the
bundled `postgres` service under an inactive profile so it never starts, severs
the `depends_on: postgres` edges from `keycloak` and `hapi-fhir` (a profiled-out
service that something still depends on would otherwise make the whole project
invalid), and points each app at the managed endpoint — `KC_DB_URL` for Keycloak
and `SPRING_DATASOURCE_URL` (Spring relaxed binding, overriding `application.yaml`)
for HAPI FHIR. The `POSTGRES_*` variables become unused.

Verify the merge before deploying — `postgres` must **not** appear in the active
service list:

```bash
docker compose -f docker-compose.yml -f deployment/docker-compose.prod.yml \
  -f deployment/docker-compose.managed-db.yml config --services
```

### 12.3 What changes for reset & maintenance

The database now lives **outside** Docker, so volume-based resets no longer touch
it:

- **`docker compose down -v` no longer wipes the databases.** It only removes
  local named volumes (now just `admin_data`). Keycloak and HAPI data survive a
  full container teardown — which is usually what you want.
- **There is no "nuke everything" via `-v`.** For a clean slate use the logical
  resets instead, which don't need `CREATE/DROP DATABASE`:
  - Keycloak: delete + re-import the realm — Section 10, Option 2 (it uses
    `kcadm`, no Postgres access).
  - FHIR: `POST /reseed` on the admin-api — Section 8 (it expunges the partitions
    in place).
  - If you genuinely need empty databases, ask the provider to drop/recreate them
    (or `TRUNCATE`/drop the schema objects) through their console — the app users
    can't do it.
- **Backups** are the managed service's automated backups / point-in-time
  recovery, replacing any `pg_dump`-of-the-volume scheme. Note this only covers
  the databases; the admin-api ledger in the `admin_data` volume still needs its
  own backup if you rely on it.

### 12.4 Single database, two schemas (variation)

If the provider gives you only one database, run both apps in it under separate
schemas (the owner can `CREATE SCHEMA` even without `CREATE DATABASE`). Point both
at the same `DB_*` database name and add a schema to each connection — Keycloak
via `KC_DB_SCHEMA`, HAPI via the JDBC `currentSchema` parameter:

```yaml
# extra overrides alongside docker-compose.managed-db.yml
services:
  keycloak:
    environment:
      KC_DB_SCHEMA: keycloak
  hapi-fhir:
    environment:
      SPRING_DATASOURCE_URL: "jdbc:postgresql://${DB_HOST}:${DB_PORT}/${HAPI_DB_NAME}?sslmode=${DB_SSLMODE:-require}&currentSchema=hapi"
```

Pre-create the `keycloak` and `hapi` schemas (owned by the app user) so the
migrations have somewhere to build their tables.

## Security notes

**Secrets and keys**

- Change all default passwords in `.env` before first start (Postgres, Keycloak
  admin, client secrets, `ONBOARDING_CLIENT_SECRET`).
- The L2 private keys in `services/keys/` are committed demo material — they are
  intentionally public for sandbox teaching purposes. Do not use these keys in any
  non-sandbox environment.

**Port exposure**

- Always deploy with `deployment/docker-compose.prod.yml`. It rebinds every
  service port to `127.0.0.1`, so raw HAPI, OPA, Postgres, and key-custodian
  ports are only reachable from the host (where Caddy listens). The base
  `docker-compose.yml` binds to `0.0.0.0` for local dev convenience — without
  the prod overlay those ports would be world-open on the VPS.

**Keycloak**

- The Keycloak admin console and admin REST API (`/admin/*`) are blocked at the
  Caddy layer — `auth.sandbox.umzh-connect.ch/admin` returns `403`. If you ever
  need to use the admin UI remotely, do it via an SSH tunnel to `localhost:8180`
  rather than exposing it through Caddy.
- Brute-force protection is enabled in the realm: accounts lock after 10 failures
  with an escalating wait up to 15 minutes. Unlocking requires a Keycloak admin
  action (console or `kcadm`).
- The realm enforces a minimum password policy (`length(12) and notUsername() and
  notEmail()`). This applies to Keycloak's own login form and password-reset flow.
  The admin-api `POST /register` endpoint enforces the same 12-character minimum
  independently before creating the user.

**Admin API**

- The admin API (`admin.sandbox.umzh-connect.ch`, port 9000) is publicly routed
  through Caddy. All privileged routes (`POST /reseed`, `POST /invites`,
  `GET /clients`, `POST /clients`) require a Keycloak Bearer token with the
  `admin` realm role, verified via token introspection on every request.
- `POST /register` is the only unauthenticated route; it is rate-limited to
  2 requests/minute per IP by nginx-proxy (port 85 → admin-api), with a burst
  of 3, and requires a valid single-use invite token.
- CORS on the admin API is restricted to `WEB_APP_PUBLIC_URL`
  (`https://sandbox.umzh-connect.ch`). Cross-origin requests from other origins
  are rejected by the browser.
- Request bodies are capped at 64 KB. Oversized requests are dropped immediately.
- To keep the admin API internal-only, remove the `admin.` block from the
  Caddyfile and access reseed via SSH tunnel (`-L 9000:localhost:9000`).
