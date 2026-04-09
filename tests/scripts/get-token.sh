#!/bin/sh
# Acquire a JWT from Keycloak.
#
# Usage: get-token.sh <client_type> [consent_id]
#   client_type:  placer | fulfiller | placer-user | fulfiller-user
#   consent_id:   optional — appends consent:<id> dynamic scope
#
# Uses wget + sed (no curl/jq) to be compatible with the hurl Docker image.

KEYCLOAK_URL="${KEYCLOAK_URL:-http://localhost:8180}"
TOKEN_URL="${KEYCLOAK_URL}/realms/umzh-connect/protocol/openid-connect/token"

CLIENT_TYPE="$1"
CONSENT_ID="$2"

fetch_token() {
    wget -qO- \
        --header="Content-Type: application/x-www-form-urlencoded" \
        --post-data="$1" \
        "$TOKEN_URL" \
    | sed -n 's/.*"access_token":"\([^"]*\)".*/\1/p'
}

case "$CLIENT_TYPE" in
  placer)
    SCOPE="smart-task-write smart-servicerequest-read smart-clinical-read smart-questionnaire-write"
    [ -n "$CONSENT_ID" ] && SCOPE="$SCOPE consent:$CONSENT_ID"
    fetch_token "grant_type=client_credentials&client_id=placer-client&client_secret=placer-secret-2025&scope=$(echo "$SCOPE" | sed 's/ /+/g')"
    ;;
  fulfiller)
    SCOPE="smart-task-write smart-servicerequest-read smart-clinical-read smart-patient-read smart-questionnaire-write"
    [ -n "$CONSENT_ID" ] && SCOPE="$SCOPE consent:$CONSENT_ID"
    fetch_token "grant_type=client_credentials&client_id=fulfiller-client&client_secret=fulfiller-secret-2025&scope=$(echo "$SCOPE" | sed 's/ /+/g')"
    ;;
  placer-user)
    fetch_token "grant_type=password&client_id=web-app&username=placer-user&password=placer123&scope=openid+smart-patient-read+smart-task-write+smart-servicerequest-read+smart-clinical-read"
    ;;
  fulfiller-user)
    fetch_token "grant_type=password&client_id=web-app&username=fulfiller-user&password=fulfiller123&scope=openid+smart-patient-read+smart-task-write+smart-servicerequest-read+smart-clinical-read"
    ;;
  *)
    echo "Usage: get-token.sh <placer|fulfiller|placer-user|fulfiller-user> [consent_id]" >&2
    exit 1
    ;;
esac
