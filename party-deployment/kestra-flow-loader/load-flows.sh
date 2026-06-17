#!/bin/sh
# =============================================================================
# Kestra Flow Loader — one-shot sidecar
#
# Waits for the Kestra API to come up, then POSTs each YAML file in /flows to
# /api/v1/flows. Mirrors the existing seed-loader pattern:
#
#   * one-shot init container (exits 0 once flows are loaded)
#   * idempotent: POST on first boot, PUT-fallback on subsequent boots if the
#     flow already exists in the persisted Postgres repository
#   * holds no key material; only talks HTTP to Kestra
#
# Existence of this file as a separate service is what lets the kestra service
# itself run from the unmodified upstream image — no Dockerfile required.
#
# Policy: POST → PUT-fallback.  This means re-runs against an existing flow
# overwrite UI-edited revisions with the on-disk YAML.  That's the "GitOps
# wins" stance; if you want UI edits to stick, set KESTRA_FLOW_POLICY=seed-only
# and the script will skip the PUT when POST returns 422/409.
# =============================================================================
set -u

KESTRA_API="${KESTRA_API:-http://kestra:8080/api/v1}"
FLOWS_DIR="${FLOWS_DIR:-/flows}"
WAIT_TIMEOUT="${WAIT_TIMEOUT:-300}"          # seconds
POLICY="${KESTRA_FLOW_POLICY:-enforce}"      # enforce | seed-only

echo "[kestra-flow-loader] API=${KESTRA_API} flows=${FLOWS_DIR} policy=${POLICY}"

# ── Wait for the Kestra API ─────────────────────────────────────────────────
ready=""
elapsed=0
while [ "$elapsed" -lt "$WAIT_TIMEOUT" ]; do
  code=$(curl -s -o /dev/null -w '%{http_code}' --max-time 5 \
    "${KESTRA_API}/flows/search" 2>/dev/null || true)
  if [ "$code" = "200" ]; then
    ready="yes"
    echo "[kestra-flow-loader] API ready after ${elapsed}s"
    break
  fi
  sleep 3
  elapsed=$((elapsed + 3))
done
if [ -z "$ready" ]; then
  echo "[kestra-flow-loader] API did not become ready within ${WAIT_TIMEOUT}s — exiting 1"
  exit 1
fi

# ── Import each YAML ─────────────────────────────────────────────────────────
exit_code=0
for f in "${FLOWS_DIR}"/*.yml "${FLOWS_DIR}"/*.yaml; do
  [ -f "$f" ] || continue

  ns=$(grep -m1 '^namespace:' "$f" | awk '{print $2}' | tr -d '\r')
  id=$(grep -m1 '^id:' "$f" | awk '{print $2}' | tr -d '\r')
  if [ -z "$ns" ] || [ -z "$id" ]; then
    echo "[kestra-flow-loader] WARN $f has no namespace/id — skipping"
    continue
  fi

  code=$(curl -s -o /tmp/import.out -w '%{http_code}' \
    -X POST "${KESTRA_API}/flows" \
    -H 'Content-Type: application/x-yaml' \
    --data-binary @"$f" 2>/dev/null || true)

  if [ "$code" = "200" ] || [ "$code" = "201" ]; then
    echo "[kestra-flow-loader] created ${ns}.${id}"
  elif [ "$code" = "409" ] || [ "$code" = "422" ]; then
    if [ "$POLICY" = "seed-only" ]; then
      echo "[kestra-flow-loader] exists ${ns}.${id} — skipping (policy=seed-only)"
    else
      ucode=$(curl -s -o /tmp/import.out -w '%{http_code}' \
        -X PUT "${KESTRA_API}/flows/${ns}/${id}" \
        -H 'Content-Type: application/x-yaml' \
        --data-binary @"$f" 2>/dev/null || true)
      if [ "$ucode" = "200" ] || [ "$ucode" = "201" ]; then
        echo "[kestra-flow-loader] updated ${ns}.${id}"
      else
        echo "[kestra-flow-loader] FAIL ${ns}.${id} create=${code} update=${ucode}"
        head -c 400 /tmp/import.out 2>/dev/null || true; echo
        exit_code=1
      fi
    fi
  else
    echo "[kestra-flow-loader] FAIL ${ns}.${id} HTTP ${code}"
    head -c 400 /tmp/import.out 2>/dev/null || true; echo
    exit_code=1
  fi
done

echo "[kestra-flow-loader] done (exit=${exit_code})"
exit "$exit_code"
