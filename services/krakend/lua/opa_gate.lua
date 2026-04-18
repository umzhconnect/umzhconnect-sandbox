-- =============================================================================
-- opa_gate.lua — KrakenD sequential-proxy OPA gate
-- =============================================================================
-- Pattern: Client → KrakenD → (1) OPA → (2) HAPI FHIR
--
-- The gateway builds the full OPA input document from the JWT + URL params
-- and sends it to OPA as Backend 1.  The Lua proxy post-hook inspects the
-- merged result:
--   • allowed → strip the OPA group key and return the FHIR response
--   • denied  → raise a Lua error (KrakenD CE returns HTTP 500; a future
--               upgrade to KrakenD Enterprise would yield HTTP 403 via
--               security/policies)
--
-- KrakenD configuration reference
-- --------------------------------
-- Both endpoints share the same sequential proxy structure and post hook.
-- Only the pre hook and backend URL pattern differ.
--
-- /fhir/{resource}/{id}  — single-resource read
--   Backend 1 (OPA):
--     url_pattern : /v1/data/umzh/authz?_r={resource}&_i={id}
--     pre         : "pre_opa_gate(request, '<fhir_base>')"
--     NOTE: r:params() does NOT read query-string substitutions;
--           _r and _i are parsed from r:url() directly.
--   Backend 2 (HAPI FHIR):
--     url_pattern : /fhir/{party}/{resource}/{id}
--
-- /fhir/{resource}  — consent-enforced search (mandatory _id, optional _include)
--   Backend 1 (OPA):
--     url_pattern : /v1/data/umzh/authz?_r={resource}
--     pre         : "pre_opa_gate_search(request, '<fhir_base>')"
--     NOTE: KrakenD appends forwarded input_query_strings (_id, _include) to
--           the backend URL; _id is parsed from r:url() in pre_opa_gate_search.
--   Backend 2 (HAPI FHIR):
--     url_pattern : /fhir/{party}/{resource}
--
-- Both endpoints share:
--   method      : POST  (Backend 1 only)
--   encoding    : json
--   group       : "opa" (Backend 1 only)
--   proxy.sequential : true
--   modifier/lua-proxy:
--     post : "post_opa_gate(response, request)"
--
-- Exports
-- -------
--   pre_opa_gate(request, fhir_base)         — pre hook for /{resource}/{id}
--   pre_opa_gate_search(request, fhir_base)  — pre hook for /{resource}
--   post_opa_gate(response, request)         — shared post hook
-- =============================================================================

-- ---------------------------------------------------------------------------
-- Base64url decoder (no external libs required)
-- ---------------------------------------------------------------------------
local ALPHA = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/'

local function b64url_decode(s)
    s = s:gsub('%-', '+'):gsub('_', '/')
    local pad = (4 - #s % 4) % 4
    s = s .. string.rep('=', pad)
    local out = {}
    s:gsub('(....)', function(chunk)
        local n = 0
        for i = 1, 4 do
            local c = chunk:sub(i, i)
            if c ~= '=' then n = n * 64 + (ALPHA:find(c, 1, true) - 1) end
        end
        out[#out + 1] = string.char(
            math.floor(n / 65536) % 256,
            math.floor(n / 256)   % 256,
            n % 256
        )
    end)
    local result = table.concat(out)
    return result:sub(1, #result - pad)
end

-- ---------------------------------------------------------------------------
-- Minimal JSON string-field extractor (avoids a full JSON library dependency)
-- ---------------------------------------------------------------------------
local function json_str_field(json, field)
    return json:match('"' .. field .. '"%s*:%s*"([^"]*)"') or ''
end

-- ---------------------------------------------------------------------------
-- Decode JWT payload claims without signature verification.
-- KrakenD already validated the JWT; we only need the payload for
-- building the OPA input when propagate_claims headers are unavailable.
-- ---------------------------------------------------------------------------
local function jwt_claims(auth_header)
    if not auth_header or auth_header == '' then return {} end
    local token = auth_header:match('^[Bb]earer%s+(.+)$')
    if not token then return {} end
    local parts = {}
    for p in token:gmatch('[^.]+') do
        parts[#parts + 1] = p
        if #parts == 3 then break end
    end
    if #parts < 2 then return {} end
    local ok, payload = pcall(b64url_decode, parts[2])
    if not ok then return {} end
    return {
        party_id     = json_str_field(payload, 'party_id'),
        scope        = json_str_field(payload, 'scope'),
        smart_scopes = json_str_field(payload, 'smart_scopes'),
    }
end

-- =============================================================================
-- EXPORT: pre_opa_gate
-- Backend PRE hook — builds the OPA input document and injects it as the
-- POST body sent to OPA.
--
-- Claim precedence:
--   1. propagate_claims headers (x-party-id, x-scope, x-smart-scopes)
--      set by auth/validator when output_encoding != "no-op"
--   2. JWT payload decoded directly from the Authorization header (fallback)
-- =============================================================================
function pre_opa_gate(request, fhir_base)
    local r = request.load()

    -- r:params() does not read query-string substitutions; parse _r/_i from
    -- the backend URL directly (KrakenD substitutes {resource}/{id} there).
    local url           = r:url() or ''
    local resource_type = url:match('[?&]_r=([^&]+)') or ''
    local resource_id   = url:match('[?&]_i=([^&]+)') or ''

    local auth          = r:headers('Authorization') or ''

    local party_id     = r:headers('x-party-id')     or ''
    local scope        = r:headers('x-scope')        or ''
    local smart_scopes = r:headers('x-smart-scopes') or ''

    -- Fall back to JWT decode if propagated headers are absent
    if party_id == '' or scope == '' or smart_scopes == '' then
        local claims = jwt_claims(auth)
        if party_id     == '' then party_id     = claims.party_id     or '' end
        if scope        == '' then scope        = claims.scope        or '' end
        if smart_scopes == '' then smart_scopes = claims.smart_scopes or '' end
    end

    local body = '{"input":{"method":"GET",'
              .. '"path":"/fhir/'     .. resource_type .. '/' .. resource_id .. '",'
              .. '"resource_type":"'  .. resource_type .. '",'
              .. '"resource_id":"'    .. resource_id   .. '",'
              .. '"token":{'
              ..   '"party_id":"'     .. party_id     .. '",'
              ..   '"smart_scopes":"' .. smart_scopes .. '",'
              ..   '"scope":"'        .. scope        .. '"'
              .. '},'
              .. '"consent_id":"",'
              .. '"consent":null,'
              .. '"fhir_base":"'      .. fhir_base    .. '"'
              .. '}}'

    r:body(body)
    r:headers('Content-Type', 'application/json')
end

-- =============================================================================
-- EXPORT: pre_opa_gate_search
-- Backend PRE hook for /fhir/{resource} — identical to pre_opa_gate except
-- the resource ID is read from the forwarded FHIR _id query parameter rather
-- than the _i URL substitution used by the single-resource endpoint.
--
-- KrakenD appends input_query_strings (_id, _include) to the OPA backend URL,
-- so r:url() will contain e.g. ?_r=Condition&_id=SuspectedACLRupture.
-- Fails closed (error) if _id is absent or empty.
-- =============================================================================
function pre_opa_gate_search(request, fhir_base)
    local r = request.load()

    local url           = r:url() or ''
    local resource_type = url:match('[?&]_r=([^&]+)')  or ''
    local resource_id   = url:match('[?&]_id=([^&]+)') or ''

    if resource_id == '' then
        error('500 Missing required query parameter _id')
    end

    local auth = r:headers('Authorization') or ''

    local party_id     = r:headers('x-party-id')     or ''
    local scope        = r:headers('x-scope')        or ''
    local smart_scopes = r:headers('x-smart-scopes') or ''

    if party_id == '' or scope == '' or smart_scopes == '' then
        local claims = jwt_claims(auth)
        if party_id     == '' then party_id     = claims.party_id     or '' end
        if scope        == '' then scope        = claims.scope        or '' end
        if smart_scopes == '' then smart_scopes = claims.smart_scopes or '' end
    end

    local body = '{"input":{"method":"GET",'
              .. '"path":"/fhir/'     .. resource_type .. '/' .. resource_id .. '",'
              .. '"resource_type":"'  .. resource_type .. '",'
              .. '"resource_id":"'    .. resource_id   .. '",'
              .. '"token":{'
              ..   '"party_id":"'     .. party_id     .. '",'
              ..   '"smart_scopes":"' .. smart_scopes .. '",'
              ..   '"scope":"'        .. scope        .. '"'
              .. '},'
              .. '"consent_id":"",'
              .. '"consent":null,'
              .. '"fhir_base":"'      .. fhir_base    .. '"'
              .. '}}'

    r:body(body)
    r:headers('Content-Type', 'application/json')
end

-- =============================================================================
-- EXPORT: post_opa_gate
-- Proxy POST hook — reads the OPA decision from the merged response data
-- and either cleans up the OPA group key (allow) or raises an error (deny).
--
-- OPA response is grouped under "opa" (group: "opa" in backend config).
-- We read result.http_status (200 = allow, 403 = deny) because KrakenD's
-- Lua data binding does NOT propagate JSON booleans (true/false → nil).
--
-- On deny: error() causes KrakenD CE to return HTTP 500.
--   TODO: upgrade to KrakenD Enterprise security/policies for HTTP 403.
-- =============================================================================
function post_opa_gate(response, request)
    local r = response.load()

    -- Read OPA decision (fail-closed on any missing field)
    local opa_group = r:data():get('opa')
    if opa_group == nil then
        error('503 OPA response missing — access denied (fail-closed)')
    end

    local result = opa_group:get('result')
    if result == nil then
        error('503 OPA result field missing — access denied (fail-closed)')
    end

    local http_status = result:get('http_status')
    if http_status == nil then
        error('503 OPA http_status field missing — access denied (fail-closed)')
    end

    if http_status ~= 200 then
        error('403 Access denied by consent policy')
    end

    -- Allowed: strip the OPA metadata from the response body
    r:data():del('opa')
end
