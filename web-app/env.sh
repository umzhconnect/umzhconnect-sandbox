#!/bin/sh
# =============================================================================
# Runtime environment variable injection for the SPA
# =============================================================================
# Writes window.__ENV__ to env-config.js, which index.html loads before the app
# bundle (see web-app/src/config/env.ts). This lets a single built image be
# reconfigured at run time per deployment. Defaults below match the
# docker-compose sandbox port layout. Keep keys in sync with config/env.ts.
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
  VITE_REGISTRY_URL: "${VITE_REGISTRY_URL:-http://localhost:8084}",
  VITE_OPA_PLACER_URL: "${VITE_OPA_PLACER_URL:-http://localhost:8181}",
  VITE_OPA_FULFILLER_URL: "${VITE_OPA_FULFILLER_URL:-http://localhost:8182}",
  VITE_HAPI_URL: "${VITE_HAPI_URL:-http://localhost:8090}",
  VITE_WEB_APP_URL: "${VITE_WEB_APP_URL:-http://localhost:3000}",
};
EOF

echo "Environment config written to $ENV_FILE"
