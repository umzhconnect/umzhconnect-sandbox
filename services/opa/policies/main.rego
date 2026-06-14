# =============================================================================
# UMZH Connect Sandbox - OPA Authorization Policies
# =============================================================================
# Main policy package for context-centric authorization enforcement.
#
# Authorization model:
# The access token carries a `fhirContext` claim (SMART v2) derived from
# RFC 9396 `authorization_details` (type "umzh-connect-context").  The Consent
# is no longer named by the token; instead OPA locates it by searching
# `Consent?data=<fhirContext-ref>&status=active` and verifies the actor.
#
# Two workflow-root types are supported (Rule 4 / Rule 4b):
#
# Rule 4 — ServiceRequest-rooted context (fulfiller reading from placer):
#   1. Resolve fhirContext reference → ServiceRequest/<id>
#   2. Search Consent?data=ServiceRequest/<id>&status=active in this partition
#   3. Verify provision.actor == token.organization_reference (exact) + not expired
#   4. Fetch the ServiceRequest and compute its forward-reference graph
#   5. Permit if the requested resource is in the graph
#
# Rule 4b — Task-rooted context (placer reading Task output from fulfiller):
#   Same steps, but root is Task/<id> and the graph walks Task.output[].valueReference
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
# Input structure expected from APISIX (`apisix.rego` adapter) / API Gateway:
# {
#   "method": "GET",
#   "path": "/fhir/Patient/123",
#   "resource_type": "Patient",
#   "resource_id": "123",
#   "token": {
#     "organization_reference": "http://localhost:8084/fhir/Organization/HospitalF",
#     "scope":                  "system/Patient.r system/Task.crus ...",
#     "fhir_context":           [{"reference": "ServiceRequest/sr-123"}]
#   },
#   "fhir_base": "http://nginx-proxy:81/fhir/placer"
# }
# ---------------------------------------------------------------------------

# ==========================================================================
# Rule 1a: Task search — require system/Task.s
# ------------------------------------------------------------------------
# The gateway also injects ?requester=<organization_reference> via the
# umzh-task-requester-inject plugin so HAPI returns only Tasks where the
# caller is the named requester. The scope check here gates *whether* the
# search may run; the requester filter scopes *what it returns*.
#
# organization_reference must be non-empty: the requester filter is the ONLY
# thing scoping a Task search to the caller, and umzh-task-requester-inject
# silently no-ops when the value is absent — which would let HAPI return every
# Task in the partition. Fail closed rather than rely on that downstream filter.
# ==========================================================================
allow if {
	input.resource_type == "Task"
	input.method == "GET"
	input.resource_id == ""
	input.token.organization_reference != ""
	has_smart_scope("Task", "s")
}

# ==========================================================================
# Rule 1b: Task read by id — require system/Task.r AND the fetched Task's
# requester field must equal the calling party's organization_reference
# ==========================================================================
allow if {
	input.resource_type == "Task"
	input.method == "GET"
	input.resource_id != ""
	has_smart_scope("Task", "r")
	task := fetched_task(input.resource_id)
	task.requester.reference == input.token.organization_reference
}

# ==========================================================================
# Rule 1c: Task create / update / delete — scope check only, no requester gate
# ==========================================================================
allow if {
	input.resource_type == "Task"
	input.method != "GET"
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
# Rule 4: Allow read of resources within the fhirContext service-request graph
# ==========================================================================
allow if {
	input.method == "GET"
	input.resource_type != "Task"
	input.resource_type != "QuestionnaireResponse"
	has_smart_scope(input.resource_type, "r")
	# Per-context: there must be a ServiceRequest context that has its own
	# valid Consent AND whose graph contains the requested resource.  Each
	# fhirContext entry is paired with its own Consent — a Consent covering
	# one context never grants access to another context's graph.
	some sr_ref in fhir_context_sr_refs
	consent_grants(sr_ref)
	resource_in_graph(sr_ref)
}

# ==========================================================================
# Rule 4b: Allow read of resources within the fhirContext Task graph
# ------------------------------------------------------------------------
# Mirrors Rule 4 for Task-rooted contexts. The placer carries a context
# token whose fhirContext root is Task/<id> and reads resources listed in
# Task.output[].valueReference. Consent is looked up as
# Consent?data=Task/<id>&status=active in this partition (the fulfiller's),
# naming the placer as actor.
# ==========================================================================
allow if {
	input.method == "GET"
	input.resource_type != "Task"
	has_smart_scope(input.resource_type, "r")
	some task_ref in fhir_context_task_refs
	consent_grants(task_ref)
	resource_in_task_graph(task_ref)
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
# fhirContext resolution
# ==========================================================================

# All ServiceRequest references carried by the fhirContext claim.  A token may
# bind to more than one workflow context — RFC 9396 authorization_details is an
# array — so this is a set, and each entry is evaluated independently.
fhir_context_sr_refs contains ref if {
	some ctx in input.token.fhir_context
	startswith(ctx.reference, "ServiceRequest/")
	ref := ctx.reference
}

# All Task references carried by the fhirContext claim (Task-rooted contexts).
fhir_context_task_refs contains ref if {
	some ctx in input.token.fhir_context
	startswith(ctx.reference, "Task/")
	ref := ctx.reference
}

# ==========================================================================
# Consent resolution — search by fhirContext reference
# ==========================================================================

# Search for active Consents whose provision.data references <sr_ref>.
# Not cached: the Consent must be re-read live on every request so that
# revocation (status=inactive) and expiry take effect immediately.
consent_search(sr_ref) := resp if {
	url := sprintf("%s/Consent?data=%s&status=active", [input.fhir_base, sr_ref])
	resp := http.send({
		"method":            "GET",
		"url":               url,
		"headers":           {"Accept": "application/fhir+json"},
		"force_json_decode": true,
	})
	resp.status_code == 200
}

# Normalise a FHIR date ("2026-06-15") or datetime ("2026-06-15T00:00:00Z") to
# nanoseconds since epoch.  date.parse_rfc3339_ns requires a full RFC3339 string.
_to_ns(s) := t if {
	contains(s, "T")
	t := time.parse_rfc3339_ns(s)
}

_to_ns(s) := t if {
	not contains(s, "T")
	t := time.parse_rfc3339_ns(concat("", [s, "T00:00:00Z"]))
}

# Expiry test for a Consent.
# A missing provision.period.end means the Consent is open-ended (never
# expires) — only an end value that has actually passed makes it expired.
consent_not_expired(consent) if {
	not consent.provision.period.end
}

consent_not_expired(consent) if {
	# Handles both date-only ("2026-06-15") and full RFC3339 end values.
	time.now_ns() < _to_ns(consent.provision.period.end)
}

# ==========================================================================
# Helper: an active, non-expired Consent issued to this party covers <sr_ref>
# ==========================================================================
consent_grants(sr_ref) if {
	resp := consent_search(sr_ref)
	some entry in resp.body.entry
	consent := entry.resource
	consent.status == "active"
	# Exact match: organization_reference must equal the actor's full Registry URL
	some actor in consent.provision.actor
	actor.reference.reference == input.token.organization_reference
	consent_not_expired(consent)
}

# ==========================================================================
# ServiceRequest graph — derive resource scope from a fhirContext reference
# ==========================================================================

# Fetch a Task by id from this party's partition.  Not cached: Task state
# (and in principle Task.requester) can change; the requester check must
# read the current value.
fetched_task(task_id) := task if {
	url := concat("/", [input.fhir_base, "Task", task_id])
	resp := http.send({
		"method":            "GET",
		"url":               url,
		"headers":           {"Accept": "application/fhir+json"},
		"force_json_decode": true,
	})
	resp.status_code == 200
	task := resp.body
}

# Fetch the ServiceRequest named by <sr_ref>.  Cached: a ServiceRequest is
# immutable for the lifetime of the workflow it anchors.
fetched_service_request(sr_ref) := sr if {
	url := concat("/", [input.fhir_base, sr_ref])
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

# The set of resource references reachable from ServiceRequest <sr_ref>: the SR
# itself plus everything its subject, requester, reasonReference, supportingInfo
# and insurance fields point to.  performer is intentionally excluded — it is the
# receiving organisation, already reachable via Rule 6 (directory reads).
service_request_graph(sr_ref) := graph if {
	sr := fetched_service_request(sr_ref)
	graph := (
		{sr_ref} |
		{ref | ref := sr.subject.reference} |
		{ref | ref := sr.requester.reference} |
		{ref | some item in sr.reasonReference;  ref := item.reference} |
		{ref | some item in sr.supportingInfo;   ref := item.reference} |
		{ref | some item in sr.insurance;        ref := item.reference}
	)
}

# ==========================================================================
# Helper: the requested resource lies within ServiceRequest <sr_ref>'s graph
# ==========================================================================
resource_in_graph(sr_ref) if {
	resource_ref := concat("/", [input.resource_type, input.resource_id])
	some ref in service_request_graph(sr_ref)
	# endswith handles both relative ("Patient/X") and absolute URL references
	endswith(ref, resource_ref)
}

# ==========================================================================
# Task graph — derive resource scope from a Task fhirContext reference
# ==========================================================================

# The set of resource references reachable from Task <task_ref>: the Task
# itself plus everything its input[].valueReference and output[].valueReference
# fields point to.
task_graph(task_ref) := graph if {
	task_id := split(task_ref, "/")[1]
	task := fetched_task(task_id)
	graph := (
		{task_ref} |
		{ref | some item in task.input;  ref := item.valueReference.reference} |
		{ref | some item in task.output; ref := item.valueReference.reference}
	)
}

# ==========================================================================
# Helper: the requested resource lies within Task <task_ref>'s graph
# ==========================================================================
resource_in_task_graph(task_ref) if {
	resource_ref := concat("/", [input.resource_type, input.resource_id])
	some ref in task_graph(task_ref)
	endswith(ref, resource_ref)
}

# ==========================================================================
# Helper: Check if token carries the required SMART on FHIR scope
# ==========================================================================
has_smart_scope(resource, action) if {
	some scope in split(input.token.scope, " ")
	parts := split(scope, "/")
	count(parts) == 2
	ra := split(parts[1], ".")
	ra[0] == resource
	contains(ra[1], action)
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
	"allow":                  allow,
	"organization_reference": input.token.organization_reference,
	"resource_type":          input.resource_type,
	"method":                 input.method,
	"fhir_context":           input.token.fhir_context,
	"reason":                 reason,
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
	some sr_ref in fhir_context_sr_refs
	consent_grants(sr_ref)
}

reason := "Resource access granted via Task context graph and valid consent" if {
	allow
	some task_ref in fhir_context_task_refs
	consent_grants(task_ref)
}

reason := "Access denied: insufficient scope, missing or invalid consent, or resource not in context graph" if {
	not allow
}
