local core    = require("apisix.core")
local jwt_lib = require("resty.jwt")
local ngx     = ngx

-- Accepts either:
--   required_role: "placer"          (single string — backward-compatible)
--   allowed_roles: ["placer","user"] (array — any match grants access)
-- At least one field must be present; check_schema enforces this.
local schema = {
    type = "object",
    properties = {
        required_role = { type = "string" },
        allowed_roles = {
            type = "array",
            items    = { type = "string" },
            minItems = 1,
        },
    },
}

local _M = {
    version  = 0.1,
    priority = 2500,
    name     = "umzh-role-check",
    schema   = schema,
}

function _M.check_schema(conf)
    local ok, err = core.schema.check(schema, conf)
    if not ok then return false, err end
    if not conf.required_role and not conf.allowed_roles then
        return false, "one of 'required_role' or 'allowed_roles' is required"
    end
    return true
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

    -- Build lookup table from whichever config form is used
    local allowed = {}
    if conf.allowed_roles then
        for _, r in ipairs(conf.allowed_roles) do
            allowed[r] = true
        end
    else
        allowed[conf.required_role] = true
    end

    for _, r in ipairs(obj.payload.realm_roles or {}) do
        if allowed[r] then return end
    end
    return 403, { message = "forbidden" }
end

return _M
