#!/bin/sh
# Acquire a JWT from Keycloak.
#
# Usage: get-token.sh <client_type> [sr_id]
#   client_type:  placer | fulfiller | fulfiller-context | placer-user | fulfiller-user
#                 placer-l2 | fulfiller-l2 | fulfiller-l2-context
#   sr_id:        for *-context variants — the ServiceRequest id to use as fhirContext
#
# L2 variants sign an RS256 private_key_jwt client assertion locally (openssl)
# and exchange it directly at Keycloak's token endpoint — the same flow a real
# Level-2 client uses, mirroring the browser's Web Crypto implementation. The
# RSA private key is committed in services/keys/ and served over HTTP by the
# web-app at /l2-keys/ — the same source the browser uses. Keycloak verifies
# the signature against the corresponding *.jwks.json, also committed in
# services/keys/ and published by each party's external APISIX gateway at
# http://localhost:8081/jwks.json (placer) / :8083/jwks.json (fulfiller).
#
# Uses curl or wget (no jq) to stay compatible with both the hurl Docker image
# (wget only) and macOS dev environments (curl only). The L2 variants also need
# openssl — already a project dependency, as the seed loader generates the keys
# with it.

KEYCLOAK_URL="${KEYCLOAK_URL:-http://localhost:8180}"
TOKEN_URL="${KEYCLOAK_URL}/realms/umzh-connect/protocol/openid-connect/token"

# The L2 client assertion's `aud` must be Keycloak's *published* (frontend)
# token endpoint — the URL it advertises under KC_HOSTNAME and validates the
# assertion against. In CI we POST to the internal backchannel (keycloak:8080)
# but must still claim the frontend endpoint (localhost:8180), so derive `aud`
# from the published issuer rather than the POST URL. On a dev host the two
# coincide, so KEYCLOAK_ISSUER defaults back to KEYCLOAK_URL.
KEYCLOAK_ISSUER="${KEYCLOAK_ISSUER:-${KEYCLOAK_URL}/realms/umzh-connect}"
TOKEN_AUD="${TOKEN_AUD:-${KEYCLOAK_ISSUER}/protocol/openid-connect/token}"

# L2 private keys are served at /l2-keys/ by the web-app (bind-mounted from
# services/keys/) — the same source the browser uses. Override WEB_APP_URL
# for non-default hosts.
WEB_APP_URL="${WEB_APP_URL:-http://localhost:3000}"
L2_KEY_BASE_URL="${L2_KEY_BASE_URL:-${WEB_APP_URL}/l2-keys}"
CLIENT_ASSERTION_TYPE="urn%3Aietf%3Aparams%3Aoauth%3Aclient-assertion-type%3Ajwt-bearer"

CLIENT_TYPE="$1"
SR_ID="$2"

fetch_token() {
    if command -v curl > /dev/null 2>&1; then
        curl -sf \
            -H "Content-Type: application/x-www-form-urlencoded" \
            -d "$1" \
            "$TOKEN_URL"
    else
        wget -qO- \
            --header="Content-Type: application/x-www-form-urlencoded" \
            --post-data="$1" \
            "$TOKEN_URL"
    fi | sed -n 's/.*"access_token":"\([^"]*\)".*/\1/p'
}

# URL-encode a string (portable, no external deps)
url_encode() {
    printf '%s' "$1" | sed 's/%/%25/g;s/ /%20/g;s/!/%21/g;s/"/%22/g;s/#/%23/g;s/\$/%24/g;s/&/%26/g;s/'"'"'/%27/g;s/(/%28/g;s/)/%29/g;s/\*/%2A/g;s/+/%2B/g;s/,/%2C/g;s|/|%2F|g;s/:/%3A/g;s/;/%3B/g;s/=/%3D/g;s/?/%3F/g;s/@/%40/g;s/\[/%5B/g;s/\\/%5C/g;s/\]/%5D/g;s/\^/%5E/g;s/{/%7B/g;s/|/%7C/g;s/}/%7D/g'
}

# --- L2 (private_key_jwt) helpers ---------------------------------------------

# base64url-encode stdin, no padding (RFC 7515 §2).
b64url() { openssl base64 -A | tr '+/' '-_' | tr -d '='; }

# Sign a private_key_jwt assertion and exchange it for an M2M access token.
#   $1 = client_id   $2 = key basename (matches both <name>.key in services/keys/
#                         and the JWK kid in <name>.jwks.json)
#   $3 = space-separated scope   $4 = optional authorization_details JSON
#
# L2 needs curl + openssl (the CI test-runner image installs both on top of the
# hurl base). run-tests waits for the web-app, so the key is already served by
# the time this runs.
#
# The `kid` we emit in the JWT header matches the `kid` of the corresponding
# JWK that Keycloak fetches from the client's jwks.url (see services/keys/
# *.jwks.json). With one key per JWKS today that lookup is trivial, but the
# linkage is what makes overlap-window rotation work.
fetch_l2_token() {
    l2_cid="$1"; key_name="$2"; l2_scope="$3"; auth_details="$4"

    key_file=$(mktemp) || { echo "get-token: mktemp failed" >&2; return 1; }
    if ! curl -sf "${L2_KEY_BASE_URL}/${key_name}.key" -o "$key_file" \
         || ! grep -q "PRIVATE KEY" "$key_file"; then
        rm -f "$key_file"
        echo "get-token: could not fetch L2 key '${key_name}' from ${L2_KEY_BASE_URL}" >&2
        return 1
    fi

    # kid matches the JWK kid in services/keys/${key_name}.jwks.json
    header=$(printf '{"typ":"JWT","alg":"RS256","kid":"%s"}' "$key_name" | b64url)
    now=$(date +%s)
    payload=$(printf '{"iss":"%s","sub":"%s","aud":"%s","exp":%s,"jti":"%s"}' \
              "$l2_cid" "$l2_cid" "$TOKEN_AUD" "$((now + 60))" "${now}-$(openssl rand -hex 8)" \
              | b64url)
    signing_input="${header}.${payload}"
    signature=$(printf '%s' "$signing_input" | openssl dgst -sha256 -sign "$key_file" | b64url)
    rm -f "$key_file"
    assertion="${signing_input}.${signature}"

    body="grant_type=client_credentials&client_id=${l2_cid}"
    body="${body}&client_assertion_type=${CLIENT_ASSERTION_TYPE}&client_assertion=${assertion}"
    body="${body}&scope=$(echo "$l2_scope" | sed 's/ /+/g')"
    [ -n "$auth_details" ] && body="${body}&authorization_details=$(url_encode "$auth_details")"

    fetch_token "$body"
}

case "$CLIENT_TYPE" in
  placer)
    SCOPE="smart-task-write smart-servicerequest-read smart-clinical-read smart-questionnaire-write"
    fetch_token "grant_type=client_credentials&client_id=placer-client&client_secret=placer-secret-2025&scope=$(echo "$SCOPE" | sed 's/ /+/g')"
    ;;
  fulfiller)
    SCOPE="smart-task-write smart-servicerequest-read smart-clinical-read smart-patient-read smart-questionnaire-write"
    fetch_token "grant_type=client_credentials&client_id=fulfiller-client&client_secret=fulfiller-secret-2025&scope=$(echo "$SCOPE" | sed 's/ /+/g')"
    ;;
  fulfiller-context)
    # RFC 9396 authorization_details token for cross-party reads
    SR="${SR_ID:-ReferralOrthopedicSurgery}"
    SCOPE="smart-task-write smart-servicerequest-read smart-clinical-read smart-patient-read"
    AUTH_DETAILS='[{"type":"umzh-connect-context","identifier":"ServiceRequest/'"$SR"'"}]'
    AUTH_DETAILS_ENC=$(url_encode "$AUTH_DETAILS")
    fetch_token "grant_type=client_credentials&client_id=fulfiller-client&client_secret=fulfiller-secret-2025&scope=$(echo "$SCOPE" | sed 's/ /+/g')&authorization_details=${AUTH_DETAILS_ENC}"
    ;;
  placer-user)
    fetch_token "grant_type=password&client_id=web-app&username=placer-user&password=placer123&scope=openid+smart-patient-read+smart-task-write+smart-servicerequest-read+smart-clinical-read"
    ;;
  fulfiller-user)
    fetch_token "grant_type=password&client_id=web-app&username=fulfiller-user&password=fulfiller123&scope=openid+smart-patient-read+smart-task-write+smart-servicerequest-read+smart-clinical-read"
    ;;
  placer-l2)
    fetch_l2_token placer-client-l2 placer-l2 \
      "smart-task-write smart-servicerequest-read smart-clinical-read smart-questionnaire-write"
    ;;
  fulfiller-l2)
    fetch_l2_token fulfiller-client-l2 fulfiller-l2 \
      "smart-task-write smart-servicerequest-read smart-clinical-read smart-patient-read smart-questionnaire-write"
    ;;
  fulfiller-l2-context)
    SR="${SR_ID:-ReferralOrthopedicSurgery}"
    fetch_l2_token fulfiller-client-l2 fulfiller-l2 \
      "smart-task-write smart-servicerequest-read smart-clinical-read smart-patient-read" \
      '[{"type":"umzh-connect-context","identifier":"ServiceRequest/'"$SR"'"}]'
    ;;
  *)
    echo "Usage: get-token.sh <placer|fulfiller|fulfiller-context|placer-user|fulfiller-user|placer-l2|fulfiller-l2|fulfiller-l2-context> [sr_id]" >&2
    exit 1
    ;;
esac
