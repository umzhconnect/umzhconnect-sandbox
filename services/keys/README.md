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
| `placer-l2.key`            | HospitalP (Placer)           | Held by `key-custodian-placer` (signs assertions); the browser (Web Crypto) and test runner fetch it to sign too |
| `placer-l2.jwks.json`      | HospitalP (Placer) — public  | Served by `key-custodian-placer`; published at `http://localhost:8081/jwks.json` via `apisix-placer-external`     |
| `fulfiller-l2.key`         | HospitalF (Fulfiller)        | Held by `key-custodian-fulfiller` (signs assertions); the browser (Web Crypto) and test runner fetch it to sign too |
| `fulfiller-l2.jwks.json`   | HospitalF (Fulfiller) — public | Served by `key-custodian-fulfiller`; published at `http://localhost:8083/jwks.json` via `apisix-fulfiller-external` |

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

If you ever want to rotate the demo keys, run `rotate-l2-keys.sh` from this
directory (or from the repo root as `services/keys/rotate-l2-keys.sh`). It
generates a fresh RSA-2048 private key **and** rewrites the matching
`*.jwks.json` in one step, so the two can never drift apart:

```sh
services/keys/rotate-l2-keys.sh placer-l2 fulfiller-l2
```

The script sets each JWK's `kid` to the key basename (`placer-l2`,
`fulfiller-l2`) — the same value the signers emit in the JWT header, which is
how Keycloak selects the right key during `private_key_jwt` verification.

