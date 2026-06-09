#!/bin/sh
set -e
sed -e "s|\${PARTNER_EXTERNAL_URL}|${PARTNER_EXTERNAL_URL}|g" \
    -e "s|\${OWN_URL}|${OWN_URL}|g" \
    -e "s|\${PARTY}|${PARTY}|g" \
    -e "s|\${PARTNER}|${PARTNER}|g" \
    -e "s|\${NGINX_OWN_PORT}|${NGINX_OWN_PORT}|g" \
    -e "s|\${JWKS_NGINX_PORT}|${JWKS_NGINX_PORT}|g" \
    /templates/apisix.yaml > /usr/local/apisix/conf/apisix.yaml
exec /docker-entrypoint.sh docker-start
