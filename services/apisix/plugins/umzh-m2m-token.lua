-- umzh-m2m-token.lua
-- Acquires an M2M token from Keycloak and sets Authorization on the request.
-- Supports L1 (client_secret) and L2 (private_key_jwt / RS256).
--
-- The acquire() function is also callable directly from serverless functions
-- (e.g. /api/token/m2m, actions-all-tasks) so token-acquisition logic lives
-- in exactly one place.
--
-- Config:
--   include_fhir_context (bool, default false)
--     Derives authorization_details from the incoming /proxy/fhir/<Type>/<id>
--     path so the issued token carries a fhirContext claim for OPA.

local plugin_name = "umzh-m2m-token"

local schema = {
  type = "object",
  properties = {
    include_fhir_context = { type = "boolean", default = false },
  },
}

local _M = {
  version  = 0.1,
  priority = 1002,
  name     = plugin_name,
  schema   = schema,
}

-- Internal URL used for the actual HTTP call (Docker network).
local TOKEN_URL = "http://keycloak:8080/realms/umzh-connect/protocol/openid-connect/token"

-- Acquire an M2M access token from Keycloak.
-- extra_body: optional URL-encoded string appended to the POST body.
-- Returns access_token string, or nil + error message on failure.
function _M.acquire(extra_body)
  local http     = require("resty.http")
  local cid_l2   = os.getenv("CLIENT_ID_L2")   or ""
  local key_path = os.getenv("CLIENT_KEY_PATH") or ""
  local body

  if cid_l2 ~= "" and key_path ~= "" then
    local jwt = require("resty.jwt")
    local f   = io.open(key_path, "r")
    if not f then
      return nil, "key file not found: " .. key_path
    end
    local pem = f:read("*all"); f:close()
    -- aud must match the realm's published token endpoint (Keycloak validates
    -- against its own issuer/token-endpoint URLs, which use the public hostname).
    local aud = os.getenv("KEYCLOAK_TOKEN_ENDPOINT") or TOKEN_URL
    local now = ngx.time()
    local sig = jwt:sign(pem, {
      header  = { typ = "JWT", alg = "RS256" },
      payload = {
        iss = cid_l2,
        sub = cid_l2,
        aud = aud,
        exp = now + 60,
        jti = string.format("%.6f-%d-%d", ngx.now(), ngx.worker.pid(), math.random(2^31)),
      },
    })
    body = "grant_type=client_credentials"
        .. "&client_id=" .. cid_l2
        .. "&client_assertion_type=urn%3Aietf%3Aparams%3Aoauth%3Aclient-assertion-type%3Ajwt-bearer"
        .. "&client_assertion=" .. sig
  else
    body = "grant_type=client_credentials"
        .. "&client_id="     .. (os.getenv("CLIENT_ID")     or "")
        .. "&client_secret=" .. (os.getenv("CLIENT_SECRET") or "")
  end

  if extra_body then body = body .. extra_body end

  local httpc    = http.new()
  local tr, err  = httpc:request_uri(TOKEN_URL, {
    method  = "POST",
    body    = body,
    headers = { ["Content-Type"] = "application/x-www-form-urlencoded" },
  })
  if not tr or tr.status ~= 200 then
    return nil, err or ("keycloak HTTP " .. (tr and tr.status or "nil"))
  end
  local token = tr.body:match('"access_token"%s*:%s*"([^"]+)"')
  if not token then return nil, "no access_token in response" end
  return token
end

function _M.access(conf, ctx)
  local extra = ""

  if conf.include_fhir_context then
    local orig_uri   = ngx.var.request_uri
    local path       = orig_uri:match("^([^?]+)") or orig_uri
    local identifier = path:match("/proxy/fhir/(.+)") or ""
    if not identifier:find("/") then
      local args = ngx.req.get_uri_args()
      local qid  = (args and args["_id"]) or ""
      if qid ~= "" then identifier = identifier .. "/" .. qid end
    end
    if identifier:find("/") then
      local auth_json = '[{"type":"umzh-connect-context","identifier":"' .. identifier .. '"}]'
      extra = "&authorization_details=" .. ngx.escape_uri(auth_json)
    end
  end

  local token, err = _M.acquire(extra ~= "" and extra or nil)
  if not token then
    ngx.log(ngx.ERR, "[umzh-m2m-token] ", err)
    return ngx.exit(502)
  end
  ngx.req.set_header("Authorization", "Bearer " .. token)
end

return _M
