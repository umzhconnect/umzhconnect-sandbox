# party-deployment

Everything **one hospital** runs to be a compatible UMZH Connect ecosystem
partner. Shared infrastructure — the **auth server**, the **mCSD registry**, and
the **partner** itself — is *external* and supplied via `.env`; it is never
deployed here.

This is the single-party decomposition of the two-party sandbox in the repo
root. Service *logic* is referenced from `../services/...` (one source of truth);
only this node's env-specific data is rendered from `.env` at startup.

## What runs here (party-owned)

| Service | Role |
|---|---|
| `apisix-external` | Public face for partners. JWT + OPA fhirContext gate on reads; serves `/jwks.json`. |
| `apisix-internal` | This party's own web-app gateway. Serves only the party's own partition (JWT + realm role). |
| `opa` | Consent / fhirContext policy engine (Rego from `../services/opa/policies`). |
| `hapi-fhir` + `postgres` | The party's FHIR store and its database. |
| `key-custodian` | Holds the party's L2 private key; signs `private_key_jwt` assertions and serves the JWK Set. |
| `kestra` (+ `kestra-flow-loader`) | Workflow engine running the referral-reception flow. The flow-loader image is local (`./kestra-flow-loader`). |
| `nginx-proxy` | Rewrites HAPI self-links to the party's gateway URLs (required for the dual-gateway split). |
| `config-init`, `seed` | One-shot: render env config; create the partition and load the party's bundle. |

### Workflow assets (all party-local)

| Path | What |
|---|---|
| `workflow/` | The Arazzo workflow spec + OpenAPI source descriptions (`umzh-connect-api`, `internal-fhir`, `keycloak-api`) and the BPMN diagram — the design the Kestra flow implements. |
| `flows/referral-reception.yml.template` | The Kestra flow, parameterised by `.env` (rendered by `config-init`). |
| `kestra-flow-loader/` | One-shot image that imports the rendered flow into Kestra on startup. |

## What is external (from `.env`)

| `.env` key | Meaning |
|---|---|
| `AUTH_SERVER_URL` + `AUTH_SERVER_REALM` | The ecosystem OIDC provider. Issues all tokens; the gateways validate against its discovery/JWKS. |
| `PARTNER_EXTERNAL_URL` | The partner hospital's external gateway (cross-party reads/writes go here directly). |
| `REGISTRY_URL` | The shared mCSD Organization/Endpoint registry. |

## Prerequisite: register this party in the auth server

Because the auth server is shared (a steward/central concern), this node assumes
its L2 client already exists there — it deploys **no** Keycloak and no
provisioner. The client (`L2_CLIENT_ID`) must be configured with:

- `clientAuthenticatorType: client-jwt`
- `use.jwks.url = true`
- `jwks.url = <OWN_EXTERNAL_URL>/jwks.json` ← the auth server fetches the party's
  public key from this node's external gateway to verify its assertions
- a realm role identifying the party (the partner's OPA `required_role` must
  match it)

`OWN_EXTERNAL_URL` therefore must be the URL the auth server **and** the partner
can actually reach this node's external gateway on.

## Run

```bash
cp .env.example .env
# edit .env — at minimum PARTY, the AUTH_SERVER/PARTNER/REGISTRY URLs, and
# OWN_EXTERNAL_URL (must match the jwks.url registered above)
docker compose up -d --build
```

Verify the node itself:

```bash
curl http://localhost:${EXTERNAL_GATEWAY_PORT}/jwks.json     # public JWK Set
curl http://localhost:${KEY_CUSTODIAN_PORT}/healthz          # custodian identity
open  http://localhost:${KESTRA_PORT}/                       # Kestra UI
```

A cross-party read then flows: this party's caller → mint an M2M token at the
auth server (assertion signed by `key-custodian`, fhirContext via RFC 9396
`authorization_details`) → call `PARTNER_EXTERNAL_URL` directly. No internal
proxy is involved.

## Trying it against the sandbox

The `.env.example` defaults point at the running root sandbox as the "external"
ecosystem (`host.docker.internal:8180` auth, `:8084` registry, `:8081` partner)
and deploy this node **as the fulfiller**, reusing the committed
`fulfiller-client-l2` key. Because the JWK Set is the same committed key the
sandbox already registered, the sandbox Keycloak can verify assertions this
node's custodian signs. Set distinct host ports (defaults: 9080/9081/9090/…) so
it can run alongside the sandbox.

## Notes / limitations

- **Bundles** ship for `placer` and `fulfiller` (reused from `../services/seed/bundles`).
  A brand-new party drops its own `<PARTY>-bundle.json` there; otherwise `seed`
  just creates the empty partition.
- **One partner / one role.** The external OPA gate allows a single
  `PARTNER_REALM_ROLE`. A real multi-partner node would extend the allow-list.
- **Referenced configs.** `../services/...` is bind-mounted, so this folder runs
  inside the repo. To ship it standalone, vendor those paths into the folder.
