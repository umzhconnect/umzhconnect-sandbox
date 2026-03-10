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
  VITE_API_BASE_URL: "${VITE_API_BASE_URL:-}",
  VITE_KEYCLOAK_URL: "${VITE_KEYCLOAK_URL:-http://localhost:8180}",
  VITE_KEYCLOAK_REALM: "${VITE_KEYCLOAK_REALM:-umzh-connect}",
  VITE_KEYCLOAK_CLIENT_ID: "${VITE_KEYCLOAK_CLIENT_ID:-web-app}",
  VITE_PLACER_URL: "${VITE_PLACER_URL:-http://localhost:8080}",
  VITE_PLACER_EXTERNAL_URL: "${VITE_PLACER_EXTERNAL_URL:-http://localhost:8081}",
  VITE_FULFILLER_URL: "${VITE_FULFILLER_URL:-http://localhost:8082}",
  VITE_FULFILLER_EXTERNAL_URL: "${VITE_FULFILLER_EXTERNAL_URL:-http://localhost:8083}",
};
EOF

echo "Environment config written to $ENV_FILE"
