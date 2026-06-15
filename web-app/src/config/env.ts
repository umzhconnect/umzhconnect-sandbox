// =============================================================================
// Runtime-first environment resolution
// =============================================================================
// Resolution order for each key:
//   1. window.__ENV__  — written by env.sh at container start (runtime config,
//      changeable via .env without a rebuild; see web-app/env.sh)
//   2. import.meta.env — Vite build-time vars (used in local `npm run dev`)
//   3. the supplied fallback default
// =============================================================================

export type EnvKey =
  | 'VITE_API_BASE_URL'
  | 'VITE_KEYCLOAK_URL'
  | 'VITE_KEYCLOAK_REALM'
  | 'VITE_KEYCLOAK_CLIENT_ID'
  | 'VITE_PLACER_URL'
  | 'VITE_PLACER_EXTERNAL_URL'
  | 'VITE_FULFILLER_URL'
  | 'VITE_FULFILLER_EXTERNAL_URL'
  | 'VITE_REGISTRY_URL'
  | 'VITE_RESEED_API_URL';

const runtimeEnv =
  (window as unknown as { __ENV__?: Partial<Record<EnvKey, string>> }).__ENV__ ?? {};

const buildEnv = import.meta.env as unknown as Partial<Record<EnvKey, string>>;

export function env(key: EnvKey, fallback = ''): string {
  return runtimeEnv[key] || buildEnv[key] || fallback;
}
