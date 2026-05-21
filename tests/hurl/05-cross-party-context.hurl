# =============================================================================
# 05-cross-party-context.hurl — Cross-Party Context-Gated Access
#
# Validates the Fulfiller reading Placer data via the Placer External gateway
# (8081) using a fhirContext-scoped JWT acquired via RFC 9396
# authorization_details.  Tests both orthopedic and tumorboard SR contexts.
# =============================================================================


# --- Setup: refresh Consent end dates so tests are time-independent ---

PATCH {{placer_url}}/fhir/Consent/ConsentOrthopedicReferral
Authorization: Bearer {{placer_user_token}}
Content-Type: application/json-patch+json
[
  {"op": "replace", "path": "/provision/period/end", "value": "{{consent_end}}"}
]
HTTP 200

PATCH {{placer_url}}/fhir/Consent/ConsentTumorboardReferral
Authorization: Bearer {{placer_user_token}}
Content-Type: application/json-patch+json
[
  {"op": "replace", "path": "/provision/period/end", "value": "{{consent_end}}"}
]
HTTP 200


# --- Step 1: Acquire a context-scoped token for ReferralOrthopedicSurgery ---

POST {{keycloak_url}}/realms/umzh-connect/protocol/openid-connect/token
[FormParams]
grant_type: client_credentials
client_id: fulfiller-client
client_secret: fulfiller-secret-2025
scope: smart-patient-read smart-clinical-read smart-servicerequest-read smart-task-write
authorization_details: [{"type":"umzh-connect-context","identifier":"ServiceRequest/ReferralOrthopedicSurgery"}]
HTTP 200
[Captures]
context_token: jsonpath "$.access_token"
[Asserts]
jsonpath "$.access_token" exists


# --- Step 2: Read Patient/PetraMeier via Placer External (in SR graph) ---

GET {{placer_ext_url}}/fhir/Patient/PetraMeier
Authorization: Bearer {{context_token}}
HTTP 200
[Asserts]
jsonpath "$.resourceType" == "Patient"
jsonpath "$.id" == "PetraMeier"


# --- Step 3: Read Condition/SuspectedACLRupture (in SR graph) ---

GET {{placer_ext_url}}/fhir/Condition/SuspectedACLRupture
Authorization: Bearer {{context_token}}
HTTP 200
[Asserts]
jsonpath "$.resourceType" == "Condition"
jsonpath "$.id" == "SuspectedACLRupture"


# --- Step 4: Read ServiceRequest/ReferralOrthopedicSurgery (in SR graph) ---

GET {{placer_ext_url}}/fhir/ServiceRequest/ReferralOrthopedicSurgery
Authorization: Bearer {{context_token}}
HTTP 200
[Asserts]
jsonpath "$.resourceType" == "ServiceRequest"
jsonpath "$.id" == "ReferralOrthopedicSurgery"


# --- Step 5: Read Coverage/CoverageMeier (in SR graph) ---

GET {{placer_ext_url}}/fhir/Coverage/CoverageMeier
Authorization: Bearer {{context_token}}
HTTP 200
[Asserts]
jsonpath "$.resourceType" == "Coverage"
jsonpath "$.id" == "CoverageMeier"


# --- Step 6: Read MedicationStatement (in SR graph) ---

GET {{placer_ext_url}}/fhir/MedicationStatement/MedicationEntresto
Authorization: Bearer {{context_token}}
HTTP 200
[Asserts]
jsonpath "$.resourceType" == "MedicationStatement"
jsonpath "$.id" == "MedicationEntresto"


# --- Step 7: Read Practitioner/HansMuster (directory — Rule 6) ---

GET {{placer_ext_url}}/fhir/Practitioner/HansMuster
Authorization: Bearer {{context_token}}
HTTP 200
[Asserts]
jsonpath "$.resourceType" == "Practitioner"
jsonpath "$.id" == "HansMuster"


# --- Step 8: Test second context — ReferralTumorboard ---

POST {{keycloak_url}}/realms/umzh-connect/protocol/openid-connect/token
[FormParams]
grant_type: client_credentials
client_id: fulfiller-client
client_secret: fulfiller-secret-2025
scope: smart-patient-read smart-clinical-read
authorization_details: [{"type":"umzh-connect-context","identifier":"ServiceRequest/ReferralTumorboard"}]
HTTP 200
[Captures]
tumor_context_token: jsonpath "$.access_token"
[Asserts]
jsonpath "$.access_token" exists

# Read Patient (in tumorboard SR graph too)
GET {{placer_ext_url}}/fhir/Patient/PetraMeier
Authorization: Bearer {{tumor_context_token}}
HTTP 200
[Asserts]
jsonpath "$.id" == "PetraMeier"

# Read ImagingStudy/ImagingCT (in tumorboard SR graph)
GET {{placer_ext_url}}/fhir/ImagingStudy/ImagingCT
Authorization: Bearer {{tumor_context_token}}
HTTP 200
[Asserts]
jsonpath "$.resourceType" == "ImagingStudy"
jsonpath "$.id" == "ImagingCT"

# Read AllergyIntolerance/AllergyGado (in tumorboard SR graph)
GET {{placer_ext_url}}/fhir/AllergyIntolerance/AllergyGado
Authorization: Bearer {{tumor_context_token}}
HTTP 200
[Asserts]
jsonpath "$.resourceType" == "AllergyIntolerance"
jsonpath "$.id" == "AllergyGado"
