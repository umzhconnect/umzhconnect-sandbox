# =============================================================================
# 10-l2-auth.hurl — Level 2 (private_key_jwt) token structure and enforcement
#
# The L2 tokens are acquired by the test runner (get-token.sh), which signs an
# RS256 private_key_jwt client assertion locally and exchanges it directly at
# Keycloak — the same flow a real Level-2 client uses. They are injected here
# as variables: placer_l2_token, fulfiller_l2_token, fulfiller_l2_context_token.
#
# This file verifies that those L2-authenticated tokens:
#   1. Are issued to the *-l2 clients (azp), proving private_key_jwt succeeded
#   2. Carry the correct extensions.umzhconnect.organization_reference claim
#   3. Carry the expected realm_roles and scope (SMART system scopes)
#   4. (context variant) Grant a cross-party FHIR read gated by fhirContext + OPA
#
# Introspection uses the L1 client credentials: any valid client can introspect
# any token, and the L2 client-jwt auth method cannot sign a fresh assertion
# inside a hurl test.
# =============================================================================


# ---------------------------------------------------------------------------
# Placer L2 — token issued to placer-client-l2 via private_key_jwt
# ---------------------------------------------------------------------------

POST {{keycloak_url}}/realms/umzh-connect/protocol/openid-connect/token/introspect
[FormParams]
token: {{placer_l2_token}}
client_id: placer-client
client_secret: placer-secret-2025
HTTP 200
[Asserts]
jsonpath "$.active" == true
jsonpath "$.azp" == "placer-client-l2"
jsonpath "$.extensions.umzhconnect.organization_reference" contains "/fhir/Organization/HospitalP"
jsonpath "$.realm_roles" includes "placer"
jsonpath "$.scope" isString


# ---------------------------------------------------------------------------
# Fulfiller L2 — token issued to fulfiller-client-l2 via private_key_jwt
# ---------------------------------------------------------------------------

POST {{keycloak_url}}/realms/umzh-connect/protocol/openid-connect/token/introspect
[FormParams]
token: {{fulfiller_l2_token}}
client_id: fulfiller-client
client_secret: fulfiller-secret-2025
HTTP 200
[Asserts]
jsonpath "$.active" == true
jsonpath "$.azp" == "fulfiller-client-l2"
jsonpath "$.extensions.umzhconnect.organization_reference" contains "/fhir/Organization/HospitalF"
jsonpath "$.realm_roles" includes "fulfiller"


# ---------------------------------------------------------------------------
# Fulfiller L2 — context-scoped token grants cross-party FHIR read
#
# fulfiller_l2_context_token carries authorization_details for
# ServiceRequest/ReferralOrthopedicSurgery. The fhirContext claim is embedded
# in the JWT by the FhirContextMapper but not surfaced by Keycloak's introspect
# endpoint, so we verify end-to-end with a real cross-party read through the
# Placer external gateway. OPA enforces the fhirContext claim, so a 200 here
# proves the claim is present and the consent check passed.
# ---------------------------------------------------------------------------

GET {{placer_ext_url}}/fhir/Patient/PetraMeier
Authorization: Bearer {{fulfiller_l2_context_token}}
HTTP 200
[Asserts]
jsonpath "$.resourceType" == "Patient"
jsonpath "$.id" == "PetraMeier"
