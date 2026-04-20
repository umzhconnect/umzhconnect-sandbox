#!/bin/sh
set -e
sed -e "s|\${PARTNER_EXTERNAL_URL}|${PARTNER_EXTERNAL_URL}|g" \
    -e "s|\${OWN_URL}|${OWN_URL}|g" \
    /templates/apisix.yaml > /usr/local/apisix/conf/apisix.yaml
exec /docker-entrypoint.sh docker-start
