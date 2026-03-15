-- proxy_response.lua
-- Post-script at the endpoint (proxy) level for placer proxy endpoints.
-- 1. Strips the "token_exchange" group from the merged response.
-- 2. Rewrites fulfiller external gateway URLs via string.gsub on the response body.
--    Replaces: http://localhost:8083/fhir/ -> http://localhost:8080/proxy/fhir/
-- Requires allow_open_libs=true for string.gsub.

local OLD_URL = "http://localhost:8083/fhir/"
local NEW_URL = "http://localhost:8080/proxy/fhir/"

function post_proxy(response)
    local r = response.load()
    r:data():del("token_exchange")
    local body = r:body()
    local new_body = string.gsub(body, OLD_URL, NEW_URL)
    r:body(new_body)
end
