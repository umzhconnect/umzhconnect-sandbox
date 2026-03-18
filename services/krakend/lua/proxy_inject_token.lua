-- proxy_inject_token.lua
-- Pre-script for Backend 1 in sequential proxy.
-- Reads the M2M access_token obtained by Backend 0 (Keycloak client_credentials)
-- from the sequential proxy context and injects it as the Authorization header
-- so the partner's external gateway receives a consent-scoped JWT.

function inject_token(request)
    local r = request.load()

    local token = r:params("resp0_token_exchange.access_token")
    if token and token ~= "" then
        r:headers("Authorization", "Bearer " .. token)
    end
end
