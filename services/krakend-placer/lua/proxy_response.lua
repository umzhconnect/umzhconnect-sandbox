-- proxy_response.lua
-- Post-script at the endpoint (proxy) level for placer proxy endpoints.
-- 1. Strips the "token_exchange" group from the merged response.
-- 2. Rewrites fulfiller external gateway URLs in the FHIR response data tree.
--    Replaces: http://localhost:8083/fhir/ -> http://localhost:8080/proxy/fhir/
-- Requires allow_open_libs=true for string.gsub.

local OLD_URL = "http://localhost:8083/fhir/"
local NEW_URL = "http://localhost:8080/proxy/fhir/"

-- Fields that may contain URL strings needing rewrite
local URL_FIELDS = {"url", "fullUrl", "reference", "value", "uri", "address",
                    "endpoint", "source", "destination"}

-- Fields that may contain nested objects/arrays to descend into
local NEST_FIELDS = {"link", "entry", "resource", "meta", "identifier",
                     "basedOn", "focus", "for", "owner", "requester",
                     "encounter", "reasonReference", "insurance", "contained",
                     "extension", "subject", "performer", "location",
                     "partOf", "input", "output", "note", "restriction"}

function rewrite_node(node)
    if not node or type(node) ~= "userdata" then return end

    -- Rewrite URL string fields
    for _, f in ipairs(URL_FIELDS) do
        local ok, val = pcall(function() return node:get(f) end)
        if ok and val ~= nil and type(val) == "string" then
            local nv, cnt = string.gsub(val, OLD_URL, NEW_URL)
            if cnt > 0 then node:set(f, nv) end
        end
    end

    -- Descend into nested objects/arrays
    for _, f in ipairs(NEST_FIELDS) do
        local ok, val = pcall(function() return node:get(f) end)
        if ok and val ~= nil and type(val) == "userdata" then
            rewrite_collection(val)
        end
    end
end

function rewrite_collection(node)
    if not node or type(node) ~= "userdata" then return end
    local ok, len = pcall(function() return node:len() end)
    if ok and len and len > 0 then
        for i = 0, len - 1 do
            local ok2, elem = pcall(function() return node:get(i) end)
            if ok2 and elem ~= nil then
                if type(elem) == "userdata" then
                    rewrite_node(elem)
                end
            end
        end
    else
        rewrite_node(node)
    end
end

function post_proxy(response)
    local r = response.load()
    local d = r:data()
    d:del("token_exchange")
    rewrite_node(d)
end
