# =============================================================================
# UMZH Connect Sandbox - OPA Authorization Policies
# =============================================================================
# Main policy package for consent-centric authorization enforcement.
#
# Scenario 1 — Consent-centric requests:
# "Is the requesting client associated to the consent, and is the requested
#  resource part of the service request graph referenced by that consent?"
#
# Resource scope is derived dynamically from Consent.sourceReference → the
# ServiceRequest.  All resources referenced by the SR's subject, requester,
# reasonReference, supportingInfo, and insurance fields are considered in
# scope.  provision.data is not used; performer is intentionally excluded
# (the receiving organisation is a directory resource, already accessible
# via Rule 6).
# =============================================================================

package umzh.authz

import rego.v1

# Default deny
default allow := false

# Recommended HTTP status code for callers.
# NOTE: OPA's REST API (/v1/data/...) always returns HTTP 200 for successful
# evaluations — this value appears in result.http_status in the response body
# for callers (sidecars, gateways) to use, but does NOT change OPA's own
# HTTP response code.
default http_status := 200
http_status := 403 if { not allow }

# ---------------------------------------------------------------------------
# Input structure expected from KrakenD / API Gateway:
# {
#   "method": "GET",
#   "path": "/fhir/Patient/123",
#   "resource_type": "Patient",
#   "resource_id": "123",
#   "token": {
#     "party_id": "hospitalf",
#     "smart_scopes": "system/Patient.r system/Task.cru ...",
#     "scope": "openid consent:ConsentOrthopedicReferral"   # JWT scope claim
#   },
#   "consent_id":  "",           # optional explicit override (legacy)
#   "consent":     null,         # optional pre-resolved Consent resource
#   "fhir_base":   "http://nginx-proxy:81/fhir/placer"   # used to fetch Consent + SR
# }
# ---------------------------------------------------------------------------

# ==========================================================================
# Rule 1: Allow Task operations (owner-based, no consent needed)
# ==========================================================================
allow if {
	input.resource_type == "Task"
	has_smart_scope("Task", method_to_action(input.method))
}

# ==========================================================================
# Rule 2: Allow QuestionnaireResponse operations (no consent needed)
# ==========================================================================
allow if {
	input.resource_type == "QuestionnaireResponse"
	has_smart_scope("QuestionnaireResponse", method_to_action(input.method))
}

# ==========================================================================
# Rule 3: Allow Questionnaire read operations
# ==========================================================================
allow if {
	input.resource_type == "Questionnaire"
	input.method == "GET"
	has_smart_scope("Questionnaire", "r")
}

# ==========================================================================
# Rule 4: Allow read of resources within the consent's service request graph
# ==========================================================================
allow if {
	input.method == "GET"
	input.resource_type != "Task"
	input.resource_type != "QuestionnaireResponse"
	has_smart_scope(input.resource_type, "r")
	valid_consent
	resource_in_consent_scope
}

# ==========================================================================
# Rule 5: Allow metadata endpoint always
# ==========================================================================
allow if {
	input.path == "/fhir/metadata"
}

# ==========================================================================
# Rule 6: Allow Organisation and Practitioner directory reads
# ==========================================================================
allow if {
	input.method == "GET"
	input.resource_type in {"Organization", "Practitioner", "PractitionerRole"}
	has_smart_scope(input.resource_type, "r")
}

# ==========================================================================
# Consent resolution
# ==========================================================================

# Branch 1: explicit consent_id field in input takes priority
effective_consent_id := input.consent_id if {
	input.consent_id != ""
}

# Branch 2: extract consent:<id> from the JWT scope claim
effective_consent_id := id if {
	input.consent_id == ""
	scope_parts := split(input.token.scope, " ")
	some part in scope_parts
	startswith(part, "consent:")
	id := substring(part, count("consent:"), -1)
	id != ""
}

# Fetch the Consent resource from HAPI FHIR when not provided inline.
# Requires input.fhir_base to be set by the calling gateway.
# The result is cached within the evaluation by OPA's built-in http.send caching.
fetched_consent := consent if {
	effective_consent_id != ""
	input.consent == null
	input.fhir_base != ""
	url := concat("/", [input.fhir_base, "Consent", effective_consent_id])
	resp := http.send({
		"method":            "GET",
		"url":               url,
		"headers":           {"Accept": "application/fhir+json"},
		"force_json_decode": true,
		"cache":             true,
	})
	resp.status_code == 200
	consent := resp.body
}

# Effective consent: prefer inline input, fall back to fetched.
effective_consent := input.consent if {
	input.consent != null
}

effective_consent := fetched_consent if {
	input.consent == null
}

# ==========================================================================
# Helper: Validate consent is active and issued to the requesting party
# ==========================================================================
valid_consent if {
	effective_consent.status == "active"
	some performer in effective_consent.performer
	# Case-insensitive check: party_id (e.g. "hospitalf") must appear inside
	# the performer reference (e.g. "Organization/placer-HospitalF")
	contains(lower(performer.reference), lower(input.token.party_id))
}

# ==========================================================================
# ServiceRequest graph — derive resource scope from Consent.sourceReference
# ==========================================================================

# Fetch the ServiceRequest referenced by Consent.sourceReference.
# Cached for the lifetime of the OPA process.
fetched_service_request := sr if {
	effective_consent.sourceReference != null
	url := concat("/", [input.fhir_base, effective_consent.sourceReference.reference])
	resp := http.send({
		"method":            "GET",
		"url":               url,
		"headers":           {"Accept": "application/fhir+json"},
		"force_json_decode": true,
		"cache":             true,
	})
	resp.status_code == 200
	sr := resp.body
}

# Collect all resource references from the ServiceRequest into a set.
# performer is intentionally excluded — it is the receiving organisation, not
# a clinical data resource, and is already accessible via Rule 6 (directory reads).

service_request_refs contains ref if {
	ref := fetched_service_request.subject.reference
}

service_request_refs contains ref if {
	ref := fetched_service_request.requester.reference
}

service_request_refs contains ref if {
	some item in fetched_service_request.reasonReference
	ref := item.reference
}

service_request_refs contains ref if {
	some item in fetched_service_request.supportingInfo
	ref := item.reference
}

service_request_refs contains ref if {
	some item in fetched_service_request.insurance
	ref := item.reference
}

# The ServiceRequest itself is always in scope.
service_request_refs contains ref if {
	ref := effective_consent.sourceReference.reference
}

# ==========================================================================
# Helper: Check that the requested resource is within the consent's scope
# ==========================================================================

# Resource appears in the ServiceRequest graph
resource_in_consent_scope if {
	resource_ref := concat("/", [input.resource_type, input.resource_id])
	some ref in service_request_refs
	# endswith handles both relative ("Patient/X") and absolute URL references
	endswith(ref, resource_ref)
}

# Search operations with no specific resource_id pass the scope check.
# The gateway always supplies a concrete _id on the external endpoint, so
# this branch is unreachable from there but preserved for direct OPA calls.
resource_in_consent_scope if {
	input.resource_id == ""
}

# ==========================================================================
# Helper: Check if token carries the required SMART on FHIR scope
# ==========================================================================
has_smart_scope(resource, action) if {
	scopes := split(input.token.smart_scopes, " ")
	some scope in scopes
	scope_parts := split(scope, "/")
	count(scope_parts) == 2
	resource_action := scope_parts[1]
	ra_parts := split(resource_action, ".")
	ra_parts[0] == resource
	contains(ra_parts[1], action)
}

# ==========================================================================
# Helper: Map HTTP method to SMART on FHIR action letter
# ==========================================================================
method_to_action(method) := action if {
	actions := {
		"GET":    "r",
		"POST":   "c",
		"PUT":    "u",
		"PATCH":  "u",
		"DELETE": "d",
	}
	action := actions[method]
}

# ==========================================================================
# Decision response (full context, useful for debugging)
# ==========================================================================
decision := {
	"allow":         allow,
	"party_id":      input.token.party_id,
	"resource_type": input.resource_type,
	"method":        input.method,
	"consent_id":    effective_consent_id,
	"reason":        reason,
}

reason := "Task operations are owner-based, no consent needed" if {
	input.resource_type == "Task"
	allow
}

reason := "Directory resource access granted" if {
	input.resource_type in {"Organization", "Practitioner", "PractitionerRole"}
	allow
}

reason := "Resource access granted via valid consent" if {
	not input.resource_type in {"Task", "Organization", "Practitioner", "PractitionerRole"}
	allow
	valid_consent
}

reason := "Access denied: insufficient scope, missing consent, or resource not in consent graph" if {
	not allow
}
