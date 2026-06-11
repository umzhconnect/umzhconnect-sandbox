#!/bin/sh
set -e
sed "s|\${WEB_APP_PORT}|${WEB_APP_PORT}|g" \
    /opt/keycloak/data/import/realm-export.json.template \
    > /opt/keycloak/data/import/realm-export.json
exec /opt/keycloak/bin/kc.sh "$@"
