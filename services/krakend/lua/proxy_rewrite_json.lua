-- proxy_rewrite_json.lua
-- Works with encoding: "json" (r.body is a Lua table, not a string)
-- Rewrites URLs inside ANY string field in the JSON response.
-- Supports REWRITE_URLS="old1|new1;old2|new2;..."
-- Requires allow_open_libs=true for os.getenv and string.gmatch.

------------------------------------------------------------
-- Load rewrite pairs from environment
------------------------------------------------------------
local REWRITE_PAIRS = {}
local raw = os.getenv("REWRITE_URLS") or ""

for old, new in string.gmatch(raw, "([^|;]+)|([^;]+)") do
    table.insert(REWRITE_PAIRS, { old, new })
end

------------------------------------------------------------
-- Recursively rewrite all string fields in a JSON table
------------------------------------------------------------
local function rewrite_value(value)
    if type(value) == "string" then
        -- apply all rewrite rules to this string
        for _, pair in ipairs(REWRITE_PAIRS) do
            value = string.gsub(value, pair[1], pair[2])
        end
        return value

    elseif type(value) == "table" then
        -- recursively rewrite nested tables
        for k, v in pairs(value) do
            value[k] = rewrite_value(v)
        end
        return value
    end

    -- numbers, booleans, null → unchanged
    return value
end

------------------------------------------------------------
-- KrakenD entrypoint
------------------------------------------------------------
function rewriteUrlsInJson()
    if #REWRITE_PAIRS == 0 then
        return
    end

    local r = response.load()

    -- r.body is a Lua table because encoding=json
    r.body = rewrite_value(r.body)

    response.save(r)
end
