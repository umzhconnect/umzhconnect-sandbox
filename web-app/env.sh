#!/bin/sh
# =============================================================================
# Runtime environment variable injection for the SPA
# =============================================================================
# Replaces placeholder values in the built JS with runtime env vars.
# This allows the Docker image to be configured at run time.
# =============================================================================

ENV_FILE="/usr/share/nginx/html/env-config.js"

cat <<EOF > $ENV_FILE
window.__ENV__ = {
  // Non-host config
  VITE_API_BASE_URL: "${VITE_API_BASE_URL:-}",
  VITE_KEYCLOAK_REALM: "${VITE_KEYCLOAK_REALM:-umzh-connect}",
  VITE_KEYCLOAK_CLIENT_ID: "${VITE_KEYCLOAK_CLIENT_ID:-web-app}",

  // Service ports — the SPA builds URLs as <page-host>:<port>, so the same
  // build works over localhost and the server's hostname (see config/env.ts).
  APISIX_PLACER_PORT: "${APISIX_PLACER_PORT:-8080}",
  APISIX_PLACER_EXTERNAL_PORT: "${APISIX_PLACER_EXTERNAL_PORT:-8081}",
  APISIX_FULFILLER_PORT: "${APISIX_FULFILLER_PORT:-8082}",
  APISIX_FULFILLER_EXTERNAL_PORT: "${APISIX_FULFILLER_EXTERNAL_PORT:-8083}",
  REGISTRY_PORT: "${REGISTRY_PORT:-8084}",
  KEYCLOAK_PORT: "${KEYCLOAK_PORT:-8180}",
  HAPI_FHIR_PORT: "${HAPI_FHIR_PORT:-8090}",
  OPA_PLACER_PORT: "${OPA_PLACER_PORT:-8181}",
  OPA_FULFILLER_PORT: "${OPA_FULFILLER_PORT:-8182}",
  WEB_APP_PORT: "${WEB_APP_PORT:-3000}",
  RESEED_API_PORT: "${RESEED_API_PORT:-9001}",

  // Optional full-URL overrides (empty = derive from page host + port above).
  // Set these only behind a reverse proxy / HTTPS where host:port differs.
  VITE_KEYCLOAK_URL: "${VITE_KEYCLOAK_URL:-}",
  VITE_PLACER_URL: "${VITE_PLACER_URL:-}",
  VITE_PLACER_EXTERNAL_URL: "${VITE_PLACER_EXTERNAL_URL:-}",
  VITE_FULFILLER_URL: "${VITE_FULFILLER_URL:-}",
  VITE_FULFILLER_EXTERNAL_URL: "${VITE_FULFILLER_EXTERNAL_URL:-}",
  VITE_REGISTRY_URL: "${VITE_REGISTRY_URL:-}",
  VITE_RESEED_API_URL: "${VITE_RESEED_API_URL:-}",
};
EOF

echo "Environment config written to $ENV_FILE"
