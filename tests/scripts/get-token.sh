#!/bin/sh
# Acquire a JWT from Keycloak.
#
# Usage: get-token.sh <client_type> [sr_id]
#   client_type:  placer | fulfiller | fulfiller-context | placer-user | fulfiller-user
#   sr_id:        for fulfiller-context — the ServiceRequest id to use as fhirContext
#
# Uses curl or wget (no jq) to be compatible with both the hurl Docker
# image (wget only) and macOS dev environments (curl only).

KEYCLOAK_URL="${KEYCLOAK_URL:-http://localhost:8180}"
TOKEN_URL="${KEYCLOAK_URL}/realms/umzh-connect/protocol/openid-connect/token"

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
  *)
    echo "Usage: get-token.sh <placer|fulfiller|fulfiller-context|placer-user|fulfiller-user> [sr_id]" >&2
    exit 1
    ;;
esac
