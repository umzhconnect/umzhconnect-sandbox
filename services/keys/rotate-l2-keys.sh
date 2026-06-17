#!/usr/bin/env bash
#
# rotate-l2-keys.sh — (re)generate a demo L2 RSA keypair and its JWK Set.
#
# Given a key basename (e.g. "placer-l2"), generates a fresh RSA-2048 private
# key at services/keys/<name>.key and writes the matching public JWK Set at
# services/keys/<name>.jwks.json in one step — so the private key and the
# published JWKS can never drift apart.
#
# The JWK `kid` is set to <name>, the same value the signers (APISIX
# umzh-m2m-token plugin, get-token.sh, the browser) emit in the JWT header, so
# Keycloak picks the right key during private_key_jwt verification.
#
# Only depends on openssl + standard coreutils (no python, no jq), matching the
# rest of the sandbox tooling.
#
# Usage:
#   services/keys/rotate-l2-keys.sh placer-l2 fulfiller-l2

set -euo pipefail

KEYS_DIR="$(cd "$(dirname "$0")" && pwd)"

b64url() { openssl base64 -A | tr '+/' '-_' | tr -d '='; }

rotate() {
    name="$1"
    key="${KEYS_DIR}/${name}.key"
    out="${KEYS_DIR}/${name}.jwks.json"

    openssl genrsa -out "$key" 2048 2>/dev/null
    chmod 644 "$key"

    # Modulus: openssl prints it as hex (n), convert hex -> raw bytes -> base64url.
    n=$(openssl rsa -in "$key" -noout -modulus 2>/dev/null \
        | sed 's/Modulus=//' | xxd -r -p | b64url)
    # Public exponent is 65537 (AQAB) for openssl-generated RSA keys.
    e="AQAB"

    cat > "$out" <<EOF
{
  "keys": [
    {
      "kty": "RSA",
      "use": "sig",
      "alg": "RS256",
      "kid": "${name}",
      "n": "${n}",
      "e": "${e}"
    }
  ]
}
EOF
    echo "  rotated ${name}: wrote ${key} + ${out} (kid=${name})"
}

if [ "$#" -eq 0 ]; then
    echo "Usage: services/keys/rotate-l2-keys.sh <key-basename> [<key-basename> ...]" >&2
    echo "  e.g. services/keys/rotate-l2-keys.sh placer-l2 fulfiller-l2" >&2
    exit 1
fi

for name in "$@"; do
    rotate "$name"
done
