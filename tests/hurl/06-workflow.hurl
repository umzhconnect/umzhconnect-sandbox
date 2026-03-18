# =============================================================================
# 06-workflow.hurl — End-to-End Task Lifecycle
#
# Placer creates a Task at Fulfiller, Fulfiller reads and updates it,
# Placer reads merged all-tasks.
#
# NOTE: Cross-partition references (Patient, ServiceRequest, requester Org)
# must use absolute URLs pointing to the placer FHIR partition. Without this,
# HAPI's auto_create_placeholder_reference_targets creates conflicting
# placeholders in the fulfiller partition (HAPI-0825).
# =============================================================================


# --- Step 1: Placer creates Task at Fulfiller via create-task action ---
# Routes through krakend-placer -> krakend-fulfiller-external -> HAPI /fhir/fulfiller/Task

POST {{placer_url}}/api/actions/create-task
Authorization: Bearer {{placer_token}}
Content-Type: application/fhir+json
{"resourceType":"Task","status":"requested","intent":"order","description":"Please evaluate patient for ACL reconstruction surgery","focus":{"reference":"{{hapi_url}}/fhir/placer/ServiceRequest/ReferralOrthopedicSurgery"},"for":{"reference":"{{hapi_url}}/fhir/placer/Patient/PetraMeier"},"requester":{"reference":"{{hapi_url}}/fhir/placer/Organization/placer-HospitalP"},"owner":{"reference":"Organization/fulfiller-HospitalF"}}
HTTP 201
[Captures]
created_task_id: jsonpath "$.id"
[Asserts]
jsonpath "$.resourceType" == "Task"
jsonpath "$.status" == "requested"


# --- Step 2: Fulfiller reads Task back from own partition ---

GET {{fulfiller_url}}/fhir/Task/{{created_task_id}}
Authorization: Bearer {{fulfiller_token}}
HTTP 200
[Asserts]
jsonpath "$.resourceType" == "Task"
jsonpath "$.id" == "{{created_task_id}}"
jsonpath "$.status" == "requested"
jsonpath "$.description" == "Please evaluate patient for ACL reconstruction surgery"


# --- Step 3: Fulfiller updates Task status to accepted ---

PUT {{fulfiller_url}}/fhir/Task/{{created_task_id}}
Authorization: Bearer {{fulfiller_token}}
Content-Type: application/fhir+json
{"resourceType":"Task","id":"{{created_task_id}}","status":"accepted","intent":"order","description":"Please evaluate patient for ACL reconstruction surgery","focus":{"reference":"{{hapi_url}}/fhir/placer/ServiceRequest/ReferralOrthopedicSurgery"},"for":{"reference":"{{hapi_url}}/fhir/placer/Patient/PetraMeier"},"requester":{"reference":"{{hapi_url}}/fhir/placer/Organization/placer-HospitalP"},"owner":{"reference":"Organization/fulfiller-HospitalF"}}
HTTP 200
[Asserts]
jsonpath "$.status" == "accepted"


# --- Step 4: Verify updated status persisted ---

GET {{fulfiller_url}}/fhir/Task/{{created_task_id}}
Authorization: Bearer {{fulfiller_token}}
HTTP 200
[Asserts]
jsonpath "$.status" == "accepted"


# --- Step 5: Placer reads all-tasks (merges local + remote) ---
# Response is JSON with { local: { Bundle }, remote: { Bundle } }

GET {{placer_url}}/api/actions/all-tasks
Authorization: Bearer {{placer_token}}
HTTP 200
[Asserts]
jsonpath "$.local" exists
jsonpath "$.remote" exists
