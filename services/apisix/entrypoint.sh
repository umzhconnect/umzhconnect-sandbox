#!/bin/sh
set -e
# Auth server discovery URL. Defaults to the in-cluster sandbox Keycloak so the
# two-party sandbox is unaffected; party-deployment overrides it with the
# external/shared auth server from its .env.
KEYCLOAK_DISCOVERY_URL="${KEYCLOAK_DISCOVERY_URL:-http://keycloak:8080/realms/umzh-connect/.well-known/openid-configuration}"
sed -e "s|\${PARTNER_EXTERNAL_URL}|${PARTNER_EXTERNAL_URL}|g" \
    -e "s|\${OWN_URL}|${OWN_URL}|g" \
    -e "s|\${PARTY}|${PARTY}|g" \
    -e "s|\${PARTNER}|${PARTNER}|g" \
    -e "s|\${NGINX_OWN_PORT}|${NGINX_OWN_PORT}|g" \
    -e "s|\${KEYCLOAK_DISCOVERY_URL}|${KEYCLOAK_DISCOVERY_URL}|g" \
    /templates/apisix.yaml > /usr/local/apisix/conf/apisix.yaml
exec /docker-entrypoint.sh docker-start
