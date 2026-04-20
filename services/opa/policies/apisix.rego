package umzh.authz.apisix

import rego.v1

# ---------------------------------------------------------------------------
# Input shape sent by APISIX's built-in `opa` plugin:
# {
#   "input": {
#     "request": {
#       "method":  "GET",
#       "path":    "/fhir/ServiceRequest",     # no query string
#       "query":   {"_id": "ReferralOrthopedicSurgery"},
#       "headers": {"x-access-token": "...", ...}
#     }
#   }
# }
#
# Party-specific constants (fhir_base, required_role) come from
# data.config, injected per OPA instance via a mounted config JSON.
# ---------------------------------------------------------------------------

# Decode the JWT from the Authorization header (validated by openid-connect before this runs).
# Reading from Authorization (original request) rather than X-Access-Token (set internally
# by openid-connect) avoids APISIX's header-cache staleness — core.request.headers(ctx) is
# snapshot-cached before openid-connect's set_header calls are visible to later plugins.
# io.jwt.decode does NOT verify the signature — validation already happened at the gateway.
jwt_payload := payload if {
	auth := input.request.headers["authorization"]
	startswith(auth, "Bearer ")
	tok := substring(auth, 7, -1)
	[_, payload, _] := io.jwt.decode(tok)
}

# Party config from per-instance data document (config-placer.json / config-fulfiller.json).
required_role := data.config.required_role
fhir_base     := data.config.fhir_base

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

allow if {
	# Role check: the requesting M2M/user token must carry the expected realm role.
	some r in object.get(jwt_payload, "realm_roles", [])
	r == required_role

	# Evaluate existing policy with the input shape it expects.
	data.umzh.authz.allow with input as {
		"method":        input.request.method,
		"path":          canonical_path,
		"resource_type": resource_type,
		"resource_id":   resource_id,
		"token": {
			"party_id":     object.get(jwt_payload, "party_id", ""),
			"smart_scopes": object.get(jwt_payload, "smart_scopes", ""),
			"scope":        object.get(jwt_payload, "scope", ""),
		},
		"consent_id": "",
		"consent":    null,
		"fhir_base":  fhir_base,
	}
}
