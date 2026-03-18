-- proxy_response.lua
-- Post-script at the endpoint (proxy) level for proxy endpoints.
-- 1. Strips the "token_exchange" group from the merged response.
-- 2. Rewrites URLs in the response body via a list of find/replace pairs.
--    Pairs are read from REWRITE_URLS as "old1|new1;old2|new2;..."
--
-- With output_encoding=json the merged response lives in the DATA BUFFER only.
-- r:body() always returns an empty string in this configuration, so all
-- rewriting must go through the data API (r:data()), not r:body()/r:body(s).
--
-- NOTE: allow_open_libs=true is required at the proxy level for string.gsub.
-- At the backend level, allow_open_libs=true breaks source file loading, so
-- URL rewriting cannot be done there alongside source-based pre-scripts.
--
-- For FHIR Bundles the canonical navigation URLs appear in:
--   link[*].url    — self / next / prev links for the Bundle
--   entry[*].fullUrl — absolute URL for each bundle entry
-- Both are userdata Table objects returned by r:data():get(); their elements
-- are accessed 0-based via :get(i) / :set(k,v) / :len().
--
-- Requires allow_open_libs=true for string.gsub, string.gmatch and os.getenv.

local REWRITE_PAIRS = {}
local raw = os.getenv("REWRITE_URLS") or ""
for old, new in string.gmatch(raw, "([^|;]+)|([^;]+)") do
    table.insert(REWRITE_PAIRS, { old, new })
end

-- Apply all rewrite pairs to a single string value.
local function rewrite(s)
    if type(s) ~= "string" then return s end
    for _, pair in ipairs(REWRITE_PAIRS) do
        s = string.gsub(s, pair[1], pair[2])
    end
    return s
end

function post_proxy(response)
    local r = response.load()

    -- Remove the token_exchange backend group from the merged data.
    r:data():del("token_exchange")

    if #REWRITE_PAIRS == 0 then return end

    -- Rewrite FHIR Bundle link[*].url (self / next / prev navigation links).
    local links = r:data():get("link")
    if links and type(links) == "userdata" then
        for i = 0, links:len() - 1 do
            local link = links:get(i)
            if link then
                link:set("url", rewrite(link:get("url")))
            end
        end
    end

    -- Rewrite FHIR Bundle entry[*].fullUrl (absolute URL for each resource).
    local entries = r:data():get("entry")
    if entries and type(entries) == "userdata" then
        for i = 0, entries:len() - 1 do
            local entry = entries:get(i)
            if entry then
                entry:set("fullUrl", rewrite(entry:get("fullUrl")))
            end
        end
    end
end
