# Single-tenant key custodian. One image, instantiated once per party in
# docker-compose with PARTY/CLIENT_ID/KID env + per-party key mount.
#
# Endpoints:
#   GET  /jwks.json   public JWK Set for the party this container belongs to
#   POST /sign        mint an RS256 private_key_jwt client assertion
#   GET  /healthz     party + kid (for sanity probes)
#
# DEMO ONLY: /sign has no authentication. Production would gate it with mTLS,
# a bootstrap secret, or per-caller policy. See services/key-custodian/README.md.
FROM python:3.12-slim

RUN pip install --no-cache-dir flask==3.0.3 pyjwt==2.9.0 cryptography==43.0.1

WORKDIR /app
COPY app.py /app/app.py

EXPOSE 8000

# Plain CPython server is fine for the sandbox — single worker, no concurrency
# pressure. Production would front this with gunicorn/uvicorn.
CMD ["python", "/app/app.py"]
