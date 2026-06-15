// Placeholder for local dev (npm run dev). In the Docker image this file is
// overwritten at container start by env.sh with the real runtime values.
// When empty, config falls back to Vite's build-time import.meta.env, then to
// the hardcoded defaults in src/config/env.ts.
window.__ENV__ = {};
