-- umzh-capability-guard.lua
-- Deny-by-default allowlist for FHIR query parameters and `_include` values,
-- enforcing the *static* API contract from the IG CapabilityStatement at the
-- edge. It complements the other two layers:
--   * routing      → which (method × resourceType) is reachable at all
--                    (a type with no route → 404, APISIX default-deny).
--   * THIS plugin  → which query params / _include values are permitted on a
--                    route that IS reachable.
--   * OPA          → consent / fhirContext-graph / _id-in-context authorization.
--
-- A request passes only if EVERY query key is explicitly permitted, after
-- normalizing for FHIR parameter syntax:
--   * every name in `require` is present
--   * `_id` (when allowed) is single-valued (no comma-OR, no repeats)
--   * `_include` values ∈ allow_includes  (rejects `*`, `:iterate`, unknowns)
--   * every other key's BASE name ∈ allow_params, with NO `:modifier` and NO
--     `.chain`
--
-- Deny-by-default means nothing needs an explicit blocklist: `_revinclude`,
-- `_has`, `_filter`, `_query`, `_contained`, `_content`, `_text`, `_list`,
-- modifiers, chained params, and generic control params (`_format`, `_count`,
-- ...) are all rejected simply by not appearing in `allow_params`/`allow_includes`.
--
-- Violations return 400 + an OperationOutcome (FHIR's `handling=strict`
-- behaviour for unsupported parameters; matches what HAPI itself returns). The
-- exact status code is intentionally simple here and may be revisited.

local core = require("apisix.core")

local schema = {
  type = "object",
  properties = {
    -- Search parameter names that MUST be present (e.g. ["_id"]).
    ["require"]    = { type = "array", items = { type = "string" }, default = {} },
    -- Search parameter names that MAY be present (must include anything in
    -- `require`). Empty ⇒ no query parameters permitted (e.g. read-by-id).
    allow_params   = { type = "array", items = { type = "string" }, default = {} },
    -- Permitted `_include` values, verbatim (e.g. "ServiceRequest:patient").
    allow_includes = { type = "array", items = { type = "string" }, default = {} },
    -- FHIR JSON-Patch field allowlist (PATCH routes): every op's `path` (and
    -- `from`, for move/copy) must address one of these top-level elements.
    -- Empty ⇒ not enforced (non-PATCH routes leave this unset).
    patchable_fields = { type = "array", items = { type = "string" }, default = {} },
  },
  -- Reject unknown keys at config-load time. Without this a typo fails open in
  -- one case: misspelling `require` (e.g. `requires`) would silently drop the
  -- mandatory-parameter check, letting an unbounded search through.
  additionalProperties = false,
}

local _M = {
  version  = 0.1,
  -- After openid-connect (2599) so auth is checked first; before the opa
  -- plugin (2001) so malformed requests fail fast without a consent lookup.
  priority = 2400,
  name     = "umzh-capability-guard",
  schema   = schema,
}

function _M.check_schema(conf)
  return core.schema.check(schema, conf)
end

local function to_set(arr)
  local s = {}
  for _, v in ipairs(arr or {}) do s[v] = true end
  return s
end

-- 400 + FHIR OperationOutcome. issue_code is a FHIR issue-type code
-- ("not-supported", "required", "invalid").
local function reject(issue_code, msg)
  return 400, {
    resourceType = "OperationOutcome",
    issue = { {
      severity    = "error",
      code        = issue_code,
      diagnostics = msg,
    } },
  }
end

function _M.access(conf, ctx)
  -- Use ngx.req directly (not core.request wrapper) so the "truncated" signal
  -- is visible. 20 covers the widest legitimate route (7 params max) with room
  -- to spare; anything beyond that fails closed rather than being silently
  -- forwarded to HAPI in the raw query string.
  local MAX_ARGS = 20
  local args, err = ngx.req.get_uri_args(MAX_ARGS)
  if err == "truncated" then
    return reject("invalid", "too many query parameters")
  end
  args = args or {}
  local allow_params   = to_set(conf.allow_params)
  local allow_includes = to_set(conf.allow_includes)

  for key, val in pairs(args) do
    if key == "_include" then
      -- `_include` is permitted, but only for enumerated values. An empty
      -- allow_includes therefore rejects every `_include`.
      local vals = (type(val) == "table") and val or { val }
      for _, v in ipairs(vals) do
        if not allow_includes[v] then
          return reject("not-supported", "unsupported _include value: " .. tostring(v))
        end
      end

    else
      -- Chained search parameter, e.g. subject.name
      if key:find(".", 1, true) then
        return reject("not-supported", "chained search parameter not supported: " .. key)
      end
      -- Modifier (_id:above, code:text) or reverse-chain (_has:...); also
      -- catches _revinclude:iterate. (_include's colon is in the value, above.)
      if key:find(":", 1, true) then
        return reject("not-supported", "search parameter modifier not supported: " .. key)
      end
      -- Deny-by-default: anything not allow-listed is rejected here — including
      -- _revinclude, _has, _filter, _query, _contained, _format, _count, ...
      if not allow_params[key] then
        return reject("not-supported", "unsupported search parameter: " .. key)
      end
      -- _id must identify a single resource.
      if key == "_id" then
        if type(val) == "table" then
          return reject("invalid", "_id must be single-valued")
        end
        if type(val) == "string" and val:find(",", 1, true) then
          return reject("invalid", "_id must be single-valued")
        end
      end
    end
  end

  -- Required parameters present?
  for _, req in ipairs(conf["require"] or {}) do
    if args[req] == nil then
      return reject("required", "missing required search parameter: " .. req)
    end
  end

  -- PATCH body field allowlist (FHIR JSON-Patch). Only enforced when configured.
  -- Each op's target `path` (and `from`, for move/copy) must address a permitted
  -- top-level element; anything else → 400 (IG: "other paths SHALL be rejected").
  if conf.patchable_fields and #conf.patchable_fields > 0 then
    local allow_fields = to_set(conf.patchable_fields)
    ngx.req.read_body()
    local raw = ngx.req.get_body_data()
    local ops = raw and core.json.decode(raw)
    if type(ops) ~= "table" or ops[1] == nil then
      return reject("invalid", "PATCH body must be a non-empty JSON-Patch array")
    end
    for _, op in ipairs(ops) do
      if type(op.path) ~= "string" then
        return reject("invalid", "JSON-Patch op missing path")
      end
      local targets = { op.path }
      if op.from ~= nil then targets[#targets + 1] = op.from end
      for _, p in ipairs(targets) do
        local root = type(p) == "string" and p:match("^/([^/]+)")
        if not root or not allow_fields[root] then
          return reject("not-supported", "field not patchable: " .. tostring(p))
        end
      end
    end
  end
end

return _M
