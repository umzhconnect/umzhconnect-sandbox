# Key Custodian

Single-tenant signing and JWK Set publisher for one party's L2 (`private_key_jwt`)
client identity.

The **same image** runs once per party. The container holds *only* its party's
private key and JWK Set, mounted as individual files at fixed paths. Per-party
behaviour comes entirely from docker-compose env + the mount source — there is
no `/sign/{party}` path. **The container is the party.**

| Compose service          | Party     | Host port | client_id           | kid          |
|--------------------------|-----------|-----------|---------------------|--------------|
| `key-custodian-placer`   | placer    | 8087      | `placer-client-l2`  | `placer-l2`  |
| `key-custodian-fulfiller`| fulfiller | 8089      | `fulfiller-client-l2`| `fulfiller-l2` |

## Endpoints

| Method + path     | Purpose                                                 |
|-------------------|---------------------------------------------------------|
| `GET  /jwks.json` | Public JWK Set — served verbatim from the mounted file. The party's external APISIX gateway proxies its public `/jwks.json` route here. |
| `POST /sign`      | Mint an RS256 client assertion. Request body: `{"audience": "...", "ttl_seconds": N}` (both optional — defaults applied from env). Response: `{"assertion": "<JWT>", "kid": "...", "expires_at": <epoch>}`. |
| `GET  /healthz`   | `{"party": ..., "client_id": ..., "kid": ...}` — handy for confirming which instance you hit. |

## Demo posture — DO NOT USE IN PRODUCTION

`/sign` has **no authentication**. Any container on the Docker network — and,
because the port is host-exposed for `tests/scripts/get-token.sh` to work, any
process on the developer's machine — can mint an assertion and obtain an access
token. That's intentional for the sandbox (transparency over rigour, same
posture as the committed L1 secrets), but a real deployment would gate `/sign`
with:

- mutual TLS between the custodian and its callers, or
- a bootstrap-time shared secret, or
- per-caller signed-request policy ("Kestra-fulfiller may mint for
  `fulfiller-client-l2` only"), or
- HSM-backed signing (no PEM on disk at all).

The README at `services/keys/README.md` carries the same "demo only" framing for
the key material itself.

## Env contract

| Env                 | Default                | Purpose |
|---------------------|------------------------|---------|
| `PARTY`             | required               | Label only (`placer` / `fulfiller`) — shown in `/healthz`, log lines |
| `CLIENT_ID`         | required               | `iss` + `sub` claim on every signed assertion |
| `KID`               | required               | JWT header `kid` (must match the only JWK in `JWKS_PATH`) |
| `KEY_PATH`          | `/keys/private.key`    | RSA private key (PEM) |
| `JWKS_PATH`         | `/keys/jwks.json`      | JWK Set file served verbatim |
| `KEYCLOAK_AUDIENCE` | required               | Default `aud` (overridable per request) |
| `PORT`              | `8000`                 | Bind port inside the container |

## Why one container per party (not a singleton)

1. **Trust isolation.** A breach of `key-custodian-placer` does not yield
   fulfiller's signing capability. A singleton custodian would expand the blast
   radius of any compromise to the whole federation.
2. **Maps onto real federation deployments.** In production each hospital runs
   its own custodian on its own infrastructure. Placer never sees fulfiller's
   private key, and vice versa. The per-party model is architecturally honest;
   the singleton model would normalise a trust posture no real deployment
   adopts.
3. **Single-tenant code is shorter.** No `/sign/{party}` path parameter, no
   `party → key` map, no "is the caller allowed to sign for this party" check.
4. **Same pattern as the existing APISIX gateways.** Internal/external gateways
   already run as a per-party template; the custodian fits the same shape.

## Callers in this codebase

| Caller                                   | Endpoint used    |
|------------------------------------------|------------------|
| `apisix-placer-external` (jwks route)    | `GET /jwks.json` |
| `apisix-fulfiller-external` (jwks route) | `GET /jwks.json` |
| `kestra` (`prepareTokenRequest` task)    | `POST /sign`     |
| `tests/scripts/get-token.sh`             | `POST /sign`     |

The browser-side flow in `web-app/src/pages/CredentialsPage.tsx` is **intentionally
left untouched** — the in-browser Web Crypto signing is the teaching point on
that page; replacing it with a server call would hide the most interesting part.
