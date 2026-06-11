-- umzh-task-requester-inject.lua
-- Injects a `requester=<organization_reference>` FHIR search parameter into the
-- upstream URL, populated from the caller's JWT claim
-- $.extensions.umzhconnect.organization_reference.
--
-- Mounted on the external gateway's /fhir/Task list route so HAPI returns only
-- Tasks for which the calling party is named as the requester. Combined with the
-- OPA scope check on the same route (require system/Task.s), this gives:
--   * scope-gated:   caller must hold .s permission
--   * server-side filtered: caller cannot see Tasks belonging to other requesters
--
-- The JWT signature is verified by the `openid-connect` plugin on the same
-- route, which runs in the access phase at priority 2599. This plugin runs in
-- the same phase at priority 999, so by the time it executes the bearer has
-- already been validated. (If validation fails, openid-connect aborts the
-- request with 401 before this plugin's set_uri_args call would matter.)
--
-- io.jwt.decode is not used here because resty.jwt's dependency chain is heavy
-- for what is a parse-only operation. The signed JWT's middle segment is
-- base64url-decoded inline; we trust the signature check done upstream.

local plugin_name = "umzh-task-requester-inject"
local cjson = require("cjson.safe")

local _M = {
  version  = 0.1,
  priority = 999,
  name     = plugin_name,
  schema   = { type = "object", properties = {} },
}

local function b64url_decode(s)
  s = s:gsub("-", "+"):gsub("_", "/")
  local rem = #s % 4
  if rem > 0 then s = s .. string.rep("=", 4 - rem) end
  return ngx.decode_base64(s)
end

function _M.access(conf, ctx)
  local auth = ngx.req.get_headers()["authorization"] or ""
  local tok  = auth:match("^Bearer%s+(.+)$")
  if not tok then return end

  local _, payload_b64 = tok:match("([^%.]+)%.([^%.]+)")
  if not payload_b64 then return end

  local payload_json = b64url_decode(payload_b64)
  if not payload_json then return end

  local payload = cjson.decode(payload_json)
  if not payload then return end

  local ext = payload.extensions
  local umzh = ext and ext.umzhconnect
  local org_ref = umzh and umzh.organization_reference
  if not org_ref or org_ref == "" then return end

  -- proxy-rewrite (rewrite phase) has already overwritten the upstream path
  -- to /fhir/<party>/Task via ctx.var.upstream_uri. We append the requester
  -- search parameter directly on that variable — set_uri_args at access phase
  -- mutates the inbound request's args but APISIX doesn't re-derive
  -- upstream_uri from them after proxy-rewrite, so the inbound mutation is
  -- silently dropped.
  local cur = ctx.var.upstream_uri or ngx.var.upstream_uri or ""
  local sep = cur:find("?", 1, true) and "&" or "?"
  ctx.var.upstream_uri = cur .. sep .. "requester=" .. ngx.escape_uri(org_ref)
end

return _M
