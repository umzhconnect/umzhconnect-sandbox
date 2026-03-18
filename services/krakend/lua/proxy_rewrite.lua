-- proxy_rewrite.lua
-- Post-script at the BACKEND level for the FHIR proxy backend (backend 1).
-- Rewrites URLs in the raw FHIR response body before KrakenD merges it with
-- the other backends. At backend level r:body() returns the actual HTTP
-- response body, so plain string.gsub replacement works correctly.
--
-- Rewrite pairs are read from REWRITE_URLS as "old1|new1;old2|new2;..."
-- Requires allow_open_libs=true for string.gsub, string.gmatch and os.getenv.

local REWRITE_PAIRS = {}
local raw = os.getenv("REWRITE_URLS") or ""
for old, new in string.gmatch(raw, "([^|;]+)|([^;]+)") do
    table.insert(REWRITE_PAIRS, { old, new })
end

function rewriteUrls()
    local r = response.load()
    if #REWRITE_PAIRS == 0 then return end
    local body = r:body()
    for _, pair in ipairs(REWRITE_PAIRS) do
        body = string.gsub(body, pair[1], pair[2])
    end
    r:body(body)
end
