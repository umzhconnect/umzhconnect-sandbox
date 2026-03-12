# =============================================================================
# 02-auth.hurl — Authentication Flows
#
# Verify token acquisition for all client types and rejection of bad creds.
# =============================================================================


# --- Placer client_credentials ---

POST {{keycloak_url}}/realms/umzh-connect/protocol/openid-connect/token
[FormParams]
grant_type: client_credentials
client_id: placer-client
client_secret: placer-secret-2025
scope: smart-task-write smart-servicerequest-read smart-clinical-read
HTTP 200
[Captures]
placer_cc_token: jsonpath "$.access_token"
[Asserts]
jsonpath "$.access_token" exists
jsonpath "$.token_type" == "Bearer"
jsonpath "$.expires_in" > 0


# --- Fulfiller client_credentials ---

POST {{keycloak_url}}/realms/umzh-connect/protocol/openid-connect/token
[FormParams]
grant_type: client_credentials
client_id: fulfiller-client
client_secret: fulfiller-secret-2025
scope: smart-task-write smart-servicerequest-read smart-clinical-read smart-patient-read
HTTP 200
[Captures]
fulfiller_cc_token: jsonpath "$.access_token"
[Asserts]
jsonpath "$.access_token" exists
jsonpath "$.token_type" == "Bearer"


# --- Fulfiller with consent dynamic scope ---

POST {{keycloak_url}}/realms/umzh-connect/protocol/openid-connect/token
[FormParams]
grant_type: client_credentials
client_id: fulfiller-client
client_secret: fulfiller-secret-2025
scope: smart-patient-read consent:ConsentOrthopedicReferral
HTTP 200
[Asserts]
jsonpath "$.access_token" exists
jsonpath "$.scope" contains "consent:ConsentOrthopedicReferral"


# --- Password grant: placer-user ---

POST {{keycloak_url}}/realms/umzh-connect/protocol/openid-connect/token
[FormParams]
grant_type: password
client_id: web-app
username: placer-user
password: placer123
scope: openid smart-patient-read smart-task-write
HTTP 200
[Asserts]
jsonpath "$.access_token" exists
jsonpath "$.token_type" == "Bearer"


# --- Password grant: fulfiller-user ---

POST {{keycloak_url}}/realms/umzh-connect/protocol/openid-connect/token
[FormParams]
grant_type: password
client_id: web-app
username: fulfiller-user
password: fulfiller123
scope: openid smart-patient-read smart-task-write
HTTP 200
[Asserts]
jsonpath "$.access_token" exists


# --- Bad credentials should fail ---

POST {{keycloak_url}}/realms/umzh-connect/protocol/openid-connect/token
[FormParams]
grant_type: client_credentials
client_id: placer-client
client_secret: wrong-secret
HTTP 401


# --- Bad password should fail ---

POST {{keycloak_url}}/realms/umzh-connect/protocol/openid-connect/token
[FormParams]
grant_type: password
client_id: web-app
username: placer-user
password: wrongpassword
scope: openid
HTTP 401
