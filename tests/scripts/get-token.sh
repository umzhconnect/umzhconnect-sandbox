#!/bin/sh
# Acquire a JWT from Keycloak.
#
# Usage: get-token.sh <client_type> [consent_id]
#   client_type:  placer | fulfiller | placer-user | fulfiller-user
#   consent_id:   optional — appends consent:<id> dynamic scope

KEYCLOAK_URL="${KEYCLOAK_URL:-http://localhost:8180}"
TOKEN_URL="${KEYCLOAK_URL}/realms/umzh-connect/protocol/openid-connect/token"

CLIENT_TYPE="$1"
CONSENT_ID="$2"

case "$CLIENT_TYPE" in
  placer)
    SCOPE="smart-task-write smart-servicerequest-read smart-clinical-read smart-questionnaire-write"
    [ -n "$CONSENT_ID" ] && SCOPE="$SCOPE consent:$CONSENT_ID"
    curl -sf -X POST "$TOKEN_URL" \
      -d "grant_type=client_credentials" \
      -d "client_id=placer-client" \
      -d "client_secret=placer-secret-2025" \
      -d "scope=$SCOPE" | jq -r '.access_token'
    ;;
  fulfiller)
    SCOPE="smart-task-write smart-servicerequest-read smart-clinical-read smart-patient-read smart-questionnaire-write"
    [ -n "$CONSENT_ID" ] && SCOPE="$SCOPE consent:$CONSENT_ID"
    curl -sf -X POST "$TOKEN_URL" \
      -d "grant_type=client_credentials" \
      -d "client_id=fulfiller-client" \
      -d "client_secret=fulfiller-secret-2025" \
      -d "scope=$SCOPE" | jq -r '.access_token'
    ;;
  placer-user)
    curl -sf -X POST "$TOKEN_URL" \
      -d "grant_type=password" \
      -d "client_id=web-app" \
      -d "username=placer-user" \
      -d "password=placer123" \
      -d "scope=openid smart-patient-read smart-task-write smart-servicerequest-read smart-clinical-read" | jq -r '.access_token'
    ;;
  fulfiller-user)
    curl -sf -X POST "$TOKEN_URL" \
      -d "grant_type=password" \
      -d "client_id=web-app" \
      -d "username=fulfiller-user" \
      -d "password=fulfiller123" \
      -d "scope=openid smart-patient-read smart-task-write smart-servicerequest-read smart-clinical-read" | jq -r '.access_token'
    ;;
  *)
    echo "Usage: get-token.sh <placer|fulfiller|placer-user|fulfiller-user> [consent_id]" >&2
    exit 1
    ;;
esac
