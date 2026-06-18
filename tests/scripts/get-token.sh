#!/bin/sh
# Acquire a JWT from Keycloak.
#
# Usage: get-token.sh <client_type> [sr_id]
#   client_type:  placer | fulfiller | fulfiller-context | placer-user | fulfiller-user
#                 placer-l2 | fulfiller-l2 | fulfiller-l2-context
#   sr_id:        for *-context variants — the ServiceRequest id to use as fhirContext
#
# L2 variants POST to the per-party key custodian (services/key-custodian/),
# which holds the private key and returns a signed RS256 client assertion. The
# script then exchanges that assertion at Keycloak's token endpoint — the same
# flow a real Level-2 client uses. The browser flow in
# web-app/src/pages/CredentialsPage.tsx signs in-browser via Web Crypto
# (the in-browser signing is the teaching point on that page).
#
# Uses curl or wget (no jq) to stay compatible with both the hurl Docker image
# (wget only) and macOS dev environments (curl only).

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

# Key custodians — each party runs its own. On the host they bind to fixed
# ports; in CI (test-runner inside Docker) they're reachable by container name.
KEY_CUSTODIAN_PLACER_URL="${KEY_CUSTODIAN_PLACER_URL:-http://localhost:8087}"
KEY_CUSTODIAN_FULFILLER_URL="${KEY_CUSTODIAN_FULFILLER_URL:-http://localhost:8089}"
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

# Sign a private_key_jwt assertion via the per-party key custodian and exchange
# it for an M2M access token.
#   $1 = client_id           e.g. placer-client-l2
#   $2 = custodian base URL  e.g. http://localhost:8087
#   $3 = space-separated scope (may be empty)
#   $4 = optional authorization_details JSON
#
# The custodian sets iss/sub/kid from its own env, so we only need to supply
# the audience.
fetch_l2_token() {
    l2_cid="$1"; custodian_url="$2"; l2_scope="$3"; auth_details="$4"

    sign_resp=$(curl -sf -X POST \
        -H "Content-Type: application/json" \
        -d "{\"audience\":\"${TOKEN_AUD}\"}" \
        "${custodian_url}/sign" 2>/dev/null)
    if [ -z "$sign_resp" ]; then
        echo "get-token: custodian /sign at ${custodian_url} failed" >&2
        return 1
    fi
    assertion=$(printf '%s' "$sign_resp" | sed -n 's/.*"assertion"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p')
    if [ -z "$assertion" ]; then
        echo "get-token: no assertion in custodian response (${custodian_url})" >&2
        return 1
    fi

    body="grant_type=client_credentials&client_id=${l2_cid}"
    body="${body}&client_assertion_type=${CLIENT_ASSERTION_TYPE}&client_assertion=${assertion}"
    # Skip scope param when empty so Keycloak applies the client's defaults
    # only. M2M flows don't take `openid` — the access token's `system/*`
    # scopes come from defaultClientScopes regardless.
    [ -n "$l2_scope" ] && body="${body}&scope=$(echo "$l2_scope" | sed 's/ /+/g')"
    [ -n "$auth_details" ] && body="${body}&authorization_details=$(url_encode "$auth_details")"

    fetch_token "$body"
}

case "$CLIENT_TYPE" in
  placer)
    fetch_token "grant_type=client_credentials&client_id=placer-client&client_secret=placer-secret-2025"
    ;;
  fulfiller)
    fetch_token "grant_type=client_credentials&client_id=fulfiller-client&client_secret=fulfiller-secret-2025"
    ;;
  fulfiller-context)
    # RFC 9396 authorization_details token for cross-party reads
    SR="${SR_ID:-ReferralOrthopedicSurgery}"
    AUTH_DETAILS='[{"type":"umzh-connect-context","identifier":"ServiceRequest/'"$SR"'"}]'
    AUTH_DETAILS_ENC=$(url_encode "$AUTH_DETAILS")
    fetch_token "grant_type=client_credentials&client_id=fulfiller-client&client_secret=fulfiller-secret-2025&authorization_details=${AUTH_DETAILS_ENC}"
    ;;
  placer-context)
    # RFC 9396 authorization_details token — placer reading Task output resources
    # at the fulfiller-external gateway. The identifier is a Task/<id>.
    TASK="${SR_ID:-TaskOrthopedicReferral}"
    AUTH_DETAILS='[{"type":"umzh-connect-context","identifier":"Task/'"$TASK"'"}]'
    AUTH_DETAILS_ENC=$(url_encode "$AUTH_DETAILS")
    fetch_token "grant_type=client_credentials&client_id=placer-client&client_secret=placer-secret-2025&authorization_details=${AUTH_DETAILS_ENC}"
    ;;
  placer-user)
    # User flow — openid IS appropriate here (authenticates a user; an ID token is meaningful)
    fetch_token "grant_type=password&client_id=web-app&username=placer-user&password=placer123&scope=openid"
    ;;
  fulfiller-user)
    fetch_token "grant_type=password&client_id=web-app&username=fulfiller-user&password=fulfiller123&scope=openid"
    ;;
  placer-l2)
    fetch_l2_token placer-client-l2 "$KEY_CUSTODIAN_PLACER_URL" ""
    ;;
  fulfiller-l2)
    fetch_l2_token fulfiller-client-l2 "$KEY_CUSTODIAN_FULFILLER_URL" ""
    ;;
  fulfiller-l2-context)
    SR="${SR_ID:-ReferralOrthopedicSurgery}"
    fetch_l2_token fulfiller-client-l2 "$KEY_CUSTODIAN_FULFILLER_URL" "" \
      '[{"type":"umzh-connect-context","identifier":"ServiceRequest/'"$SR"'"}]'
    ;;
  placer-l2-context)
    TASK="${SR_ID:-TaskOrthopedicReferral}"
    fetch_l2_token placer-client-l2 "$KEY_CUSTODIAN_PLACER_URL" "" \
      '[{"type":"umzh-connect-context","identifier":"Task/'"$TASK"'"}]'
    ;;
  *)
    echo "Usage: get-token.sh <placer|fulfiller|fulfiller-context|placer-context|placer-user|fulfiller-user|placer-l2|fulfiller-l2|fulfiller-l2-context|placer-l2-context> [resource_id]" >&2
    exit 1
    ;;
esac
