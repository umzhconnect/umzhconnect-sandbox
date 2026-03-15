-- scoped_token.lua
-- Pre-script for modifier/lua-backend on the scoped-token endpoint.
-- Builds a client_credentials POST body from the X-Consent-Id header
-- so Keycloak returns an M2M JWT carrying scope=consent:<id>.

function pre_backend(request)
    local r = request.load()

    local consent_id = r:headers("X-Consent-Id") or ""

    local body = "grant_type=client_credentials"
        .. "&client_id=fulfiller-client"
        .. "&client_secret=fulfiller-secret-2025"
        .. "&scope=consent:" .. consent_id

    r:headers("Content-Type", "application/x-www-form-urlencoded")
    r:body(body)
end
