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
# and verifies provision.actor[].reference.reference == token.organization_reference (exact).
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
# Step 1 — Context-scoped token for ReferralOrthopedicSurgery
# Injected as fulfiller_context_token (L1 by default, L2 under -l2); carries a
# fhirContext claim derived from authorization_details.
# ---------------------------------------------------------------------------


# ---------------------------------------------------------------------------
# POSITIVE TEST — Resource IS in the context graph
# ---------------------------------------------------------------------------

GET {{placer_ext_url}}/fhir/Condition/SuspectedACLRupture
Authorization: Bearer {{fulfiller_context_token}}
HTTP 200
[Asserts]
jsonpath "$.resourceType" == "Condition"
jsonpath "$.id"           == "SuspectedACLRupture"


# ---------------------------------------------------------------------------
# NEGATIVE TEST — Resource is NOT in the context graph
# ---------------------------------------------------------------------------

GET {{placer_ext_url}}/fhir/Condition/SarcomaKnee
Authorization: Bearer {{fulfiller_context_token}}
HTTP 403


# ---------------------------------------------------------------------------
# POSITIVE TEST — Tumorboard context grants access to its own graph
# Token injected as fulfiller_context_tumorboard_token (L1/L2 per mode).
# ---------------------------------------------------------------------------

GET {{placer_ext_url}}/fhir/ImagingStudy/ImagingCT
Authorization: Bearer {{fulfiller_context_tumorboard_token}}
HTTP 200
[Asserts]
jsonpath "$.resourceType" == "ImagingStudy"
jsonpath "$.id"           == "ImagingCT"


# ---------------------------------------------------------------------------
# NEGATIVE TEST — Cross-context: tumorboard token denied for orthopedic data
# ---------------------------------------------------------------------------

GET {{placer_ext_url}}/fhir/MedicationStatement/MedicationEntresto
Authorization: Bearer {{fulfiller_context_tumorboard_token}}
HTTP 403


# ===========================================================================
# SEARCH / EXPANSION — context scoping must hold for searches, not just reads-by-id
# ---------------------------------------------------------------------------
# The negative tests above read a single out-of-graph resource by id. OPA only
# sees a parsed (resource_type, _id), so it cannot by itself police a search or
# an _include/_revinclude expansion — that contract is enforced ahead of OPA by
# routing (404) and the capability-guard (400). The orthopedic Consent above is
# still active for these, so the denials below are the contract layer, not consent.
#
# Per the IG CapabilityStatement, only ServiceRequest, Task, Questionnaire and
# QuestionnaireResponse support `search-type`. The clinical leaf resources
# (Patient, Condition, Coverage, ...) are READ-ONLY ("They cannot be searched
# directly — they must be retrieved either by known ID or transitively through
# `_include` from the workflow root"). ServiceRequest search additionally
# requires `_id` ("Searches without `_id` are not supported").
# ===========================================================================


# ---------------------------------------------------------------------------
# POSITIVE CONTROL — a bounded search on a SEARCHABLE type (ServiceRequest is
# the placer-side workflow root) with an in-context `_id` returns just that
# resource. Legitimate graph-scoped search must keep working.
# ---------------------------------------------------------------------------

GET {{placer_ext_url}}/fhir/ServiceRequest?_id=ReferralOrthopedicSurgery
Authorization: Bearer {{fulfiller_context_token}}
HTTP 200
[Asserts]
jsonpath "$.resourceType"         == "Bundle"
jsonpath "$.total"                == 1
jsonpath "$.entry"                count == 1
jsonpath "$.entry[0].resource.id" == "ReferralOrthopedicSurgery"


# ---------------------------------------------------------------------------
# VECTOR 1a — Clinical leaf resources are READ-ONLY (no `search-type`), so the
# search endpoint does not exist → 404 (no route, APISIX default-deny),
# regardless of `_id`. The legitimate path is read-by-id
# (GET /fhir/Condition/SuspectedACLRupture → 200, asserted earlier).
# ---------------------------------------------------------------------------

# A read-only clinical resource that IS readable by id (Condition/SuspectedACLRupture
# → 200 above) must still be DENIED when requested via `_id` search — there is no
# search route for the type, so it is refused before auth/consent are consulted.
# (Using the in-graph id isolates the interaction check: an out-of-graph id like
# SarcomaKnee would be denied anyway, masking whether search itself is refused.)
GET {{placer_ext_url}}/fhir/Condition?_id=SuspectedACLRupture
Authorization: Bearer {{fulfiller_context_token}}
HTTP 404

# Unbounded searches on read-only types → 404 (no route)
GET {{placer_ext_url}}/fhir/Condition
Authorization: Bearer {{fulfiller_context_token}}
HTTP 404

GET {{placer_ext_url}}/fhir/Patient
Authorization: Bearer {{fulfiller_context_token}}
HTTP 404

GET {{placer_ext_url}}/fhir/Coverage
Authorization: Bearer {{fulfiller_context_token}}
HTTP 404

# A read-by-id takes no query parameters; smuggling a search/expansion param onto
# the read URL is rejected by the read route's (empty) capability-guard allow-list
# → 400. Same resource reads 200 above.
GET {{placer_ext_url}}/fhir/Condition/SuspectedACLRupture?_include=*
Authorization: Bearer {{fulfiller_context_token}}
HTTP 400


# ---------------------------------------------------------------------------
# VECTOR 1b — Searchable type (ServiceRequest) must still be `_id`-bounded and
# in-context.
# ---------------------------------------------------------------------------

# Unbounded ServiceRequest search (no `_id`) → 400 (capability-guard: `_id`
# required, "searches without `_id` are not supported").
GET {{placer_ext_url}}/fhir/ServiceRequest
Authorization: Bearer {{fulfiller_context_token}}
HTTP 400

# Valid interaction & params, but OUT-OF-CONTEXT `_id` (a different referral)
# → 403 (OPA consent/graph denial — authorization, not contract).
GET {{placer_ext_url}}/fhir/ServiceRequest?_id=ReferralTumorboard
Authorization: Bearer {{fulfiller_context_token}}
HTTP 403


# ---------------------------------------------------------------------------
# VECTOR 2 — Parameter / include allowlist (DEFAULT-DENY) on a searchable type.
# Exercised on ServiceRequest (clinical types have no search route at all — see
# Vector 1a). The capability-guard permits only `_id` plus the enumerated
# graph-edge includes; everything else → 400, with no explicit blocklist.
# ---------------------------------------------------------------------------

# `_revinclude` is not in the CapabilityStatement at all → 400
GET {{placer_ext_url}}/fhir/ServiceRequest?_id=ReferralOrthopedicSurgery&_revinclude=*
Authorization: Bearer {{fulfiller_context_token}}
HTTP 400

# `_include=*` wildcard — not enumerated → 400
GET {{placer_ext_url}}/fhir/ServiceRequest?_id=ReferralOrthopedicSurgery&_include=*
Authorization: Bearer {{fulfiller_context_token}}
HTTP 400

# A valid FHIR include that is NOT in the enumerated set → 400 (deny-by-default,
# not merely a blocklist of known-bad includes).
GET {{placer_ext_url}}/fhir/ServiceRequest?_id=ReferralOrthopedicSurgery&_include=ServiceRequest:encounter
Authorization: Bearer {{fulfiller_context_token}}
HTTP 400

# A non-allowlisted ordinary search parameter → 400 (ServiceRequest allows only `_id`).
GET {{placer_ext_url}}/fhir/ServiceRequest?_id=ReferralOrthopedicSurgery&status=active
Authorization: Bearer {{fulfiller_context_token}}
HTTP 400

# A reverse-chained `_has` parameter → 400 (not allow-listed; confirms the guard
# rejects anything not explicitly permitted, not just expansion params).
GET {{placer_ext_url}}/fhir/ServiceRequest?_id=ReferralOrthopedicSurgery&_has:Observation:based-on:status=final
Authorization: Bearer {{fulfiller_context_token}}
HTTP 400

# POSITIVE CONTROL — an enumerated graph-edge include is in-graph by
# construction and must be ALLOWED, returning only the match plus the graph
# member it names (here Patient/PetraMeier = ServiceRequest.subject). Guards
# against an over-broad guard that blanket-denies all `_include`.
GET {{placer_ext_url}}/fhir/ServiceRequest?_id=ReferralOrthopedicSurgery&_include=ServiceRequest:patient
Authorization: Bearer {{fulfiller_context_token}}
HTTP 200
[Asserts]
jsonpath "$.resourceType"         == "Bundle"
jsonpath "$.total"                == 1
jsonpath "$.entry"                count == 2
jsonpath "$.entry[*].resource.id" includes "ReferralOrthopedicSurgery"
jsonpath "$.entry[*].resource.id" includes "PetraMeier"


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
Authorization: Bearer {{fulfiller_context_token}}
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
Authorization: Bearer {{fulfiller_context_token}}
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
Authorization: Bearer {{fulfiller_context_token}}
HTTP 200
[Asserts]
jsonpath "$.id" == "SuspectedACLRupture"
