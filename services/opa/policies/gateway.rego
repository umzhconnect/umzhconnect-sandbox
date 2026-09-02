package umzh.authz.gateway

import rego.v1

# ---------------------------------------------------------------------------
# Gateway / PEP request adapter. The SAME entrypoint serves every Policy
# Enforcement Point that fronts this node — the APISIX external gateway AND
# external integration platforms (e.g. MuleSoft) reaching OPA through its ingress.
# All of them POST the request they are proxying as `input.request`:
# {
#   "input": {
#     "request": {
#       "method":  "GET",
#       "path":    "/fhir/ServiceRequest",     # no query string
#       "query":   {"_id": "ReferralOrthopedicSurgery"},
#       "headers": {"authorization": "Bearer ..."}   # header name case-insensitive
#     }
#   }
# }
#
# Party-specific constant (fhir_base) comes from data.config, injected per OPA
# instance via a mounted config JSON — never from the caller.
#
# ── TRUST MODEL (see BACKLOG.md) ────────────────────────────────────────────
# io.jwt.decode below does NOT verify the JWT signature; it only reads the
# claims. Every consumer MUST authenticate the token BEFORE calling OPA: APISIX
# does it with its openid-connect plugin (JWKS); MuleSoft validates the token in
# its own flow before forwarding. So OPA does authZ on an already-authN'd token.
# Adding OPA-side signature verification (io.jwt.decode_verify vs the auth-server
# JWKS) is a tracked improvement — see BACKLOG.md.
# ---------------------------------------------------------------------------

# The Authorization header value, looked up CASE-INSENSITIVELY: APISIX lowercases
# header names, but other consumers (MuleSoft) may send "Authorization". Absent ⇒
# jwt_payload stays unset ⇒ default-deny.
_authorization := v if {
	some k, v in input.request.headers
	lower(k) == "authorization"
}

# Decode (NOT verify — see the trust model above) the JWT from the bearer.
jwt_payload := payload if {
	startswith(_authorization, "Bearer ")
	tok := substring(_authorization, 7, -1)
	[_, payload, _] := io.jwt.decode(tok)
}

# Party config. fhir_base normally comes from the per-instance data document
# (opa-config.json). It MAY be overridden by the OPA process ENVIRONMENT
# (opa.runtime().env.FHIR_BASE) so a party can point THIS otherwise-identical
# policy + config bundle at a DIFFERENT (e.g. cluster-external) FHIR backend
# WITHOUT editing the committed opa-config.json. The env wins when set & non-empty;
# otherwise the data document is used. Never sourced from the caller.
fhir_base := base if {
	base := object.get(opa.runtime().env, "FHIR_BASE", "")
	base != ""
} else := data.config.fhir_base

# OPTIONAL Authorization header OPA attaches to its own FHIR fetches (the
# http.send calls in main.rego for Consent/Task/ServiceRequest). Sourced from the
# OPA process ENVIRONMENT (opa.runtime().env), NOT the committed opa-config.json,
# because it is a secret. Empty ⇒ no header (unchanged behaviour). Set it to the
# full header value, e.g. "Basic <base64(user:pass)>", when the FHIR server OPA
# queries requires credentials.
fhir_authorization := object.get(opa.runtime().env, "FHIR_BACKEND_AUTHORIZATION", "")

# ---------------------------------------------------------------------------
# Path parsing
# ---------------------------------------------------------------------------

# /fhir/<type>  or  /fhir/<type>/<id>  →  ["<type>"] or ["<type>", "<id>"]
_path_parts := split(trim_prefix(input.request.path, "/fhir/"), "/")

resource_type := _path_parts[0]

resource_id := id if {
	count(_path_parts) >= 2
	id := _path_parts[1]
	id != ""
} else := id if {
	id := input.request.query["_id"]
	id != ""
} else := ""

canonical_path := concat("/", ["/fhir", resource_type, resource_id]) if {
	resource_id != ""
}

canonical_path := input.request.path if {
	resource_id == ""
}

# ---------------------------------------------------------------------------
# Delegate to main.rego with the mapped input shape
# ---------------------------------------------------------------------------
# Authorization is SMART-scope + context (organization_reference / consent /
# fhirContext) centric — every rule in main.rego carries its own scope and
# identity conditions, so there is no coarse realm-role gate here.
#
# `default allow := false` makes the decision an EXPLICIT boolean: a denied query
# returns {"result": false} rather than an undefined {} (which happens when the
# rule body isn't satisfied — e.g. no bearer, or main.rego denied). External
# callers (MuleSoft) can then check `result == false` instead of "result absent".
# The APISIX gateway plugin treats false and absent the same, so this is inert
# for the gateway.
default allow := false

allow if {
	# Evaluate existing policy with the input shape it expects.
	data.umzh.authz.allow with input as {
		"method":        input.request.method,
		"path":          canonical_path,
		"resource_type": resource_type,
		"resource_id":   resource_id,
		"token": {
			"organization_reference": object.get(object.get(object.get(jwt_payload, "extensions", {}), "umzhconnect", {}), "organization_reference", ""),
			"scope":                  object.get(jwt_payload, "scope", ""),
			"fhir_context":           object.get(jwt_payload, "fhirContext", []),
		},
		"fhir_base":          fhir_base,
		"fhir_authorization": fhir_authorization,
	}
}
