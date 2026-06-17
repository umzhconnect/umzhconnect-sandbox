#!/bin/sh
# =============================================================================
# seed-party — one-shot: create this party's FHIR partition and load its own
# seed bundle. Cross-partition references in the bundle are resolved to this
# deployment's URLs (own external, partner external, shared registry).
#
# Bundles ship for PARTY ∈ {placer, fulfiller} (mounted from
# ../services/seed/bundles). A brand-new party supplies its own bundle at the
# same path; if none exists this step is a no-op (partition is still created).
# =============================================================================
set -eu

FHIR_BASE="${FHIR_BASE:-http://hapi-fhir:8080/fhir}"
BUNDLE="/bundles/${PARTY}-bundle.json"
MAX_RETRIES=60
RETRY_INTERVAL=5

echo "[seed-party] PARTY=${PARTY}  FHIR_BASE=${FHIR_BASE}"

# ── Wait for HAPI ────────────────────────────────────────────────────────────
i=0
while [ "$i" -lt "$MAX_RETRIES" ]; do
  if curl -sf "${FHIR_BASE}/DEFAULT/metadata" > /dev/null 2>&1; then
    echo "[seed-party] HAPI ready"; break
  fi
  i=$((i + 1)); echo "[seed-party] waiting for HAPI ($i/$MAX_RETRIES)…"; sleep "$RETRY_INTERVAL"
done
[ "$i" -lt "$MAX_RETRIES" ] || { echo "[seed-party] HAPI not ready"; exit 1; }

# ── Create the party partition (idempotent) ──────────────────────────────────
echo "[seed-party] creating partition '${PARTY}'…"
curl -s -o /dev/null -w "  partition HTTP %{http_code}\n" -X POST \
  "${FHIR_BASE}/DEFAULT/\$partition-management-create-partition" \
  -H "Content-Type: application/fhir+json" \
  -d "{\"resourceType\":\"Parameters\",\"parameter\":[
        {\"name\":\"id\",\"valueInteger\":1},
        {\"name\":\"name\",\"valueCode\":\"${PARTY}\"},
        {\"name\":\"description\",\"valueString\":\"${PARTY} partition\"}]}" || true

# ── Load the party's own bundle ──────────────────────────────────────────────
if [ ! -f "$BUNDLE" ]; then
  echo "[seed-party] no bundle at ${BUNDLE} — partition created, nothing to load."
  exit 0
fi

# Map the bundle's own/partner placeholders to this deployment's URLs.
case "$PARTY" in
  placer)    OWN_PH="__PLACER_EXTERNAL_URL__";    PARTNER_PH="__FULFILLER_EXTERNAL_URL__" ;;
  fulfiller) OWN_PH="__FULFILLER_EXTERNAL_URL__"; PARTNER_PH="__PLACER_EXTERNAL_URL__" ;;
  *)         OWN_PH="__OWN_EXTERNAL_URL__";        PARTNER_PH="__PARTNER_EXTERNAL_URL__" ;;
esac

echo "[seed-party] loading ${BUNDLE} into /${PARTY}…"
sed -e "s|${OWN_PH}|${OWN_EXTERNAL_URL}|g" \
    -e "s|${PARTNER_PH}|${PARTNER_EXTERNAL_URL}|g" \
    -e "s|__REGISTRY_URL__|${REGISTRY_URL}|g" \
    "$BUNDLE" > /tmp/bundle-resolved.json

curl -s -o /dev/null -w "  bundle HTTP %{http_code}\n" -X POST \
  "${FHIR_BASE}/${PARTY}" \
  -H "Content-Type: application/fhir+json" \
  -d @/tmp/bundle-resolved.json

echo "[seed-party] done."
