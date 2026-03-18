# =============================================================================
# 01-health.hurl — Service Health Checks
#
# Smoke tests: verify every service endpoint responds correctly.
# =============================================================================


# --- KrakenD Gateways ---

GET {{placer_url}}/__health
HTTP 200

GET {{placer_ext_url}}/__health
HTTP 200

GET {{fulfiller_url}}/__health
HTTP 200

GET {{fulfiller_ext_url}}/__health
HTTP 200


# --- HAPI FHIR Metadata (via gateways, no auth required) ---

GET {{placer_url}}/fhir/metadata
HTTP 200
[Asserts]
jsonpath "$.resourceType" == "CapabilityStatement"
jsonpath "$.status" == "active"

GET {{fulfiller_url}}/fhir/metadata
HTTP 200
[Asserts]
jsonpath "$.resourceType" == "CapabilityStatement"

# HAPI FHIR direct (DEFAULT partition)
GET {{hapi_url}}/fhir/DEFAULT/metadata
HTTP 200
[Asserts]
jsonpath "$.resourceType" == "CapabilityStatement"


# --- Keycloak ---

GET {{keycloak_url}}/realms/umzh-connect/.well-known/openid-configuration
HTTP 200
[Asserts]
jsonpath "$.issuer" exists
jsonpath "$.token_endpoint" exists
jsonpath "$.jwks_uri" exists


# --- OPA ---

GET {{opa_placer_url}}/health
HTTP 200

GET {{opa_fulfiller_url}}/health
HTTP 200


# --- Reseed API ---

GET {{reseed_url}}/health
HTTP 200
[Asserts]
jsonpath "$.status" == "ok"
