# =============================================================================
# 11-task-requester-gate.hurl — Task requester scoping
#
# Verifies the two-part Task access-control regime introduced alongside the
# system/Task.crus scope rename:
#
#   * /fhir/Task  GET  — scope-gated to system/Task.s, plus a server-side
#                        ?requester=<organization_reference> filter injected
#                        by umzh-task-requester-inject. The caller cannot
#                        observe Tasks belonging to other requesters.
#   * /fhir/Task/{id} GET — scope-gated to system/Task.r AND OPA verifies
#                           Task.requester equals the caller's
#                           organization_reference.
#
# Fulfiller partition is seeded with TWO Tasks:
#   * TaskOrthopedicReferral   requester = Organization/HospitalP
#   * TaskInternalLabReview    requester = Organization/HospitalF
#
# A direct HAPI query (no gateway, no auth) confirms both are present. The
# placer-as-caller search via the external gateway must then return only the
# first — proof that the injected ?requester=<token org_ref> actually filters.
# The deny case at the end uses TaskInternalLabReview as the by-id read target;
# its requester=HospitalF, placer's token says HospitalP, so OPA Rule 1b's
# equality check fails.
# =============================================================================


# --- 1. Baseline: direct HAPI shows both seed Tasks in the fulfiller partition ---
# Bypasses both external gateway and OPA, so no filter is applied. The earlier
# 06-workflow test may have added more Tasks; we don't pin the total, only that
# our two seed Tasks both exist.

GET {{hapi_url}}/fhir/fulfiller/Task
HTTP 200
[Asserts]
jsonpath "$.resourceType" == "Bundle"
jsonpath "$.entry[*].resource.id" contains "TaskOrthopedicReferral"
jsonpath "$.entry[*].resource.id" contains "TaskInternalLabReview"


# --- 2. Placer searches Task list at Fulfiller's external gateway ---
# The umzh-task-requester-inject plugin appends ?requester=<placer org_ref>
# before forwarding to HAPI. Even though both seed Tasks (and any others left
# by earlier tests) exist in the partition, the response must include only
# Tasks where requester == Organization/HospitalP. Specifically:
#   * TaskOrthopedicReferral   (requester=HospitalP) → PRESENT
#   * TaskInternalLabReview    (requester=HospitalF) → ABSENT
# The two contains/not-contains assertions are the end-to-end proof that the
# injection takes effect server-side.

GET {{fulfiller_ext_url}}/fhir/Task
Authorization: Bearer {{placer_token}}
HTTP 200
[Asserts]
jsonpath "$.resourceType" == "Bundle"
jsonpath "$.entry[*].resource.id" contains "TaskOrthopedicReferral"
jsonpath "$.entry[*].resource.id" not contains "TaskInternalLabReview"


# --- 3. Placer reads that Task by id (Task.requester matches → allow) ---

GET {{fulfiller_ext_url}}/fhir/Task/TaskOrthopedicReferral
Authorization: Bearer {{placer_token}}
HTTP 200
[Asserts]
jsonpath "$.resourceType" == "Task"
jsonpath "$.id" == "TaskOrthopedicReferral"
jsonpath "$.requester.reference" contains "/fhir/Organization/HospitalP"


# --- 4. Placer reads TaskInternalLabReview by id (Task.requester mismatch → deny) ---
# Same gateway, same route as test 3, same scope. The only difference is the
# fetched Task.requester field — TaskInternalLabReview.requester is HospitalF,
# placer's organization_reference is HospitalP. OPA Rule 1b's equality check
# fails → default deny → 403. Note the test 2 search also confirmed the caller
# cannot even *see* this Task in the list — defense in depth.

GET {{fulfiller_ext_url}}/fhir/Task/TaskInternalLabReview
Authorization: Bearer {{placer_token}}
HTTP 403
