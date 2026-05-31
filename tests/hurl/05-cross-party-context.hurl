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


# --- Step 1: Context-scoped token for ReferralOrthopedicSurgery ---
# Injected by the runner as fulfiller_context_token — acquired via
# authorization_details so the JWT carries a fhirContext claim. L1 by default,
# L2 under -l2; the token is structurally identical, only client auth differs.


# --- Step 2: Read Patient/PetraMeier via Placer External (in SR graph) ---

GET {{placer_ext_url}}/fhir/Patient/PetraMeier
Authorization: Bearer {{fulfiller_context_token}}
HTTP 200
[Asserts]
jsonpath "$.resourceType" == "Patient"
jsonpath "$.id" == "PetraMeier"


# --- Step 3: Read Condition/SuspectedACLRupture (in SR graph) ---

GET {{placer_ext_url}}/fhir/Condition/SuspectedACLRupture
Authorization: Bearer {{fulfiller_context_token}}
HTTP 200
[Asserts]
jsonpath "$.resourceType" == "Condition"
jsonpath "$.id" == "SuspectedACLRupture"


# --- Step 4: Read ServiceRequest/ReferralOrthopedicSurgery (in SR graph) ---

GET {{placer_ext_url}}/fhir/ServiceRequest/ReferralOrthopedicSurgery
Authorization: Bearer {{fulfiller_context_token}}
HTTP 200
[Asserts]
jsonpath "$.resourceType" == "ServiceRequest"
jsonpath "$.id" == "ReferralOrthopedicSurgery"


# --- Step 5: Read Coverage/CoverageMeier (in SR graph) ---

GET {{placer_ext_url}}/fhir/Coverage/CoverageMeier
Authorization: Bearer {{fulfiller_context_token}}
HTTP 200
[Asserts]
jsonpath "$.resourceType" == "Coverage"
jsonpath "$.id" == "CoverageMeier"


# --- Step 6: Read MedicationStatement (in SR graph) ---

GET {{placer_ext_url}}/fhir/MedicationStatement/MedicationEntresto
Authorization: Bearer {{fulfiller_context_token}}
HTTP 200
[Asserts]
jsonpath "$.resourceType" == "MedicationStatement"
jsonpath "$.id" == "MedicationEntresto"


# --- Step 7: Read Practitioner/HansMuster (directory — Rule 6) ---

GET {{placer_ext_url}}/fhir/Practitioner/HansMuster
Authorization: Bearer {{fulfiller_context_token}}
HTTP 200
[Asserts]
jsonpath "$.resourceType" == "Practitioner"
jsonpath "$.id" == "HansMuster"


# --- Step 8: Second context — ReferralTumorboard ---
# Injected as fulfiller_context_tumorboard_token (L1 by default, L2 under -l2).

# Read Patient (in tumorboard SR graph too)
GET {{placer_ext_url}}/fhir/Patient/PetraMeier
Authorization: Bearer {{fulfiller_context_tumorboard_token}}
HTTP 200
[Asserts]
jsonpath "$.id" == "PetraMeier"

# Read ImagingStudy/ImagingCT (in tumorboard SR graph)
GET {{placer_ext_url}}/fhir/ImagingStudy/ImagingCT
Authorization: Bearer {{fulfiller_context_tumorboard_token}}
HTTP 200
[Asserts]
jsonpath "$.resourceType" == "ImagingStudy"
jsonpath "$.id" == "ImagingCT"

# Read AllergyIntolerance/AllergyGado (in tumorboard SR graph)
GET {{placer_ext_url}}/fhir/AllergyIntolerance/AllergyGado
Authorization: Bearer {{fulfiller_context_tumorboard_token}}
HTTP 200
[Asserts]
jsonpath "$.resourceType" == "AllergyIntolerance"
jsonpath "$.id" == "AllergyGado"
