-- scoped_token.lua
-- Pre-script for modifier/lua-backend on token exchange backends.
-- Builds a client_credentials POST body from the X-Consent-Id header
-- so Keycloak returns an M2M JWT carrying scope=consent:<id>.
-- client_id and client_secret are injected by KrakenD FC at startup.

function pre_backend(request, client_id, client_secret)
    local r = request.load()

    local consent_id = r:headers("X-Consent-Id") or ""

    local body = "grant_type=client_credentials"
        .. "&client_id=" .. client_id
        .. "&client_secret=" .. client_secret
    if consent_id ~= "" then
        body = body .. "&scope=consent:" .. consent_id
    end

    r:headers("Content-Type", "application/x-www-form-urlencoded")
    r:body(body)
end
