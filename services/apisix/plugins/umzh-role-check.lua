local core    = require("apisix.core")
local jwt_lib = require("resty.jwt")
local ngx     = ngx

local schema = {
    type = "object",
    properties = {
        required_role = { type = "string" },
    },
    required = {"required_role"},
}

local _M = {
    version  = 0.1,
    priority = 2500,
    name     = "umzh-role-check",
    schema   = schema,
}

function _M.check_schema(conf)
    return core.schema.check(schema, conf)
end

function _M.access(conf, ctx)
    local auth = ngx.req.get_headers()["Authorization"] or ""
    if not auth:find("^[Bb]earer ") then
        return 401, { message = "missing token" }
    end
    local tok = auth:sub(8)
    local obj = jwt_lib:load_jwt(tok)
    if not obj or not obj.payload then
        return 401, { message = "invalid token" }
    end
    for _, r in ipairs(obj.payload.realm_roles or {}) do
        if r == conf.required_role then return end
    end
    return 403, { message = "forbidden" }
end

return _M
