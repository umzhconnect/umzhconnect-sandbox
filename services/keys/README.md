# Demo L2 client keys

**DEMO KEYS — DO NOT USE IN PRODUCTION.**

Both private keys in this directory are committed to git on purpose. They exist
only so a newbie running `docker compose up` can trace the entire
`private_key_jwt` flow end-to-end without anything being generated at runtime.
The trust posture matches the L1 `client_secret` values that are also committed
in `.env` — fine for a sandbox, never for a real deployment.

## Files

| File                       | Holder                       | Used by                                                                           |
|----------------------------|------------------------------|-----------------------------------------------------------------------------------|
| `placer-l2.key`            | HospitalP (Placer)           | Signers: APISIX `umzh-m2m-token` plugin, browser (Web Crypto), test runner        |
| `placer-l2.jwks.json`      | HospitalP (Placer) — public  | Published at `http://localhost:8081/jwks.json` by `apisix-placer-external`        |
| `fulfiller-l2.key`         | HospitalF (Fulfiller)        | Signers: APISIX `umzh-m2m-token` plugin, browser (Web Crypto), test runner        |
| `fulfiller-l2.jwks.json`   | HospitalF (Fulfiller) — public | Published at `http://localhost:8083/jwks.json` by `apisix-fulfiller-external`   |

Each hospital publishes its JWKS at the **same origin as its FHIR API** — the
SMART Backend Services discovery shape. Behind the scenes the external APISIX
gateway proxies `/jwks.json` to an internal nginx-proxy server block that
serves the static file from this directory; the gateway container itself never
mounts the keys.

## Flow

```
client signs RS256 assertion (placer-l2.key)
            │
            ▼
POST /token  client_assertion=<JWT>           ──►  Keycloak
                                                      │
                                                      │ looks up client placer-client-l2
                                                      │ reads attribute jwks.url
                                                      ▼
                                              GET http://apisix-placer-external:9080/jwks.json
                                                      │
                                                      │ APISIX route ext-jwks → upstream jwks-placer
                                                      ▼
                                              GET http://nginx-proxy:85/jwks.json
                                                      │
                                                      ▼
                                              placer-l2.jwks.json  (this dir)
                                                      │
                                                      ▼
                                              verifies signature with key kid=placer-l2
                                                      │
                                                      ▼
                                              issues access_token
```

## Regenerating

If you ever want to rotate the demo keys:

```sh
cd services/keys
openssl genrsa -out placer-l2.key 2048
openssl genrsa -out fulfiller-l2.key 2048
python3 ../../scripts/derive-jwks.py placer-l2 fulfiller-l2   # not committed; see below
```

The JWKS derivation is straightforward — see the inline Python in `seed.sh`'s
git history (commit that introduced this directory) or use the snippet in
`docs/security-concept.md`.
