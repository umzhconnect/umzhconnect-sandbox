// =============================================================================
// Central application configuration — single source of truth for every URL.
// =============================================================================
// Resolution order for each value (first non-empty wins):
//
//   1. window.__ENV__.<KEY>   Runtime override injected at container start by
//                             env.sh (writes /env-config.js, loaded from
//                             index.html). Lets ONE built image be reconfigured
//                             per deployment — required for k8s/prod where the
//                             URLs are not localhost ports.
//   2. import.meta.env.<KEY>  Build-time value baked by Vite from `.env`
//                             (used by `npm run dev`).
//   3. localhost default      The docker-compose sandbox port layout.
//
// Add new URLs here rather than reading import.meta.env / window.__ENV__ ad hoc
// in components, so there is exactly one place that knows the deployment layout.

// Build-time values. Listed with static `import.meta.env.VITE_*` accessors so
// Vite statically replaces them in the production bundle (dynamic key access is
// NOT replaced and would be undefined at runtime).
const BUILD_ENV: Record<string, string | undefined> = {
  VITE_PLACER_URL: import.meta.env.VITE_PLACER_URL,
  VITE_PLACER_EXTERNAL_URL: import.meta.env.VITE_PLACER_EXTERNAL_URL,
  VITE_FULFILLER_URL: import.meta.env.VITE_FULFILLER_URL,
  VITE_FULFILLER_EXTERNAL_URL: import.meta.env.VITE_FULFILLER_EXTERNAL_URL,
  VITE_REGISTRY_URL: import.meta.env.VITE_REGISTRY_URL,
  VITE_KEYCLOAK_URL: import.meta.env.VITE_KEYCLOAK_URL,
  VITE_KEYCLOAK_REALM: import.meta.env.VITE_KEYCLOAK_REALM,
  VITE_KEYCLOAK_CLIENT_ID: import.meta.env.VITE_KEYCLOAK_CLIENT_ID,
  VITE_OPA_PLACER_URL: import.meta.env.VITE_OPA_PLACER_URL,
  VITE_OPA_FULFILLER_URL: import.meta.env.VITE_OPA_FULFILLER_URL,
  VITE_HAPI_URL: import.meta.env.VITE_HAPI_URL,
  VITE_WEB_APP_URL: import.meta.env.VITE_WEB_APP_URL,
};

function readEnv(key: string, fallback: string): string {
  const runtime =
    typeof window !== 'undefined' ? window.__ENV__?.[key] : undefined;
  return runtime || BUILD_ENV[key] || fallback;
}

export const env = {
  /** Placer internal API gateway (own web-app → own FHIR partition). */
  placerUrl: readEnv('VITE_PLACER_URL', 'http://localhost:8080'),
  /** Placer external API gateway (partner-facing, consent-enforced). */
  placerExternalUrl: readEnv('VITE_PLACER_EXTERNAL_URL', 'http://localhost:8081'),
  /** Fulfiller internal API gateway. */
  fulfillerUrl: readEnv('VITE_FULFILLER_URL', 'http://localhost:8082'),
  /** Fulfiller external API gateway. */
  fulfillerExternalUrl: readEnv('VITE_FULFILLER_EXTERNAL_URL', 'http://localhost:8083'),
  /** Public mCSD Organization registry gateway (no auth). */
  registryUrl: readEnv('VITE_REGISTRY_URL', 'http://localhost:8084'),
  /** Keycloak base URL (published/frontend address — also the assertion `aud`). */
  keycloakUrl: readEnv('VITE_KEYCLOAK_URL', 'http://localhost:8180'),
  keycloakRealm: readEnv('VITE_KEYCLOAK_REALM', 'umzh-connect'),
  keycloakClientId: readEnv('VITE_KEYCLOAK_CLIENT_ID', 'web-app'),

  // ─── Diagnostic-only targets surfaced on the Dashboard status page ───
  // Not part of the application data flow; in prod these internal services may
  // not be browser-reachable, in which case their health checks simply fail.
  opaPlacerUrl: readEnv('VITE_OPA_PLACER_URL', 'http://localhost:8181'),
  opaFulfillerUrl: readEnv('VITE_OPA_FULFILLER_URL', 'http://localhost:8182'),
  hapiUrl: readEnv('VITE_HAPI_URL', 'http://localhost:8090'),
  webAppUrl: readEnv('VITE_WEB_APP_URL', 'http://localhost:3000'),
} as const;

/** Keycloak token endpoint used for OIDC login and the M2M assertion exchange. */
export const keycloakTokenUrl = `${env.keycloakUrl}/realms/${env.keycloakRealm}/protocol/openid-connect/token`;
