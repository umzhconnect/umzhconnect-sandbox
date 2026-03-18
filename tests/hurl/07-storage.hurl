# =============================================================================
# 07-storage.hurl — Data Integrity, Reseed & Partition Isolation
#
# Tests reseed idempotency, partition correctness, and data lifecycle.
# This test runs LAST because reseed wipes all data.
# =============================================================================


# --- Step 1: Create a test resource ---

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
        "code": "29463-7",
        "display": "Body weight"
      }
    ]
  },
  "subject": {
    "reference": "Patient/PetraMeier"
  },
  "valueQuantity": {
    "value": 65,
    "unit": "kg",
    "system": "http://unitsofmeasure.org",
    "code": "kg"
  }
}
HTTP 201
[Captures]
pre_reseed_obs_id: jsonpath "$.id"

# Verify it exists
GET {{placer_url}}/fhir/Observation/{{pre_reseed_obs_id}}
Authorization: Bearer {{placer_token}}
HTTP 200
[Asserts]
jsonpath "$.resourceType" == "Observation"


# --- Step 2: Reseed — wipes and reloads all data ---

POST {{reseed_url}}/reseed
HTTP 200
[Asserts]
jsonpath "$.success" == true


# --- Step 3: Verify test resource is gone after reseed ---

GET {{placer_url}}/fhir/Observation/{{pre_reseed_obs_id}}
Authorization: Bearer {{placer_token}}
HTTP 404


# --- Step 4: Verify seed data restored after reseed ---

# Patient still in placer
GET {{placer_url}}/fhir/Patient/PetraMeier
Authorization: Bearer {{placer_token}}
HTTP 200
[Asserts]
jsonpath "$.id" == "PetraMeier"
jsonpath "$.name[0].family" == "Meier"

# ServiceRequest still in placer
GET {{placer_url}}/fhir/ServiceRequest/ReferralOrthopedicSurgery
Authorization: Bearer {{placer_token}}
HTTP 200
[Asserts]
jsonpath "$.id" == "ReferralOrthopedicSurgery"
jsonpath "$.status" == "active"

# Consent still in placer
GET {{placer_url}}/fhir/Consent/ConsentOrthopedicReferral
Authorization: Bearer {{placer_token}}
HTTP 200
[Asserts]
jsonpath "$.id" == "ConsentOrthopedicReferral"

# Organizations in fulfiller
GET {{fulfiller_url}}/fhir/Organization/fulfiller-HospitalF
Authorization: Bearer {{fulfiller_token}}
HTTP 200
[Asserts]
jsonpath "$.id" == "fulfiller-HospitalF"

# Questionnaire in DEFAULT (direct HAPI)
GET {{hapi_url}}/fhir/DEFAULT/Questionnaire/QuestionnaireSmokingStatus
HTTP 200
[Asserts]
jsonpath "$.id" == "QuestionnaireSmokingStatus"


# --- Step 5: Partition isolation via direct HAPI access ---
# Placer data should NOT appear in fulfiller partition

GET {{hapi_url}}/fhir/fulfiller/Patient/PetraMeier
HTTP 404

# Fulfiller data should NOT appear in placer partition
GET {{hapi_url}}/fhir/placer/Organization/fulfiller-HospitalF
HTTP 404


# --- Step 6: Create in fulfiller, verify partition correctness ---

POST {{fulfiller_url}}/fhir/Observation
Authorization: Bearer {{fulfiller_token}}
Content-Type: application/fhir+json
{
  "resourceType": "Observation",
  "status": "final",
  "code": {
    "coding": [
      {
        "system": "http://loinc.org",
        "code": "8867-4",
        "display": "Heart rate"
      }
    ]
  },
  "valueQuantity": {
    "value": 72,
    "unit": "bpm",
    "system": "http://unitsofmeasure.org",
    "code": "/min"
  }
}
HTTP 201
[Captures]
fulfiller_obs_id: jsonpath "$.id"

# Exists in fulfiller partition (direct HAPI)
GET {{hapi_url}}/fhir/fulfiller/Observation/{{fulfiller_obs_id}}
HTTP 200
[Asserts]
jsonpath "$.resourceType" == "Observation"

# Does NOT exist in placer partition
GET {{hapi_url}}/fhir/placer/Observation/{{fulfiller_obs_id}}
HTTP 404
