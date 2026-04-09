#!/bin/sh
set -e

MAX_WAIT=${MAX_WAIT:-120}
INTERVAL=3

# URLs default to localhost (host-mode); overridden by env vars in Docker
KEYCLOAK_URL="${KEYCLOAK_URL:-http://localhost:8180}"
KRAKEND_PLACER_URL="${KRAKEND_PLACER_URL:-http://localhost:8080}"
KRAKEND_PLACER_EXT_URL="${KRAKEND_PLACER_EXT_URL:-http://localhost:8081}"
KRAKEND_FULFILLER_URL="${KRAKEND_FULFILLER_URL:-http://localhost:8082}"
KRAKEND_FULFILLER_EXT_URL="${KRAKEND_FULFILLER_EXT_URL:-http://localhost:8083}"
HAPI_FHIR_URL="${HAPI_FHIR_URL:-http://localhost:8090}"
OPA_PLACER_URL="${OPA_PLACER_URL:-http://localhost:8181}"
OPA_FULFILLER_URL="${OPA_FULFILLER_URL:-http://localhost:8182}"
RESEED_API_URL="${RESEED_API_URL:-http://localhost:9001}"

wait_for() {
    local name="$1" url="$2" elapsed=0
    printf "  Waiting for %-30s" "$name..."
    while [ "$elapsed" -lt "$MAX_WAIT" ]; do
        if wget -q --spider "$url" > /dev/null 2>&1; then
            echo " OK (${elapsed}s)"
            return 0
        fi
        sleep "$INTERVAL"
        elapsed=$((elapsed + INTERVAL))
    done
    echo " TIMEOUT after ${MAX_WAIT}s"
    return 1
}

echo "=== Waiting for services ==="
wait_for "Keycloak"               "${KEYCLOAK_URL}/realms/umzh-connect/.well-known/openid-configuration"
wait_for "HAPI FHIR"              "${HAPI_FHIR_URL}/fhir/DEFAULT/metadata"
wait_for "KrakenD Placer"         "${KRAKEND_PLACER_URL}/__health"
wait_for "KrakenD Placer Ext"     "${KRAKEND_PLACER_EXT_URL}/__health"
wait_for "KrakenD Fulfiller"      "${KRAKEND_FULFILLER_URL}/__health"
wait_for "KrakenD Fulfiller Ext"  "${KRAKEND_FULFILLER_EXT_URL}/__health"
wait_for "OPA Placer"             "${OPA_PLACER_URL}/health"
wait_for "OPA Fulfiller"          "${OPA_FULFILLER_URL}/health"
wait_for "Reseed API"             "${RESEED_API_URL}/health"
echo "=== All services ready ==="
