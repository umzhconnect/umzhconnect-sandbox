# =============================================================================
# 08-context-enforcement.hurl — Context-centric access control enforcement
#
# Validates that the placer-external gateway enforces context-graph membership
# using the fhirContext claim from a RFC 9396 authorization_details token.
#
# Enforcement chain:
#   1. openid-connect — validates JWT, enforces bearer token presence
#   2. opa plugin     — calls OPA; 403 on deny, passes through on allow
#   3. upstream       — HAPI FHIR serves the resource (only reached when allowed)
#
# OPA resolves the Consent by searching
#   GET /Consent?data=ServiceRequest/<id>&status=active
# and verifies provision.actor[].reference.reference == token.party_id (exact).
#
# ReferralOrthopedicSurgery graph includes:
#   Patient/PetraMeier, Condition/SuspectedACLRupture,
#   Condition/HeartFailureHFrEF, ServiceRequest/ReferralOrthopedicSurgery,
#   MedicationStatement/*, Coverage/CoverageMeier,
#   DocumentReference/DocCardiologyAttachment, PractitionerRole/HansMusterRole
#
# NOT in ReferralOrthopedicSurgery graph:
#   Condition/SarcomaKnee  (only in ReferralTumorboard)
#   ImagingStudy/ImagingCT (only in ReferralTumorboard)
# =============================================================================


# ---------------------------------------------------------------------------
# Setup — Refresh Consent end date so the test is time-independent
# ---------------------------------------------------------------------------

PATCH {{placer_url}}/fhir/Consent/ConsentOrthopedicReferral
Authorization: Bearer {{placer_user_token}}
Content-Type: application/json-patch+json
[
  {"op": "replace", "path": "/provision/period/end", "value": "{{consent_end}}"}
]
HTTP 200


# ---------------------------------------------------------------------------
# Step 1 — Acquire a context-scoped token for ReferralOrthopedicSurgery
# ---------------------------------------------------------------------------

POST {{keycloak_url}}/realms/umzh-connect/protocol/openid-connect/token
[FormParams]
grant_type: client_credentials
client_id: fulfiller-client
client_secret: fulfiller-secret-2025
scope: smart-clinical-read smart-servicerequest-read
authorization_details: [{"type":"umzh-connect-context","identifier":"ServiceRequest/ReferralOrthopedicSurgery"}]
HTTP 200
[Captures]
ortho_token: jsonpath "$.access_token"
[Asserts]
jsonpath "$.access_token" exists


# ---------------------------------------------------------------------------
# POSITIVE TEST — Resource IS in the context graph
# ---------------------------------------------------------------------------

GET {{placer_ext_url}}/fhir/Condition/SuspectedACLRupture
Authorization: Bearer {{ortho_token}}
HTTP 200
[Asserts]
jsonpath "$.resourceType" == "Condition"
jsonpath "$.id"           == "SuspectedACLRupture"


# ---------------------------------------------------------------------------
# NEGATIVE TEST — Resource is NOT in the context graph
# ---------------------------------------------------------------------------

GET {{placer_ext_url}}/fhir/Condition/SarcomaKnee
Authorization: Bearer {{ortho_token}}
HTTP 403


# ---------------------------------------------------------------------------
# POSITIVE TEST — Tumorboard context grants access to its own graph
# ---------------------------------------------------------------------------

POST {{keycloak_url}}/realms/umzh-connect/protocol/openid-connect/token
[FormParams]
grant_type: client_credentials
client_id: fulfiller-client
client_secret: fulfiller-secret-2025
scope: smart-clinical-read
authorization_details: [{"type":"umzh-connect-context","identifier":"ServiceRequest/ReferralTumorboard"}]
HTTP 200
[Captures]
tumor_token: jsonpath "$.access_token"
[Asserts]
jsonpath "$.access_token" exists

GET {{placer_ext_url}}/fhir/ImagingStudy/ImagingCT
Authorization: Bearer {{tumor_token}}
HTTP 200
[Asserts]
jsonpath "$.resourceType" == "ImagingStudy"
jsonpath "$.id"           == "ImagingCT"


# ---------------------------------------------------------------------------
# NEGATIVE TEST — Cross-context: tumorboard token denied for orthopedic data
# ---------------------------------------------------------------------------

GET {{placer_ext_url}}/fhir/MedicationStatement/MedicationEntresto
Authorization: Bearer {{tumor_token}}
HTTP 403


# ---------------------------------------------------------------------------
# REVOCATION TEST — Inactive Consent → denied with the same token
# ---------------------------------------------------------------------------

# Flip ConsentOrthopedicReferral to inactive via the placer internal gateway
PATCH {{placer_url}}/fhir/Consent/ConsentOrthopedicReferral
Authorization: Bearer {{placer_user_token}}
Content-Type: application/json-patch+json
[
  {"op": "replace", "path": "/status", "value": "inactive"}
]
HTTP 200

# Cross-party read must now be denied — Consent.status=inactive → search returns no valid entry
GET {{placer_ext_url}}/fhir/Condition/SuspectedACLRupture
Authorization: Bearer {{ortho_token}}
HTTP 403

# Restore Consent to active so subsequent tests still work
PATCH {{placer_url}}/fhir/Consent/ConsentOrthopedicReferral
Authorization: Bearer {{placer_user_token}}
Content-Type: application/json-patch+json
[
  {"op": "replace", "path": "/status", "value": "active"}
]
HTTP 200


# ---------------------------------------------------------------------------
# EXPIRY TEST — Expired provision.period.end → denied even if status=active
# ---------------------------------------------------------------------------

# Set provision.period.end to a date in the past
PATCH {{placer_url}}/fhir/Consent/ConsentOrthopedicReferral
Authorization: Bearer {{placer_user_token}}
Content-Type: application/json-patch+json
[
  {"op": "replace", "path": "/provision/period/end", "value": "2020-01-01"}
]
HTTP 200

# Cross-party read must now be denied — period.end is in the past
GET {{placer_ext_url}}/fhir/Condition/SuspectedACLRupture
Authorization: Bearer {{ortho_token}}
HTTP 403

# Restore to fresh future date (now + 3 months, computed by run-tests.sh)
PATCH {{placer_url}}/fhir/Consent/ConsentOrthopedicReferral
Authorization: Bearer {{placer_user_token}}
Content-Type: application/json-patch+json
[
  {"op": "replace", "path": "/provision/period/end", "value": "{{consent_end}}"}
]
HTTP 200

# Confirm access is restored
GET {{placer_ext_url}}/fhir/Condition/SuspectedACLRupture
Authorization: Bearer {{ortho_token}}
HTTP 200
[Asserts]
jsonpath "$.id" == "SuspectedACLRupture"
