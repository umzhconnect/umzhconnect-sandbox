// =============================================================================
// Runtime environment resolution
// =============================================================================
// Browser URLs are built from the host the app was served from (localhost, a
// tunnelled localhost, or the server's hostname) plus a port supplied via .env.
// This lets one build work over http://localhost:3001 and http://<server>:3001
// alike, with no per-environment rebuild.
//
// Resolution order:
//   1. window.__ENV__  — written by env.sh at container start (see env.sh)
//   2. import.meta.env — Vite build-time vars (local `npm run dev`)
//   3. fallback default
//
// serviceUrl() additionally derives the host dynamically: an explicit full-URL
// override wins (handy behind a reverse proxy / HTTPS), otherwise it's the
// current page's host on the configured port.
// =============================================================================

const runtimeEnv: Record<string, string> =
  (window as unknown as { __ENV__?: Record<string, string> }).__ENV__ ?? {};

const buildEnv = import.meta.env as unknown as Record<string, string | undefined>;

export function env(key: string, fallback = ''): string {
  return runtimeEnv[key] || buildEnv[key] || fallback;
}

/** Build a URL on the host that served the app, for the given port. */
export function hostUrl(port: string | number): string {
  const { protocol, hostname } = window.location;
  return `${protocol}//${hostname}:${port}`;
}

/**
 * Resolve a browser-facing service URL: an explicit full-URL override
 * (urlKey) wins; otherwise same-host on the port from portKey (or default).
 */
export function serviceUrl(urlKey: string, portKey: string, defaultPort: number): string {
  return env(urlKey) || hostUrl(env(portKey, String(defaultPort)));
}
