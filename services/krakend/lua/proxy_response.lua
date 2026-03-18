-- proxy_response.lua
-- Post-script at the endpoint (proxy) level for proxy endpoints.
-- 1. Strips the "token_exchange" group from the merged response.
-- 2. Rewrites URLs in the response body via a list of find/replace pairs.
--    Pairs are read from REWRITE_URLS as "old1|new1;old2|new2;..."
-- Requires allow_open_libs=true for string.gsub, string.gmatch and os.getenv.

local REWRITE_PAIRS = {}
local raw = os.getenv("REWRITE_URLS") or ""
for old, new in string.gmatch(raw, "([^|;]+)|([^;]+)") do
    table.insert(REWRITE_PAIRS, { old, new })
end

function post_proxy(response)
    local r = response.load()
    r:data():del("token_exchange")
    if #REWRITE_PAIRS > 0 then
        local body = r:body()
        for _, pair in ipairs(REWRITE_PAIRS) do
            body = string.gsub(body, pair[1], pair[2])
        end
        r:body(body)
    end
end
