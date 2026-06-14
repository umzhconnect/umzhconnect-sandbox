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
# Routes through apisix-placer-internal -> apisix-fulfiller-external -> HAPI /fhir/fulfiller/Task

POST {{placer_url}}/api/actions/create-task
Authorization: Bearer {{placer_token}}
Content-Type: application/fhir+json
{"resourceType":"Task","status":"requested","intent":"order","description":"Please evaluate patient for ACL reconstruction surgery","focus":{"reference":"{{hapi_url}}/fhir/placer/ServiceRequest/ReferralOrthopedicSurgery"},"for":{"reference":"{{hapi_url}}/fhir/placer/Patient/PetraMeier"},"requester":{"reference":"{{registry_url}}/fhir/Organization/HospitalP"},"owner":{"reference":"{{registry_url}}/fhir/Organization/HospitalF"}}
# FHIR returns 201 Created for new resources
HTTP 201
[Captures]
created_task_id: jsonpath "$.id"
[Asserts]
jsonpath "$.resourceType" == "Task"
jsonpath "$.status" == "requested"


# --- Step 1b: Placer creates Task directly via Fulfiller's external gateway ---
# Positive test for ext-task-create (JWT-only, no OPA). Bypasses the placer
# internal action endpoint and hits the fulfiller external gateway directly.

POST {{fulfiller_ext_url}}/fhir/Task
Authorization: Bearer {{placer_token}}
Content-Type: application/fhir+json
{"resourceType":"Task","status":"requested","intent":"order","description":"Direct external create test","focus":{"reference":"{{hapi_url}}/fhir/placer/ServiceRequest/ReferralOrthopedicSurgery"},"for":{"reference":"{{hapi_url}}/fhir/placer/Patient/PetraMeier"},"requester":{"reference":"{{registry_url}}/fhir/Organization/HospitalP"},"owner":{"reference":"{{registry_url}}/fhir/Organization/HospitalF"}}
HTTP 201
[Captures]
ext_created_task_id: jsonpath "$.id"
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

PATCH {{fulfiller_url}}/fhir/Task/{{created_task_id}}
Authorization: Bearer {{fulfiller_token}}
Content-Type: application/json-patch+json
[{"op":"replace","path":"/status","value":"accepted"}]
HTTP 200
[Asserts]
jsonpath "$.status" == "accepted"


# --- Step 4: Verify updated status persisted ---

GET {{fulfiller_url}}/fhir/Task/{{created_task_id}}
Authorization: Bearer {{fulfiller_token}}
HTTP 200
[Asserts]
jsonpath "$.status" == "accepted"


# --- Step 5: Placer must NOT update the Fulfiller's Task cross-party ---
# Task writes are owner-only (OPA Rule 1d). The placer is the requester, not the
# owner (HospitalF), so even a PATCH of an IG-patchable field (businessStatus) is
# denied. (A non-patchable field such as /status would be 400 at the
# capability-guard, before OPA is consulted.)

PATCH {{fulfiller_ext_url}}/fhir/Task/{{created_task_id}}
Authorization: Bearer {{placer_token}}
Content-Type: application/json-patch+json
[{"op":"replace","path":"/businessStatus","value":{"text":"in-progress"}}]
HTTP 403


# --- Step 5b: PUT on external gateway must be rejected — APISIX returns 404 (no matching route) ---

PUT {{fulfiller_ext_url}}/fhir/Task/{{created_task_id}}
Authorization: Bearer {{placer_token}}
Content-Type: application/fhir+json
{"resourceType":"Task","id":"{{created_task_id}}","status":"in-progress","intent":"order"}
HTTP 404


# --- Step 5c: Positive PATCH businessStatus via external gateway ---
# Transfer ownership to HospitalP so that the placer token satisfies the
# OPA owner check (Rule 1d) on the external gateway.

PATCH {{fulfiller_url}}/fhir/Task/{{created_task_id}}
Authorization: Bearer {{fulfiller_token}}
Content-Type: application/json-patch+json
[{"op":"replace","path":"/owner","value":{"reference":"{{registry_url}}/fhir/Organization/HospitalP"}}]
HTTP 200
[Asserts]
jsonpath "$.owner.reference" == "{{registry_url}}/fhir/Organization/HospitalP"


# Placer (now the owner) PATCHes an IG-patchable field via external gateway → 200.
# Validates capability-guard passes businessStatus and OPA Rule 1d grants access.

PATCH {{fulfiller_ext_url}}/fhir/Task/{{created_task_id}}
Authorization: Bearer {{placer_token}}
Content-Type: application/json-patch+json
[{"op":"add","path":"/businessStatus","value":{"text":"in-progress"}}]
HTTP 200
[Asserts]
jsonpath "$.businessStatus.text" == "in-progress"


# Restore owner to HospitalF so subsequent steps behave normally.

PATCH {{fulfiller_url}}/fhir/Task/{{created_task_id}}
Authorization: Bearer {{fulfiller_token}}
Content-Type: application/json-patch+json
[{"op":"replace","path":"/owner","value":{"reference":"{{registry_url}}/fhir/Organization/HospitalF"}}]
HTTP 200
[Asserts]
jsonpath "$.owner.reference" == "{{registry_url}}/fhir/Organization/HospitalF"


# --- Step 6: Placer reads all-tasks (merges local + remote) ---
# Response is JSON with { local: { Bundle }, remote: { Bundle } }

GET {{placer_url}}/api/actions/all-tasks
Authorization: Bearer {{placer_token}}
HTTP 200
[Asserts]
jsonpath "$.local" exists
jsonpath "$.remote" exists
