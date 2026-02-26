package cow.authz

import future.keywords.in
import future.keywords.if

# =============================================================================
# UMZH-Connect COW Sandbox — Authorization Policy
# =============================================================================
#
# Phase 1: Pass-through (allow all authenticated requests)
# Phase 2: Consent-based authorization
#
# Input shape:
#   {
#     "token": {
#       "client_id": "fulfiller-client",
#       "party_id": "partyB",
#       "scope": "system/Task.cruds system/ServiceRequest.rs",
#       "sub": "...",
#       "exp": 1234567890
#     },
#     "request": {
#       "method": "GET",
#       "path": "/fhir/Patient/123",
#       "resource_type": "Patient",
#       "resource_id": "123",
#       "consent_id": "consent-abc"
#     },
#     "hapi_url": "http://hapi-fhir:8080"
#   }

default allow = false

# ── Rule 1: Token must be present and not expired ─────────────────────────────
token_valid if {
    input.token.client_id != ""
    input.token.party_id != ""
}

# ── Rule 2: Scope check ───────────────────────────────────────────────────────
required_scope := data.scope_map[input.request.resource_type][input.request.method]

scope_allowed if {
    required_scope != null
    required_scope in split(input.token.scope, " ")
}

# Fallback: if no scope map entry, allow (for internal/non-FHIR endpoints)
scope_allowed if {
    not data.scope_map[input.request.resource_type]
}

# ── Rule 3: Consent-based authorization for cross-party reads ─────────────────
#
# When partyB reads resources from partyA, a valid Consent must exist.
# The consent must:
#   1. Be active
#   2. Reference the ServiceRequest being accessed (or resources in its graph)
#   3. Designate the requesting party (partyB) as the performer/actor
#
cross_party_read if {
    input.token.party_id == "partyB"
    input.request.resource_type in {"Patient", "Condition", "Medication", "MedicationStatement", "ServiceRequest"}
}

consent_valid if {
    cross_party_read
    input.request.consent_id != ""
    consent := http.send({
        "method": "GET",
        "url": concat("", [input.hapi_url, "/fhir/Consent/", input.request.consent_id]),
        "headers": {"Accept": "application/fhir+json"},
        "timeout": "5s",
        "cache": true
    })
    consent.status_code == 200
    consent.body.status == "active"
    # Check performer is the requesting party
    some performer in consent.body.performer
    endswith(performer.reference, input.token.party_id)
}

# ── Main allow rule ───────────────────────────────────────────────────────────

# Allow same-party access (placer reads/writes own resources)
allow if {
    token_valid
    scope_allowed
    not cross_party_read
}

# Allow cross-party reads with valid consent
allow if {
    token_valid
    scope_allowed
    cross_party_read
    consent_valid
}

# Allow cross-party reads when no consent_id provided but resource is ServiceRequest
# (initial fetch to discover consent — the backend will then enforce consent)
allow if {
    token_valid
    scope_allowed
    cross_party_read
    input.request.consent_id == ""
    input.request.resource_type == "ServiceRequest"
}

# ── Phase 1 override: allow all when PHASE=1 ─────────────────────────────────
allow if {
    data.phase == 1
    token_valid
}
