declare global {
  interface Window {
    __ENV__?: Record<string, string>;
  }
}

function env(key: string, fallback: string): string {
  return window.__ENV__?.[key] || import.meta.env[key] || fallback;
}

export const VITE_KEYCLOAK_URL        = env('VITE_KEYCLOAK_URL',        'http://localhost:8180');
export const VITE_KEYCLOAK_REALM      = env('VITE_KEYCLOAK_REALM',      'umzh-connect');
export const VITE_KEYCLOAK_CLIENT_ID  = env('VITE_KEYCLOAK_CLIENT_ID',  'web-app');
export const VITE_PLACER_URL          = env('VITE_PLACER_URL',          'http://localhost:8080');
export const VITE_PLACER_EXTERNAL_URL = env('VITE_PLACER_EXTERNAL_URL', 'http://localhost:8081');
export const VITE_FULFILLER_URL       = env('VITE_FULFILLER_URL',       'http://localhost:8082');
export const VITE_FULFILLER_EXTERNAL_URL = env('VITE_FULFILLER_EXTERNAL_URL', 'http://localhost:8083');
export const VITE_REGISTRY_URL        = env('VITE_REGISTRY_URL',        'http://localhost:8084');
