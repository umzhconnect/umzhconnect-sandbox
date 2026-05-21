-- Shared M2M token helper for APISIX serverless functions.
-- (Library module — not an APISIX plugin; loaded via require().)
-- Fetches a client_credentials token from Keycloak.
-- Pass a "Type/id" identifier to include RFC 9396 authorization_details,
-- which scopes the token to a specific FHIR resource context.
-- Pass nil for a plain workflow token (e.g. Task access).
local core = require("apisix.core")
local _M = {}

function _M.fetch(identifier)
  local http  = require("resty.http")
  local httpc = http.new()

  local cid     = os.getenv("CLIENT_ID")     or ""
  local csecret = os.getenv("CLIENT_SECRET") or ""
  local kc_url  = os.getenv("KEYCLOAK_URL")  or ""

  local body = "grant_type=client_credentials"
            .. "&client_id="     .. cid
            .. "&client_secret=" .. csecret

  -- Append authorization_details only when a specific resource is targeted,
  -- so Keycloak issues a context-scoped token rather than a broad one.
  if identifier then
    local auth_json = '[{"type":"umzh-connect-context","identifier":"' .. identifier .. '"}]'
    body = body .. "&authorization_details=" .. ngx.escape_uri(auth_json)
  end

  local tr = httpc:request_uri(
    kc_url .. "/realms/umzh-connect/protocol/openid-connect/token",
    { method = "POST", body = body,
      headers = { ["Content-Type"] = "application/x-www-form-urlencoded" } })

  if not tr or tr.status ~= 200 then
    core.log.warn("m2m token request failed: status=", tr and tr.status or "nil",
                  " body=", tr and tr.body or "(no response)")
    return nil
  end
  return tr.body:match('"access_token"%s*:%s*"([^"]+)"')
end

return _M
