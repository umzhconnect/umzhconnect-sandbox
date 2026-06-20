// Placeholder runtime config for `npm run dev` (Vite serves /public at root).
// In the Docker image this file is overwritten at container start by env.sh
// with the deployment's real URLs. An empty object makes config/env.ts fall
// back to build-time VITE_* values (from .env) and then localhost defaults.
window.__ENV__ = {};
