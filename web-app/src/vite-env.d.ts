/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_API_BASE_URL: string;
  readonly VITE_KEYCLOAK_URL: string;
  readonly VITE_KEYCLOAK_REALM: string;
  readonly VITE_KEYCLOAK_CLIENT_ID: string;
  readonly VITE_PLACER_URL: string;
  readonly VITE_PLACER_EXTERNAL_URL: string;
  readonly VITE_FULFILLER_URL: string;
  readonly VITE_FULFILLER_EXTERNAL_URL: string;
  readonly VITE_REGISTRY_URL: string;
  readonly VITE_OPA_PLACER_URL: string;
  readonly VITE_OPA_FULFILLER_URL: string;
  readonly VITE_HAPI_URL: string;
  readonly VITE_WEB_APP_URL: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}

// Runtime configuration injected by env.sh (env-config.js) and loaded from
// index.html before the app bundle. Absent in `npm run dev`.
interface Window {
  __ENV__?: Record<string, string | undefined>;
}
