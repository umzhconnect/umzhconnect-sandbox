"""
Single-tenant key custodian.

The container holds exactly one party's private key and JWK Set. Per-party-ness
comes from the docker-compose env + the mount source — same image runs once per
party. There is no `/sign/{party}` path: the container *is* the party.

Endpoints:
    GET  /jwks.json   public JWK Set
    POST /sign        mint an RS256 client assertion (private_key_jwt)
    GET  /healthz     {"party": ..., "kid": ..., "client_id": ...}

POST /sign request body (all fields optional):
    {
      "audience":    "<override the default KEYCLOAK_AUDIENCE>",
      "ttl_seconds": 60       # 1..300, default 60
    }

POST /sign response:
    {
      "assertion":  "<JWT>",
      "kid":        "<kid header on the assertion>",
      "expires_at": <epoch>
    }

Env contract:
    PARTY              required   label only (placer | fulfiller | ...)
    CLIENT_ID          required   iss + sub on every assertion
    KID                required   kid header (must match the JWK in JWKS_PATH)
    KEY_PATH           default /keys/private.key
    JWKS_PATH          default /keys/jwks.json
    KEYCLOAK_AUDIENCE  required   default aud (overridable per request)
    PORT               default 8000
"""

import json
import os
import time
import uuid

import jwt as pyjwt
from flask import Flask, abort, jsonify, request


PARTY              = os.environ["PARTY"]
CLIENT_ID          = os.environ["CLIENT_ID"]
KID                = os.environ["KID"]
KEY_PATH           = os.environ.get("KEY_PATH",  "/keys/private.key")
JWKS_PATH          = os.environ.get("JWKS_PATH", "/keys/jwks.json")
KEYCLOAK_AUDIENCE  = os.environ["KEYCLOAK_AUDIENCE"]
PORT               = int(os.environ.get("PORT", "8000"))

# Read once at startup. If the key rotates on disk, restart the container.
with open(KEY_PATH, "r", encoding="utf-8") as fh:
    PRIVATE_KEY_PEM = fh.read()

with open(JWKS_PATH, "r", encoding="utf-8") as fh:
    JWKS = json.load(fh)

app = Flask(__name__)


@app.get("/healthz")
def healthz():
    return jsonify({"party": PARTY, "client_id": CLIENT_ID, "kid": KID})


@app.get("/jwks.json")
def jwks():
    response = app.response_class(
        response=json.dumps(JWKS),
        status=200,
        mimetype="application/json",
    )
    response.headers["Cache-Control"] = "no-store"
    return response


@app.post("/sign")
def sign():
    body = request.get_json(silent=True) or {}
    audience = body.get("audience", KEYCLOAK_AUDIENCE)
    ttl = int(body.get("ttl_seconds", 60))
    if not (1 <= ttl <= 300):
        abort(400, description="ttl_seconds must be between 1 and 300")

    now = int(time.time())
    exp = now + ttl
    assertion = pyjwt.encode(
        {
            "iss": CLIENT_ID,
            "sub": CLIENT_ID,
            "aud": audience,
            "iat": now,
            "exp": exp,
            "jti": str(uuid.uuid4()),
        },
        PRIVATE_KEY_PEM,
        algorithm="RS256",
        headers={"kid": KID, "typ": "JWT"},
    )
    return jsonify({"assertion": assertion, "kid": KID, "expires_at": exp})


if __name__ == "__main__":
    # Flask's dev server is enough for the sandbox; one worker, no autoreload.
    app.run(host="0.0.0.0", port=PORT, debug=False, use_reloader=False)
