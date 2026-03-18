-- strip_token_exchange.lua
-- Post-script at the endpoint (proxy) level for proxy endpoints.
-- Strips the "token_exchange" group from the merged response.

function strip_token_exchange(response)
    local r = response.load()

    -- Remove the token_exchange backend group from the merged data.
    r:data():del("token_exchange")
end
