# =============================================================================
# 09-org-reference-exact-match.hurl — organization_reference enforcement
#
# Direct-OPA policy unit tests for how the token's organization_reference is
# enforced. Two properties:
#   1. Exact-match — the full-URL organization_reference (e.g.
#      "http://localhost:8084/fhir/Organization/HospitalF") is compared with
#      provision.actor[].reference.reference using exact equality, not substring.
#      A reference that is a prefix or substring of a legitimate actor URL must
#      be denied.
#   2. Presence-required — a Task search must fail closed when
#      organization_reference is absent (see the dedicated section below).
#
# OPA is called directly so no Keycloak token or APISIX routing is needed.
# resource_id is a real in-graph resource (Patient/PetraMeier, the subject of
# ServiceRequest/ReferralOrthopedicSurgery) so the resource_in_graph check
# genuinely passes; the only variable under test is the organization_reference
# exact-match in consent_grants.
# =============================================================================


# ---------------------------------------------------------------------------
# Substring / prefix attack: a short organization_reference that is a substring
# of the legitimate actor reference must NOT pass the exact-match check.
# ---------------------------------------------------------------------------

POST {{opa_placer_url}}/v1/data/umzh/authz
Content-Type: application/json
{
  "input": {
    "method": "GET",
    "path": "/fhir/Patient/PetraMeier",
    "resource_type": "Patient",
    "resource_id": "PetraMeier",
    "token": {
      "organization_reference": "http://localhost:8084/fhir/Organization/Hospital",
      "scope": "system/Patient.r",
      "fhir_context": [{"reference": "ServiceRequest/ReferralOrthopedicSurgery", "type": "ServiceRequest"}]
    },
    "fhir_base": "http://nginx-proxy:81/fhir/placer"
  }
}
HTTP 200
[Asserts]
# "Hospital" is a prefix of both HospitalF and HospitalP — must be denied.
jsonpath "$.result.allow" == false


# ---------------------------------------------------------------------------
# Sanity check: the legitimate actor (HospitalF) is admitted.
# ---------------------------------------------------------------------------

POST {{opa_placer_url}}/v1/data/umzh/authz
Content-Type: application/json
{
  "input": {
    "method": "GET",
    "path": "/fhir/Patient/PetraMeier",
    "resource_type": "Patient",
    "resource_id": "PetraMeier",
    "token": {
      "organization_reference": "http://localhost:8084/fhir/Organization/HospitalF",
      "scope": "system/Patient.r",
      "fhir_context": [{"reference": "ServiceRequest/ReferralOrthopedicSurgery", "type": "ServiceRequest"}]
    },
    "fhir_base": "http://nginx-proxy:81/fhir/placer"
  }
}
HTTP 200
[Asserts]
jsonpath "$.result.allow" == true


# ===========================================================================
# Task search must FAIL CLOSED when organization_reference is missing
# ---------------------------------------------------------------------------
# A Task list/search (Rule 1a) is only safe because the umzh-task-requester-
# inject plugin appends ?requester=<organization_reference> so HAPI returns
# only the caller's own Tasks. If the token carries no organization_reference,
# that plugin skips the filter (umzh-task-requester-inject.lua) and HAPI would
# return EVERY Task in the partition. The policy must therefore deny a Task
# search outright when organization_reference is empty, rather than relying on
# a downstream filter that silently no-ops.
#
# (Task read-by-id, Rule 1b, already fails closed: it compares the fetched
# Task.requester against organization_reference, so an empty value never
# matches. Only the search path needs this guard.)
#
# The input below is an otherwise-valid Task search (the allow path with a
# present organization_reference is covered end-to-end by 11-task-requester-
# gate.hurl), so allow=false here is attributable solely to the empty value.
# ===========================================================================

POST {{opa_placer_url}}/v1/data/umzh/authz
Content-Type: application/json
{
  "input": {
    "method": "GET",
    "path": "/fhir/Task",
    "resource_type": "Task",
    "resource_id": "",
    "token": {
      "organization_reference": "",
      "scope": "system/Task.crus",
      "fhir_context": []
    },
    "fhir_base": "http://nginx-proxy:81/fhir/placer"
  }
}
HTTP 200
[Asserts]
jsonpath "$.result.allow" == false
