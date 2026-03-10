# =============================================================================
# UMZH Connect Sandbox - OPA Authorization Policies
# =============================================================================
# Main policy package for consent-centric authorization enforcement.
#
# The policy engine evaluates:
# "Is the consent associated to the requesting client and are the resulting
#  requested resources part of the service request graph?"
# =============================================================================

package umzh.authz

import rego.v1

# Default deny
default allow := false

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
#     "tenant": "fulfiller",
#     "scope": "openid consent:ConsentOrthopedicReferral"   # <-- JWT scope claim
#   },
#   "consent_id": "consent-ref-001",   # optional explicit override
#   "consent": {                    # Resolved consent resource (fetched by gateway)
#     "status": "active",
#     "scope": { ... },
#     "patient": { "reference": "Patient/PetraMeier" },
#     "performer": [{ "reference": "Organization/HospitalF" }],
#     "sourceReference": { "reference": "ServiceRequest/ReferralOrthopedicSurgery" },
#     "provision": {
#       "type": "permit",
#       "data": [
#         { "reference": { "reference": "Condition/SuspectedACLRupture" } },
#         { "reference": { "reference": "MedicationStatement/MedicationEntresto" } }
#       ]
#     }
#   }
# }
# ---------------------------------------------------------------------------

# ==========================================================================
# Rule 1: Allow Task operations without consent (Task access is owner-based)
# ==========================================================================
allow if {
    input.resource_type == "Task"
    has_smart_scope("Task", method_to_action(input.method))
}

# ==========================================================================
# Rule 2: Allow QuestionnaireResponse operations without consent
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
# Rule 4: Allow read of resources with valid consent
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
# Rule 6: Allow Organization and Practitioner reads (directory data)
# ==========================================================================
allow if {
    input.method == "GET"
    input.resource_type in {"Organization", "Practitioner", "PractitionerRole"}
    has_smart_scope(input.resource_type, "r")
}

# ==========================================================================
# Helper: Check if token has the required SMART scope
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
# Helper: Map HTTP method to SMART action
# ==========================================================================
method_to_action(method) := action if {
    actions := {
        "GET": "r",
        "POST": "c",
        "PUT": "u",
        "PATCH": "u",
        "DELETE": "d"
    }
    action := actions[method]
}

# ==========================================================================
# Helper: Extract consent_id from the JWT scope claim.
#
# Keycloak dynamic scope places the consent ID inside the space-separated
# `scope` claim as "consent:<consentId>". KrakenD propagates this via the
# `x-scope` header and the gateway includes it as `input.token.scope`.
#
# Priority order:
#   1. Explicit `input.consent_id` field in the request body (legacy / manual)
#   2. `consent:*` token in `input.token.scope` (JWT dynamic scope)
#
# Two separate incremental rules — OPA resolves to the first one that fires.
# ==========================================================================

# Branch 1: explicit consent_id field takes priority
effective_consent_id := input.consent_id if {
    input.consent_id != ""
}

# Branch 2: extract from JWT scope claim (consent:<id> dynamic scope)
effective_consent_id := id if {
    input.consent_id == ""
    scope_parts := split(input.token.scope, " ")
    some part in scope_parts
    startswith(part, "consent:")
    id := substring(part, count("consent:"), -1)
    id != ""
}

# ==========================================================================
# Helper: Validate consent is active and matches requesting party
# ==========================================================================
valid_consent if {
    input.consent != null
    input.consent.status == "active"
    # Consent performer matches requesting party's organization
    some performer in input.consent.performer
    contains(performer.reference, input.token.party_id)
}

# Fallback: If no consent object provided but an effective consent_id is
# present (from request body or JWT scope), optimistically allow.
# (In production, the gateway would resolve the consent resource first.)
valid_consent if {
    effective_consent_id != ""
    input.consent == null
}

# ==========================================================================
# Helper: Check if requested resource is within the consent's scope
# ==========================================================================
resource_in_consent_scope if {
    # If consent has explicit data provisions, check membership
    input.consent.provision.data != null
    some data_item in input.consent.provision.data
    resource_ref := concat("/", [input.resource_type, input.resource_id])
    data_item.reference.reference == resource_ref
}

# Also allow if the resource is the patient referenced in the consent
resource_in_consent_scope if {
    input.consent.patient != null
    resource_ref := concat("/", [input.resource_type, input.resource_id])
    input.consent.patient.reference == resource_ref
}

# Also allow search operations (no specific resource_id)
resource_in_consent_scope if {
    input.resource_id == ""
}

# Allow if consent has no explicit data restrictions (broad consent)
resource_in_consent_scope if {
    input.consent.provision.data == null
}

# When no consent object is present but a consent_id is asserted via the JWT
# scope claim (optimistic trust mode), skip the resource-level restriction.
# In production the gateway resolves the consent object first.
resource_in_consent_scope if {
    effective_consent_id != ""
    input.consent == null
}

# ==========================================================================
# Decision response structure
# ==========================================================================
decision := {
    "allow": allow,
    "party_id": input.token.party_id,
    "resource_type": input.resource_type,
    "method": input.method,
    "consent_id": effective_consent_id,
    "reason": reason,
}

reason := "Task operations are owner-based, no consent needed" if {
    input.resource_type == "Task"
    allow
}

reason := "Resource access granted via valid consent" if {
    input.resource_type != "Task"
    allow
    valid_consent
}

reason := "Directory resource access granted" if {
    input.resource_type in {"Organization", "Practitioner", "PractitionerRole"}
    allow
}

reason := "Access denied: insufficient scope or invalid consent" if {
    not allow
}
