# =============================================================================
# 05-cross-party-consent.hurl — Cross-Party Consent-Gated Access
#
# Validates the Fulfiller reading Placer data via the Placer External gateway
# (8081) using a consent-scoped JWT. Tests both orthopedic and tumorboard
# consent scenarios.
# =============================================================================


# --- Step 1: Acquire a consent-scoped token for ConsentOrthopedicReferral ---

POST {{keycloak_url}}/realms/umzh-connect/protocol/openid-connect/token
[FormParams]
grant_type: client_credentials
client_id: fulfiller-client
client_secret: fulfiller-secret-2025
scope: smart-patient-read smart-clinical-read smart-servicerequest-read smart-task-write consent:ConsentOrthopedicReferral
HTTP 200
[Captures]
consent_token: jsonpath "$.access_token"
[Asserts]
jsonpath "$.scope" contains "consent:ConsentOrthopedicReferral"


# --- Step 2: Read Patient/PetraMeier via Placer External (in consent graph) ---

GET {{placer_ext_url}}/fhir/Patient/PetraMeier
Authorization: Bearer {{consent_token}}
HTTP 200
[Asserts]
jsonpath "$.resourceType" == "Patient"
jsonpath "$.id" == "PetraMeier"


# --- Step 3: Read Condition/SuspectedACLRupture (in consent graph) ---

GET {{placer_ext_url}}/fhir/Condition/SuspectedACLRupture
Authorization: Bearer {{consent_token}}
HTTP 200
[Asserts]
jsonpath "$.resourceType" == "Condition"
jsonpath "$.id" == "SuspectedACLRupture"


# --- Step 4: Read ServiceRequest/ReferralOrthopedicSurgery (in consent graph) ---

GET {{placer_ext_url}}/fhir/ServiceRequest/ReferralOrthopedicSurgery
Authorization: Bearer {{consent_token}}
HTTP 200
[Asserts]
jsonpath "$.resourceType" == "ServiceRequest"
jsonpath "$.id" == "ReferralOrthopedicSurgery"


# --- Step 5: Read Coverage/CoverageMeier (in consent graph) ---

GET {{placer_ext_url}}/fhir/Coverage/CoverageMeier
Authorization: Bearer {{consent_token}}
HTTP 200
[Asserts]
jsonpath "$.resourceType" == "Coverage"
jsonpath "$.id" == "CoverageMeier"


# --- Step 6: Read MedicationStatement (in consent graph) ---

GET {{placer_ext_url}}/fhir/MedicationStatement/MedicationEntresto
Authorization: Bearer {{consent_token}}
HTTP 200
[Asserts]
jsonpath "$.resourceType" == "MedicationStatement"
jsonpath "$.id" == "MedicationEntresto"


# --- Step 7: Read Practitioner/HansMuster (in consent graph) ---

GET {{placer_ext_url}}/fhir/Practitioner/HansMuster
Authorization: Bearer {{consent_token}}
HTTP 200
[Asserts]
jsonpath "$.resourceType" == "Practitioner"
jsonpath "$.id" == "HansMuster"


# --- Step 8: Test second consent — ConsentTumorboardReferral ---

POST {{keycloak_url}}/realms/umzh-connect/protocol/openid-connect/token
[FormParams]
grant_type: client_credentials
client_id: fulfiller-client
client_secret: fulfiller-secret-2025
scope: smart-patient-read smart-clinical-read consent:ConsentTumorboardReferral
HTTP 200
[Captures]
tumor_consent_token: jsonpath "$.access_token"
[Asserts]
jsonpath "$.scope" contains "consent:ConsentTumorboardReferral"

# Read Patient (in tumorboard consent graph too)
GET {{placer_ext_url}}/fhir/Patient/PetraMeier
Authorization: Bearer {{tumor_consent_token}}
HTTP 200
[Asserts]
jsonpath "$.id" == "PetraMeier"

# Read ImagingStudy/ImagingCT (in tumorboard consent graph)
GET {{placer_ext_url}}/fhir/ImagingStudy/ImagingCT
Authorization: Bearer {{tumor_consent_token}}
HTTP 200
[Asserts]
jsonpath "$.resourceType" == "ImagingStudy"
jsonpath "$.id" == "ImagingCT"

# Read AllergyIntolerance/AllergyGado (in tumorboard consent graph)
GET {{placer_ext_url}}/fhir/AllergyIntolerance/AllergyGado
Authorization: Bearer {{tumor_consent_token}}
HTTP 200
[Asserts]
jsonpath "$.resourceType" == "AllergyIntolerance"
jsonpath "$.id" == "AllergyGado"


