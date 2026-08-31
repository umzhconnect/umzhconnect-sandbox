#!/bin/sh
set -e

MAX_WAIT=${MAX_WAIT:-120}
INTERVAL=3

# URLs default to localhost (host-mode); overridden by env vars in Docker
KEYCLOAK_URL="${KEYCLOAK_URL:-http://localhost:8180}"
APISIX_PLACER_URL="${APISIX_PLACER_URL:-http://localhost:8080}"
APISIX_PLACER_EXT_URL="${APISIX_PLACER_EXT_URL:-http://localhost:8081}"
APISIX_FULFILLER_URL="${APISIX_FULFILLER_URL:-http://localhost:8082}"
APISIX_FULFILLER_EXT_URL="${APISIX_FULFILLER_EXT_URL:-http://localhost:8083}"
HAPI_FHIR_URL="${HAPI_FHIR_URL:-http://localhost:8090}"
REGISTRY_URL="${REGISTRY_URL:-http://localhost:8084}"
OPA_PLACER_URL="${OPA_PLACER_URL:-http://localhost:8181}"
OPA_FULFILLER_URL="${OPA_FULFILLER_URL:-http://localhost:8182}"
ADMIN_API_URL="${ADMIN_API_URL:-http://localhost:9000}"
WEB_APP_URL="${WEB_APP_URL:-http://localhost:3000}"

wait_for() {
    local name="$1" url="$2" elapsed=0
    printf "  Waiting for %-30s" "$name..."
    while [ "$elapsed" -lt "$MAX_WAIT" ]; do
        if curl -sf --max-time 5 "$url" > /dev/null 2>&1 || wget -q --spider --timeout=5 "$url" > /dev/null 2>&1; then
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
wait_for "Registry"               "${REGISTRY_URL}/fhir/metadata"
wait_for "APISIX Placer"          "${APISIX_PLACER_URL}/__health"
wait_for "APISIX Placer Ext"      "${APISIX_PLACER_EXT_URL}/__health"
wait_for "APISIX Fulfiller"       "${APISIX_FULFILLER_URL}/__health"
wait_for "APISIX Fulfiller Ext"   "${APISIX_FULFILLER_EXT_URL}/__health"
wait_for "OPA Placer"             "${OPA_PLACER_URL}/health"
wait_for "OPA Fulfiller"          "${OPA_FULFILLER_URL}/health"
wait_for "Admin API"              "${ADMIN_API_URL}/health"
wait_for "Web App (L2 keys)"      "${WEB_APP_URL}/l2-keys/placer-l2.key"
wait_for "Key Custodian Placer"   "${KEY_CUSTODIAN_PLACER_URL:-http://localhost:8087}/healthz"
wait_for "Key Custodian Fulfiller" "${KEY_CUSTODIAN_FULFILLER_URL:-http://localhost:8089}/healthz"
echo "=== All services ready ==="
