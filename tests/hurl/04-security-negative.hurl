# =============================================================================
# 04-security-negative.hurl — Security Boundary Tests
#
# Verify JWT enforcement and partition isolation.
# =============================================================================


# --- No Authorization header on internal gateways -> 401 ---

GET {{placer_url}}/fhir/Patient/PetraMeier
HTTP 401

GET {{fulfiller_url}}/fhir/Organization/fulfiller-HospitalF
HTTP 401


# --- No Authorization header on external gateways -> 401 ---

GET {{placer_ext_url}}/fhir/Patient/PetraMeier
HTTP 401

GET {{fulfiller_ext_url}}/fhir/Task
HTTP 401


# --- Malformed JWT -> 401 ---

GET {{placer_url}}/fhir/Patient/PetraMeier
Authorization: Bearer not-a-valid-jwt
HTTP 401


# --- Tampered JWT (valid structure, invalid signature) -> 401 ---

GET {{placer_url}}/fhir/Patient/PetraMeier
Authorization: Bearer eyJhbGciOiJSUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIiwiZXhwIjoxMDAwMDAwMDAwfQ.invalid_signature
HTTP 401


# --- Partition isolation: Fulfiller internal cannot see Placer-only data ---
# Patient/PetraMeier lives in the placer partition, not fulfiller.

GET {{fulfiller_url}}/fhir/Patient/PetraMeier
Authorization: Bearer {{fulfiller_token}}
HTTP 404


# --- Partition isolation: Placer internal cannot see Fulfiller-only data ---
# Organization/fulfiller-HospitalF lives in the fulfiller partition only.
# The placer partition has Organization/placer-HospitalF instead.

GET {{placer_url}}/fhir/Organization/fulfiller-HospitalF
Authorization: Bearer {{placer_token}}
HTTP 404


# --- Metadata endpoints work WITHOUT auth ---

GET {{placer_url}}/fhir/metadata
HTTP 200
[Asserts]
jsonpath "$.resourceType" == "CapabilityStatement"

GET {{fulfiller_url}}/fhir/metadata
HTTP 200
[Asserts]
jsonpath "$.resourceType" == "CapabilityStatement"
