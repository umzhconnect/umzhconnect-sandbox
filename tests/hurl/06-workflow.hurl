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


# --- Step 1: Placer creates Task directly at Fulfiller's external gateway ---
# No internal-gateway proxy: the placer authenticates with its own M2M token and
# POSTs straight to apisix-fulfiller-external -> HAPI /fhir/fulfiller/Task.

POST {{fulfiller_ext_url}}/fhir/Task
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


# --- Step 5: Placer (requester, NOT owner) cannot PATCH the Task cross-party ---
# OPA rule 1d restricts Task PATCH to the Task owner (HospitalF) — "the data
# consumer (requester) must NOT mutate the Task". The placer patches an allowed
# field (businessStatus), so it clears the capability-guard field allowlist, but
# OPA denies because the caller is not the owner.

PATCH {{fulfiller_ext_url}}/fhir/Task/{{created_task_id}}
Authorization: Bearer {{placer_token}}
Content-Type: application/json-patch+json
[{"op":"add","path":"/businessStatus","value":{"text":"reviewed"}}]
HTTP 403


# --- Step 5b: Placer (owner) CAN PATCH businessStatus via Fulfiller's external gateway ---
# Creates a Task with owner=HospitalP so the placer token satisfies OPA Rule 1d.
# Validates the positive path: capability-guard allows businessStatus AND OPA grants the owner.

POST {{fulfiller_ext_url}}/fhir/Task
Authorization: Bearer {{placer_token}}
Content-Type: application/fhir+json
{"resourceType":"Task","status":"requested","intent":"order","description":"Owner PATCH positive test","focus":{"reference":"{{hapi_url}}/fhir/placer/ServiceRequest/ReferralOrthopedicSurgery"},"for":{"reference":"{{hapi_url}}/fhir/placer/Patient/PetraMeier"},"requester":{"reference":"{{registry_url}}/fhir/Organization/HospitalP"},"owner":{"reference":"{{registry_url}}/fhir/Organization/HospitalP"}}
HTTP 201
[Captures]
placer_owned_task_id: jsonpath "$.id"

PATCH {{fulfiller_ext_url}}/fhir/Task/{{placer_owned_task_id}}
Authorization: Bearer {{placer_token}}
Content-Type: application/json-patch+json
[{"op":"add","path":"/businessStatus","value":{"text":"reviewed"}}]
HTTP 200
[Asserts]
jsonpath "$.businessStatus.text" == "reviewed"


# --- Step 5c: PUT on external gateway must be rejected — APISIX returns 404 (no matching route) ---

PUT {{fulfiller_ext_url}}/fhir/Task/{{created_task_id}}
Authorization: Bearer {{placer_token}}
Content-Type: application/fhir+json
{"resourceType":"Task","id":"{{created_task_id}}","status":"in-progress","intent":"order"}
HTTP 404


# --- Step 6: Placer reads its own + the partner's Tasks (client-side fan-out) ---
# The merged "all-tasks" action is gone; the web-app now does two direct reads.
# 6a: own Tasks via the internal gateway (user/M2M token).

GET {{placer_url}}/fhir/Task
Authorization: Bearer {{placer_token}}
HTTP 200
[Asserts]
jsonpath "$.resourceType" == "Bundle"

# 6b: partner Tasks via the fulfiller external gateway (cross-party M2M token).
# Proves the placer can authenticate itself cross-party and list the partner's
# Tasks directly (no proxy). The requester-injection filter that scopes this
# list to the caller's own Tasks is verified deterministically against
# pre-indexed seed data in 11-task-requester-gate; we don't re-assert the
# just-created id here because HAPI's `requester` search index is only
# eventually consistent.

GET {{fulfiller_ext_url}}/fhir/Task
Authorization: Bearer {{placer_token}}
HTTP 200
[Asserts]
jsonpath "$.resourceType" == "Bundle"
jsonpath "$.type" == "searchset"
