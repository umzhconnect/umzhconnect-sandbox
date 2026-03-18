-- proxy_response.lua
-- Post-script at the endpoint (proxy) level for sequential proxy endpoints.
-- 1. Strips the "token_exchange" group from the merged response.
-- 2. Recursively traverses the FHIR response and rewrites string values
--    whose key is "url", "fullUrl", or "reference".
--
-- Requires allow_open_libs=true for os.getenv and string.gsub.
-- Rewrite pairs are read from REWRITE_URLS="old1|new1;old2|new2;..."
--
-- NOTE: KrakenD's data API returns userdata at proxy level — arrays support
-- full iteration via :len()/:get(i), objects do not support key enumeration
-- so traversal uses a fixed list of known FHIR fields.

local REWRITE_PAIRS = {}
local raw = os.getenv("REWRITE_URLS") or ""
for old, new in string.gmatch(raw, "([^|;]+)|([^;]+)") do
    table.insert(REWRITE_PAIRS, { old, new })
end

-- Only rewrite string values whose field name is one of these
local REWRITE_KEYS = { url = true, fullUrl = true, reference = true }

-- All fields to inspect: string fields above + containers to recurse into.
-- "remote" covers the grouped backend response in /all-tasks (group: "remote").
-- "local" covers the grouped backend response in /all-tasks (group: "local").
local INSPECT_FIELDS = {
    "url", "fullUrl", "reference",
    "remote", "local",
    "link", "entry", "resource", "contained",
    "extension", "modifierExtension",
    "identifier", "coding", "telecom",
    "subject", "basedOn", "partOf", "focus",
    "owner", "requester", "performer",
    "input", "output", "restriction",
    "reasonReference", "supportingInfo",
    "insurance", "coverage", "payee", "provider"
}

local function rewrite(s)
    if type(s) ~= "string" then return s end
    for _, pair in ipairs(REWRITE_PAIRS) do
        s = string.gsub(s, pair[1], pair[2])
    end
    return s
end

local process

-- Arrays in KrakenD's data API throw when :get() is called with a string key
-- ("number expected, got string"). Objects silently return nil for unknown keys.
-- Probing with a string key is therefore the definitive array vs object test.
local function is_array(node)
    local ok = pcall(function() return node:get("__probe") end)
    return not ok  -- string-key get threw → it IS an array
end

local function process_object(node)
    for _, field in ipairs(INSPECT_FIELDS) do
        local val = node:get(field)
        if type(val) == "string" and REWRITE_KEYS[field] then
            node:set(field, rewrite(val))
        elseif type(val) == "userdata" then
            process(val)
        end
    end
end

process = function(node)
    if type(node) ~= "userdata" then return end
    if is_array(node) then
        for i = 0, node:len() - 1 do
            local child = node:get(i)
            if type(child) == "userdata" then
                process(child)
            end
        end
    else
        process_object(node)
    end
end

function post_proxy(response)
    local r = response.load()
    r:data():del("token_exchange")

    if #REWRITE_PAIRS == 0 then return end

    -- Start traversal from top-level fields
    for _, field in ipairs(INSPECT_FIELDS) do
        local val = r:data():get(field)
        if type(val) == "string" and REWRITE_KEYS[field] then
            r:data():set(field, rewrite(val))
        elseif type(val) == "userdata" then
            process(val)
        end
    end
end
