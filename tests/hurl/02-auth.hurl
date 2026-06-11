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
HTTP 200
[Captures]
fulfiller_cc_token: jsonpath "$.access_token"
[Asserts]
jsonpath "$.access_token" exists
jsonpath "$.token_type" == "Bearer"


# --- Fulfiller with RFC 9396 authorization_details (fhirContext) ---

POST {{keycloak_url}}/realms/umzh-connect/protocol/openid-connect/token
[FormParams]
grant_type: client_credentials
client_id: fulfiller-client
client_secret: fulfiller-secret-2025
authorization_details: [{"type":"umzh-connect-context","identifier":"ServiceRequest/ReferralOrthopedicSurgery"}]
HTTP 200
[Captures]
fulfiller_context_token: jsonpath "$.access_token"
[Asserts]
jsonpath "$.access_token" exists

# organization_reference must be the full Registry URL, not a short name
POST {{keycloak_url}}/realms/umzh-connect/protocol/openid-connect/token/introspect
[FormParams]
token: {{fulfiller_context_token}}
client_id: fulfiller-client
client_secret: fulfiller-secret-2025
HTTP 200
[Asserts]
jsonpath "$.active" == true
jsonpath "$.extensions.umzhconnect.organization_reference" contains "/fhir/Organization/HospitalF"


# --- M2M with explicit system/* scope request ---
#
# Demonstrates the SMART Backend Services pattern: a client narrows or
# declares intent by requesting a specific system/<Resource>.<perms> scope
# at token time. The granted scope set is the union of the client's
# defaultClientScopes and any explicitly-requested scopes the client is
# entitled to. The introspection below confirms system/Patient.r lands in
# the access token's `scope` claim — the same string OPA's has_smart_scope
# parses.

POST {{keycloak_url}}/realms/umzh-connect/protocol/openid-connect/token
[FormParams]
grant_type: client_credentials
client_id: placer-client
client_secret: placer-secret-2025
scope: system/Patient.r
HTTP 200
[Captures]
placer_scoped_token: jsonpath "$.access_token"
[Asserts]
jsonpath "$.access_token" exists
jsonpath "$.scope" contains "system/Patient.r"

POST {{keycloak_url}}/realms/umzh-connect/protocol/openid-connect/token/introspect
[FormParams]
token: {{placer_scoped_token}}
client_id: placer-client
client_secret: placer-secret-2025
HTTP 200
[Asserts]
jsonpath "$.active" == true
jsonpath "$.scope" contains "system/Patient.r"


# --- Password grant: placer-user ---

POST {{keycloak_url}}/realms/umzh-connect/protocol/openid-connect/token
[FormParams]
grant_type: password
client_id: web-app
username: placer-user
password: placer123
scope: openid
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
scope: openid
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
HTTP 400
