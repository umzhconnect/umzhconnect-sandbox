# =============================================================================
# 03-fhir-crud.hurl — FHIR CRUD Operations (Internal Gateways)
#
# Read seed data, create, read-back, and update resources.
# Uses pre-acquired tokens passed via --variable.
# =============================================================================


# --- READ: Patient from Placer internal ---

GET {{placer_url}}/fhir/Patient/PetraMeier
Authorization: Bearer {{placer_token}}
HTTP 200
[Asserts]
jsonpath "$.resourceType" == "Patient"
jsonpath "$.id" == "PetraMeier"
jsonpath "$.name[0].family" == "Meier"
jsonpath "$.name[0].given[0]" == "Petra"
jsonpath "$.gender" == "female"
jsonpath "$.birthDate" == "1992-03-26"


# --- READ: Condition from Placer internal ---

GET {{placer_url}}/fhir/Condition/SuspectedACLRupture
Authorization: Bearer {{placer_token}}
HTTP 200
[Asserts]
jsonpath "$.resourceType" == "Condition"
jsonpath "$.id" == "SuspectedACLRupture"
jsonpath "$.subject.reference" == "Patient/PetraMeier"
jsonpath "$.clinicalStatus.coding[0].code" == "active"
jsonpath "$.verificationStatus.coding[0].code" == "provisional"


# --- READ: ServiceRequest from Placer internal ---

GET {{placer_url}}/fhir/ServiceRequest/ReferralOrthopedicSurgery
Authorization: Bearer {{placer_token}}
HTTP 200
[Asserts]
jsonpath "$.resourceType" == "ServiceRequest"
jsonpath "$.id" == "ReferralOrthopedicSurgery"
jsonpath "$.status" == "active"
jsonpath "$.intent" == "order"
jsonpath "$.subject.reference" == "Patient/PetraMeier"
jsonpath "$.requester.reference" == "PractitionerRole/HansMusterRole"
jsonpath "$.reasonReference[0].reference" == "Condition/SuspectedACLRupture"


# --- READ: Second ServiceRequest (tumorboard) ---

GET {{placer_url}}/fhir/ServiceRequest/ReferralTumorboard
Authorization: Bearer {{placer_token}}
HTTP 200
[Asserts]
jsonpath "$.resourceType" == "ServiceRequest"
jsonpath "$.id" == "ReferralTumorboard"
jsonpath "$.status" == "active"
jsonpath "$.subject.reference" == "Patient/PetraMeier"
jsonpath "$.reasonReference[0].reference" == "Condition/SarcomaKnee"


# --- READ: Consent from Placer internal ---

GET {{placer_url}}/fhir/Consent/ConsentOrthopedicReferral
Authorization: Bearer {{placer_token}}
HTTP 200
[Asserts]
jsonpath "$.resourceType" == "Consent"
jsonpath "$.id" == "ConsentOrthopedicReferral"
jsonpath "$.status" == "active"
jsonpath "$.patient.reference" == "Patient/PetraMeier"


# --- READ: Organizations and Endpoints from registry (public, no auth required) ---

GET {{registry_url}}/fhir/Organization/HospitalF
HTTP 200
[Asserts]
jsonpath "$.id" == "HospitalF"
jsonpath "$.endpoint[0].reference" contains "Endpoint/EndpointHospitalF"

GET {{registry_url}}/fhir/Organization/HospitalP
HTTP 200
[Asserts]
jsonpath "$.id" == "HospitalP"
jsonpath "$.endpoint[0].reference" contains "Endpoint/EndpointHospitalP"

GET {{registry_url}}/fhir/Endpoint/EndpointHospitalF
HTTP 200
[Asserts]
jsonpath "$.id" == "EndpointHospitalF"

GET {{registry_url}}/fhir/Endpoint/EndpointHospitalP
HTTP 200
[Asserts]
jsonpath "$.id" == "EndpointHospitalP"

# --- SEARCH: Organization with _include returns Endpoint entries too ---

GET {{registry_url}}/fhir/Organization?_include=Organization:endpoint
HTTP 200
[Asserts]
jsonpath "$.entry[*].resource.resourceType" includes "Organization"
jsonpath "$.entry[*].resource.resourceType" includes "Endpoint"


# --- SEARCH: Patient search with _count ---

GET {{placer_url}}/fhir/Patient?_count=5
Authorization: Bearer {{placer_token}}
HTTP 200
[Asserts]
jsonpath "$.resourceType" == "Bundle"
jsonpath "$.type" == "searchset"


# --- READ: Questionnaire from DEFAULT partition (direct HAPI, no auth) ---

GET {{hapi_url}}/fhir/DEFAULT/Questionnaire/QuestionnaireSmokingStatus
HTTP 200
[Asserts]
jsonpath "$.resourceType" == "Questionnaire"
jsonpath "$.id" == "QuestionnaireSmokingStatus"
jsonpath "$.status" == "active"


# --- CREATE: New Observation in Placer partition ---

POST {{placer_url}}/fhir/Observation
Authorization: Bearer {{placer_token}}
Content-Type: application/fhir+json
{
  "resourceType": "Observation",
  "status": "final",
  "code": {
    "coding": [
      {
        "system": "http://loinc.org",
        "code": "8302-2",
        "display": "Body height"
      }
    ]
  },
  "subject": {
    "reference": "Patient/PetraMeier"
  },
  "valueQuantity": {
    "value": 168,
    "unit": "cm",
    "system": "http://unitsofmeasure.org",
    "code": "cm"
  }
}
HTTP 201
[Captures]
created_obs_id: jsonpath "$.id"
[Asserts]
jsonpath "$.resourceType" == "Observation"
jsonpath "$.status" == "final"


# --- READ BACK: Verify the created Observation ---

GET {{placer_url}}/fhir/Observation/{{created_obs_id}}
Authorization: Bearer {{placer_token}}
HTTP 200
[Asserts]
jsonpath "$.resourceType" == "Observation"
jsonpath "$.id" == "{{created_obs_id}}"
jsonpath "$.valueQuantity.value" == 168


# --- UPDATE: Change Observation status to amended ---

PUT {{placer_url}}/fhir/Observation/{{created_obs_id}}
Authorization: Bearer {{placer_token}}
Content-Type: application/fhir+json
{
  "resourceType": "Observation",
  "id": "{{created_obs_id}}",
  "status": "amended",
  "code": {
    "coding": [
      {
        "system": "http://loinc.org",
        "code": "8302-2",
        "display": "Body height"
      }
    ]
  },
  "subject": {
    "reference": "Patient/PetraMeier"
  },
  "valueQuantity": {
    "value": 169,
    "unit": "cm",
    "system": "http://unitsofmeasure.org",
    "code": "cm"
  }
}
HTTP 200
[Asserts]
jsonpath "$.status" == "amended"
jsonpath "$.valueQuantity.value" == 169
