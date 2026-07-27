#!/bin/sh
# =============================================================================
# seed-registry — one-shot owned by the registry service: create the 'registry'
# partition on the base HAPI, PURGE its current content, then load the mCSD
# directory from registry-bundle.json (Organizations / Endpoints /
# HealthcareServices).
#
# Bootstrap-phase reconciliation: the registry is treated as fully declarative —
# every run wipes what's there and reloads from git, so entries removed from the
# bundle also disappear from the server (which a plain PUT/upsert can't do).
#
# The wipe is a single FHIR *transaction* of conditional deletes. Because a
# transaction resolves references against its final state, HAPI deletes the
# mutually-referencing mCSD resources (Organization<->Endpoint) atomically with
# referential integrity left ON — no server config change, and no jq needed.
#
# Shared by docker compose (mounts this file + the bundle) and Kubernetes (the
# registry-seed Job runs the same files from a generated ConfigMap).
# =============================================================================
set -eu

FHIR_BASE="${FHIR_BASE:-http://hapi-fhir:8080/fhir}"
PARTITION="${PARTITION:-registry}"
PARTITION_ID="${PARTITION_ID:-2}"
REGISTRY_BUNDLE="${REGISTRY_BUNDLE:-/seed/registry-bundle.json}"
MAX_RETRIES=60
RETRY_INTERVAL=5

echo "[registry-seed] FHIR_BASE=${FHIR_BASE}"

# ── Wait for HAPI ────────────────────────────────────────────────────────────
i=0
while [ "$i" -lt "$MAX_RETRIES" ]; do
  if curl -sf "${FHIR_BASE}/DEFAULT/metadata" > /dev/null 2>&1; then
    echo "[registry-seed] HAPI ready"; break
  fi
  i=$((i + 1)); echo "[registry-seed] waiting for HAPI ($i/$MAX_RETRIES)…"; sleep "$RETRY_INTERVAL"
done
[ "$i" -lt "$MAX_RETRIES" ] || { echo "[registry-seed] HAPI not ready"; exit 1; }

# ── Create the registry partition (idempotent) ───────────────────────────────
echo "[registry-seed] creating partition '${PARTITION}' (id=${PARTITION_ID})…"
_code=$(curl -s -o /tmp/part.json -w "%{http_code}" -X POST \
  "${FHIR_BASE}/DEFAULT/\$partition-management-create-partition" \
  -H "Content-Type: application/fhir+json" \
  -d "{\"resourceType\":\"Parameters\",\"parameter\":[
        {\"name\":\"id\",\"valueInteger\":${PARTITION_ID}},
        {\"name\":\"name\",\"valueCode\":\"${PARTITION}\"},
        {\"name\":\"description\",\"valueString\":\"mCSD Organization/Endpoint/HealthcareService directory\"}]}")
if [ "$_code" = "200" ] || [ "$_code" = "201" ]; then
  echo "  partition created (HTTP ${_code})"
elif [ "$_code" = "409" ] || { [ "$_code" = "400" ] && grep -q "already defined" /tmp/part.json; }; then
  echo "  partition already exists — skipping"
else
  echo "  WARNING: partition returned HTTP ${_code}: $(head -c 200 /tmp/part.json)"
fi

# ── Purge current registry content ───────────────────────────────────────────
# One transaction of conditional deletes across the mCSD directory types. The
# _lastUpdated criterion matches every stored resource; on an empty partition it
# is a harmless no-op. (Extend the type list if the bundle grows, e.g. Location,
# PractitionerRole.) Requires allow_multiple_delete (set in application.yaml).
echo "[registry-seed] purging existing registry content…"
curl -s -o /dev/null -w "  purge transaction HTTP %{http_code}\n" -X POST \
  "${FHIR_BASE}/${PARTITION}" \
  -H "Content-Type: application/fhir+json" \
  -d '{"resourceType":"Bundle","type":"transaction","entry":[
        {"request":{"method":"DELETE","url":"HealthcareService?_lastUpdated=gt1900-01-01"}},
        {"request":{"method":"DELETE","url":"Endpoint?_lastUpdated=gt1900-01-01"}},
        {"request":{"method":"DELETE","url":"Organization?_lastUpdated=gt1900-01-01"}}]}'

# ── Load the registry bundle ─────────────────────────────────────────────────
# The only placeholder in the bundle is __REGISTRY_URL__ (the registry's own base,
# used for internal Organization/Endpoint/HealthcareService cross-references).
# Endpoint addresses are hardcoded to the partners' real FHIR APIs.
echo "[registry-seed] loading registry bundle into /${PARTITION}…"
sed -e "s|__REGISTRY_URL__|${REGISTRY_URL}|g" \
    "$REGISTRY_BUNDLE" > /tmp/registry-resolved.json

curl -s -o /dev/null -w "  registry bundle HTTP %{http_code}\n" -X POST \
  "${FHIR_BASE}/${PARTITION}" \
  -H "Content-Type: application/fhir+json" \
  -d @/tmp/registry-resolved.json

echo "[registry-seed] done."
