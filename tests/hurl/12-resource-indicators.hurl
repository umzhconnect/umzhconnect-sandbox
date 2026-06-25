# =============================================================================
# 12-resource-indicators.hurl — RFC 8707 Resource Indicator Tests
#
# Verifies that Keycloak's resource-indicators experimental feature behaves
# correctly: a valid resource URI restricts the token audience, and an unknown
# resource URI is rejected with invalid_target.
# =============================================================================


# --- Positive: valid resource URI → token issued ---
# placer-client requests a token scoped to the fulfiller external gateway.
# Expects 200 with an access_token.

POST {{keycloak_url}}/realms/umzh-connect/protocol/openid-connect/token
Content-Type: application/x-www-form-urlencoded
[FormParams]
grant_type: client_credentials
client_id: placer-client
client_secret: placer-secret-2025
resource: {{fulfiller_resource_url}}
HTTP 200
[Asserts]
jsonpath "$.access_token" isString
jsonpath "$.token_type" == "Bearer"


# --- Negative: unknown resource URI → invalid_target ---
# A resource URI that matches no registered Keycloak client resource_url
# must be rejected per RFC 8707 §2.

POST {{keycloak_url}}/realms/umzh-connect/protocol/openid-connect/token
Content-Type: application/x-www-form-urlencoded
[FormParams]
grant_type: client_credentials
client_id: placer-client
client_secret: placer-secret-2025
resource: http://not-a-registered-gateway
HTTP 400
[Asserts]
jsonpath "$.error" == "invalid_target"


# --- Negative: registered resource URI but client not authorised for it ---
# placer-client has no audience mapper for placer-external-gateway (its own
# external gateway). The resource URI is registered in Keycloak but not in
# this client's audience — the post-processor must still reject it.

POST {{keycloak_url}}/realms/umzh-connect/protocol/openid-connect/token
Content-Type: application/x-www-form-urlencoded
[FormParams]
grant_type: client_credentials
client_id: placer-client
client_secret: placer-secret-2025
resource: {{placer_resource_url}}
HTTP 400
[Asserts]
jsonpath "$.error" == "invalid_target"
