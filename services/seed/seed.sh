#!/bin/sh
# =============================================================================
# UMZH Connect Sandbox - FHIR Seed Data Loader
# =============================================================================
# Loads FHIR transaction bundles into HAPI FHIR using URL-based multi-tenancy.
#
# Partition layout:
#   /fhir/DEFAULT   -> Shared conformance resources (Questionnaire, etc.)
#   /fhir/placer    -> HospitalP data (Patient, ServiceRequest, Consent, Organization/placer-*)
#   /fhir/fulfiller -> HospitalF data (Task, Organization/fulfiller-*)
#
# Note: HAPI FHIR treats certain resource types (Questionnaire, StructureDefinition,
# CodeSystem, etc.) as non-partitionable — they can only live in DEFAULT.
# =============================================================================

set -e

FHIR_BASE_URL="${FHIR_BASE_URL:-http://hapi-fhir:8080/fhir}"
PLACER_EXTERNAL_URL="${PLACER_EXTERNAL_URL:-http://localhost:8081}"
FULFILLER_EXTERNAL_URL="${FULFILLER_EXTERNAL_URL:-http://localhost:8083}"
MAX_RETRIES=60
RETRY_INTERVAL=5

echo "============================================="
echo "UMZH Connect Sandbox - Seed Data Loader"
echo "============================================="
echo "FHIR Base URL:         ${FHIR_BASE_URL}"
echo "Placer external URL:   ${PLACER_EXTERNAL_URL}"
echo "Fulfiller external URL:${FULFILLER_EXTERNAL_URL}"

# ---------------------------------------------------------------------------
# [1/6] Wait for HAPI FHIR to be ready
# ---------------------------------------------------------------------------
echo ""
echo "[1/6] Waiting for HAPI FHIR server to be ready..."
retries=0
while [ $retries -lt $MAX_RETRIES ]; do
    # With multi-tenancy enabled, use the DEFAULT partition for the readiness check
    if curl -sf "${FHIR_BASE_URL}/DEFAULT/metadata" > /dev/null 2>&1; then
        echo "  HAPI FHIR is ready!"
        break
    fi
    retries=$((retries + 1))
    echo "  Attempt ${retries}/${MAX_RETRIES} - HAPI FHIR not ready yet, retrying in ${RETRY_INTERVAL}s..."
    sleep $RETRY_INTERVAL
done

if [ $retries -eq $MAX_RETRIES ]; then
    echo "  ERROR: HAPI FHIR did not become ready in time. Exiting."
    exit 1
fi

# ---------------------------------------------------------------------------
# [2/6] Create named partitions
# ---------------------------------------------------------------------------
echo ""
echo "[2/6] Creating FHIR partitions..."

create_partition() {
    PARTITION_ID=$1
    PARTITION_NAME=$2
    PARTITION_DESC=$3

    echo "  Creating partition '${PARTITION_NAME}' (id=${PARTITION_ID})..."
    RESPONSE=$(curl -s -w "\n%{http_code}" -X POST \
        "${FHIR_BASE_URL}/DEFAULT/\$partition-management-create-partition" \
        -H "Content-Type: application/fhir+json" \
        -d "{
          \"resourceType\": \"Parameters\",
          \"parameter\": [
            {\"name\": \"id\",          \"valueInteger\": ${PARTITION_ID}},
            {\"name\": \"name\",        \"valueCode\": \"${PARTITION_NAME}\"},
            {\"name\": \"description\", \"valueString\": \"${PARTITION_DESC}\"}
          ]
        }")

    HTTP_CODE=$(echo "$RESPONSE" | tail -n1)

    BODY=$(echo "$RESPONSE" | sed '$d')
    if [ "$HTTP_CODE" = "200" ] || [ "$HTTP_CODE" = "201" ]; then
        echo "  Partition '${PARTITION_NAME}' created (HTTP ${HTTP_CODE})"
    elif [ "$HTTP_CODE" = "409" ] || ([ "$HTTP_CODE" = "400" ] && echo "$BODY" | grep -q "already defined"); then
        echo "  Partition '${PARTITION_NAME}' already exists — skipping"
    else
        echo "  WARNING: Partition '${PARTITION_NAME}' returned HTTP ${HTTP_CODE}"
        echo "  $(echo "$BODY" | head -c 300)"
    fi
}

create_partition 1 "placer"    "HospitalP (Placer) partition"
create_partition 2 "fulfiller" "HospitalF (Fulfiller) partition"

# ---------------------------------------------------------------------------
# [3/6] Load shared conformance resources -> /fhir/DEFAULT
#        (Questionnaire and other non-partitionable resource types)
# ---------------------------------------------------------------------------
echo ""
echo "[3/6] Loading shared conformance resources into /fhir/DEFAULT..."
RESPONSE=$(curl -s -w "\n%{http_code}" -X POST \
    "${FHIR_BASE_URL}/DEFAULT" \
    -H "Content-Type: application/fhir+json" \
    -d @/seed/bundles/shared-bundle.json)

HTTP_CODE=$(echo "$RESPONSE" | tail -n1)
BODY=$(echo "$RESPONSE" | sed '$d')

if [ "$HTTP_CODE" = "200" ] || [ "$HTTP_CODE" = "201" ]; then
    echo "  Shared resources loaded successfully (HTTP ${HTTP_CODE})"
else
    echo "  WARNING: Shared resources returned HTTP ${HTTP_CODE}"
    echo "  $(echo "$BODY" | head -c 500)"
fi

# ---------------------------------------------------------------------------
# [4/6] Load Placer data -> /fhir/placer
# ---------------------------------------------------------------------------
echo ""
echo "[4/6] Loading Placer (HospitalP) seed data into /fhir/placer..."
sed \
    -e "s|__PLACER_EXTERNAL_URL__|${PLACER_EXTERNAL_URL}|g" \
    -e "s|__FULFILLER_EXTERNAL_URL__|${FULFILLER_EXTERNAL_URL}|g" \
    /seed/bundles/placer-bundle.json > /tmp/placer-bundle-resolved.json
RESPONSE=$(curl -s -w "\n%{http_code}" -X POST \
    "${FHIR_BASE_URL}/placer" \
    -H "Content-Type: application/fhir+json" \
    -d @/tmp/placer-bundle-resolved.json)

HTTP_CODE=$(echo "$RESPONSE" | tail -n1)
BODY=$(echo "$RESPONSE" | sed '$d')

if [ "$HTTP_CODE" = "200" ] || [ "$HTTP_CODE" = "201" ]; then
    echo "  Placer data loaded successfully (HTTP ${HTTP_CODE})"
else
    echo "  WARNING: Placer data returned HTTP ${HTTP_CODE}"
    echo "  $(echo "$BODY" | head -c 500)"
fi

# ---------------------------------------------------------------------------
# [5/6] Load Fulfiller data -> /fhir/fulfiller
# ---------------------------------------------------------------------------
echo ""
echo "[5/6] Loading Fulfiller (HospitalF) seed data into /fhir/fulfiller..."
sed \
    -e "s|__PLACER_EXTERNAL_URL__|${PLACER_EXTERNAL_URL}|g" \
    -e "s|__FULFILLER_EXTERNAL_URL__|${FULFILLER_EXTERNAL_URL}|g" \
    /seed/bundles/fulfiller-bundle.json > /tmp/fulfiller-bundle-resolved.json
RESPONSE=$(curl -s -w "\n%{http_code}" -X POST \
    "${FHIR_BASE_URL}/fulfiller" \
    -H "Content-Type: application/fhir+json" \
    -d @/tmp/fulfiller-bundle-resolved.json)

HTTP_CODE=$(echo "$RESPONSE" | tail -n1)
BODY=$(echo "$RESPONSE" | sed '$d')

if [ "$HTTP_CODE" = "200" ] || [ "$HTTP_CODE" = "201" ]; then
    echo "  Fulfiller data loaded successfully (HTTP ${HTTP_CODE})"
else
    echo "  WARNING: Fulfiller data returned HTTP ${HTTP_CODE}"
    echo "  $(echo "$BODY" | head -c 500)"
fi

# ---------------------------------------------------------------------------
# [6/6] Verify seed data in each partition
# ---------------------------------------------------------------------------
echo ""
echo "[6/6] Verifying seed data..."

check_resource() {
    PARTITION=$1
    RESOURCE_TYPE=$2
    RESOURCE_ID=$3

    if curl -sf "${FHIR_BASE_URL}/${PARTITION}/${RESOURCE_TYPE}/${RESOURCE_ID}" > /dev/null 2>&1; then
        printf "  [%-10s] %-45s OK\n" "${PARTITION}" "${RESOURCE_TYPE}/${RESOURCE_ID}"
    else
        printf "  [%-10s] %-45s MISSING\n" "${PARTITION}" "${RESOURCE_TYPE}/${RESOURCE_ID}"
    fi
}

# DEFAULT partition (shared conformance resources)
check_resource "DEFAULT"   "Questionnaire"  "QuestionnaireSmokingStatus"

# Placer partition
check_resource "placer"    "Patient"        "PetraMeier"
check_resource "placer"    "ServiceRequest" "ReferralOrthopedicSurgery"
check_resource "placer"    "ServiceRequest" "ReferralTumorboard"
check_resource "placer"    "Consent"        "ConsentOrthopedicReferral"

# Fulfiller partition
check_resource "fulfiller" "Organization"   "fulfiller-HospitalP"
check_resource "fulfiller" "Organization"   "fulfiller-HospitalF"
check_resource "fulfiller" "Task"           "TaskOrthopedicReferral"

# Organizations — both partitions carry both orgs (partition-prefixed IDs)
check_resource "placer"    "Organization"   "placer-HospitalP"
check_resource "placer"    "Organization"   "placer-HospitalF"

echo ""
echo "============================================="
echo "Seed data loading complete!"
echo "============================================="
echo ""
echo "Partition layout:"
echo "  /fhir/DEFAULT   -> Shared conformance (Questionnaire, ...)"
echo "  /fhir/placer    -> HospitalP data (Patient, ServiceRequest, Consent, Organization/placer-*)"
echo "  /fhir/fulfiller -> HospitalF data (Task, Organization/fulfiller-*)"
echo ""
echo "Sandbox endpoints:"
echo "  HAPI FHIR:                    http://localhost:8090/fhir"
echo "  Keycloak:                     http://localhost:8180"
echo "  KrakenD Placer internal:      http://localhost:8080"
echo "  KrakenD Placer external:      ${PLACER_EXTERNAL_URL}"
echo "  KrakenD Fulfiller internal:   http://localhost:8082"
echo "  KrakenD Fulfiller external:   ${FULFILLER_EXTERNAL_URL}"
echo "  OPA (Placer):                 http://localhost:8181"
echo "  OPA (Fulfiller):              http://localhost:8182"
echo "  Web App:                      http://localhost:3000"
echo ""
echo "Default users:"
echo "  Placer:     placer-user / placer123"
echo "  Fulfiller:  fulfiller-user / fulfiller123"
echo "  Admin:      admin-user / admin123"
echo ""
