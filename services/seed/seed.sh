#!/bin/sh
# =============================================================================
# UMZH Connect Sandbox - FHIR Seed Data Loader
# =============================================================================
# Loads FHIR transaction bundles into HAPI FHIR using URL-based multi-tenancy.
#
# Partition layout:
#   /fhir/DEFAULT   -> Shared conformance resources (Questionnaire, etc.)
#   /fhir/placer    -> HospitalP data (Patient, ServiceRequest, Consent)
#   /fhir/fulfiller -> HospitalF data (Task)
#   /fhir/registry  -> Organization directory (HospitalP, HospitalF)
#
# Note: HAPI FHIR treats certain resource types (Questionnaire, StructureDefinition,
# CodeSystem, etc.) as non-partitionable — they can only live in DEFAULT.
# =============================================================================

set -e

FHIR_BASE_URL="${FHIR_BASE_URL:-http://hapi-fhir:8080/fhir}"
PLACER_EXTERNAL_URL="${PLACER_EXTERNAL_URL:-http://localhost:8081}"
FULFILLER_EXTERNAL_URL="${FULFILLER_EXTERNAL_URL:-http://localhost:8083}"
REGISTRY_EXTERNAL_URL="${REGISTRY_EXTERNAL_URL:-http://localhost:8084}"
MAX_RETRIES=60
RETRY_INTERVAL=5

echo "============================================="
echo "UMZH Connect Sandbox - Seed Data Loader"
echo "============================================="
echo "FHIR Base URL:         ${FHIR_BASE_URL}"
echo "Placer external URL:   ${PLACER_EXTERNAL_URL}"
echo "Fulfiller external URL:${FULFILLER_EXTERNAL_URL}"

# ---------------------------------------------------------------------------
# [1/8] Wait for HAPI FHIR to be ready
# ---------------------------------------------------------------------------
echo ""
echo "[1/8] Waiting for HAPI FHIR server to be ready..."
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
# [2/8] Create named partitions
# ---------------------------------------------------------------------------
echo ""
echo "[2/8] Creating FHIR partitions..."

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
create_partition 3 "registry"  "Organization registry partition"

# ---------------------------------------------------------------------------
# [3/8] Load shared conformance resources -> /fhir/DEFAULT
#        (Questionnaire and other non-partitionable resource types)
# ---------------------------------------------------------------------------
echo ""
echo "[3/8] Loading shared conformance resources into /fhir/DEFAULT..."
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
# [4/8] Load Placer data -> /fhir/placer
# ---------------------------------------------------------------------------
echo ""
echo "[4/8] Loading Placer (HospitalP) seed data into /fhir/placer..."
sed \
    -e "s|__PLACER_EXTERNAL_URL__|${PLACER_EXTERNAL_URL}|g" \
    -e "s|__FULFILLER_EXTERNAL_URL__|${FULFILLER_EXTERNAL_URL}|g" \
    -e "s|__REGISTRY_URL__|${REGISTRY_EXTERNAL_URL}|g" \
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
# [5/8] Load Fulfiller data -> /fhir/fulfiller
# ---------------------------------------------------------------------------
echo ""
echo "[5/8] Loading Fulfiller (HospitalF) seed data into /fhir/fulfiller..."
sed \
    -e "s|__PLACER_EXTERNAL_URL__|${PLACER_EXTERNAL_URL}|g" \
    -e "s|__FULFILLER_EXTERNAL_URL__|${FULFILLER_EXTERNAL_URL}|g" \
    -e "s|__REGISTRY_URL__|${REGISTRY_EXTERNAL_URL}|g" \
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
# [6/8] Load Registry data -> /fhir/registry
# ---------------------------------------------------------------------------
echo ""
echo "[6/8] Loading Registry (Organization directory) seed data into /fhir/registry..."
sed \
    -e "s|__PLACER_EXTERNAL_URL__|${PLACER_EXTERNAL_URL}|g" \
    -e "s|__FULFILLER_EXTERNAL_URL__|${FULFILLER_EXTERNAL_URL}|g" \
    -e "s|__REGISTRY_URL__|${REGISTRY_EXTERNAL_URL}|g" \
    /seed/bundles/registry-bundle.json > /tmp/registry-bundle-resolved.json
RESPONSE=$(curl -s -w "\n%{http_code}" -X POST \
    "${FHIR_BASE_URL}/registry" \
    -H "Content-Type: application/fhir+json" \
    -d @/tmp/registry-bundle-resolved.json)

HTTP_CODE=$(echo "$RESPONSE" | tail -n1)
BODY=$(echo "$RESPONSE" | sed '$d')

if [ "$HTTP_CODE" = "200" ] || [ "$HTTP_CODE" = "201" ]; then
    echo "  Registry data loaded successfully (HTTP ${HTTP_CODE})"
else
    echo "  WARNING: Registry data returned HTTP ${HTTP_CODE}"
    echo "  $(echo "$BODY" | head -c 500)"
fi

# ---------------------------------------------------------------------------
# [7/8] Verify seed data in each partition
# ---------------------------------------------------------------------------
echo ""
echo "[7/8] Verifying seed data..."

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
check_resource "fulfiller" "Task"           "TaskOrthopedicReferral"

# Registry partition (Organization directory)
check_resource "registry"  "Organization"   "HospitalP"
check_resource "registry"  "Organization"   "HospitalF"
check_resource "registry"  "Endpoint"       "EndpointHospitalP"
check_resource "registry"  "Endpoint"       "EndpointHospitalF"

echo ""
echo "============================================="
echo "Seed data loading complete!"
echo "============================================="

# ---------------------------------------------------------------------------
# [8/8] Generate L2 key pairs and register certificates with Keycloak
# ---------------------------------------------------------------------------
echo ""
echo "[8/8] Provisioning L2 key pairs..."

KEYCLOAK_URL="${KEYCLOAK_URL:-http://keycloak:8080}"
KEYCLOAK_ADMIN="${KEYCLOAK_ADMIN:-admin}"
KEYCLOAK_ADMIN_PASSWORD="${KEYCLOAK_ADMIN_PASSWORD:-admin}"
KEYCLOAK_REALM="${KEYCLOAK_REALM:-umzh-connect}"
PLACER_L2_CLIENT_ID="${PLACER_L2_CLIENT_ID:-placer-client-l2}"
FULFILLER_L2_CLIENT_ID="${FULFILLER_L2_CLIENT_ID:-fulfiller-client-l2}"
L2_KEY_DIR="${L2_KEY_DIR:-/l2-keys}"

mkdir -p "$L2_KEY_DIR"
chmod 755 "$L2_KEY_DIR"

# Get a short-lived admin token from the master realm.
ADMIN_TOKEN=$(curl -sf -X POST \
    "${KEYCLOAK_URL}/realms/master/protocol/openid-connect/token" \
    -H "Content-Type: application/x-www-form-urlencoded" \
    -d "grant_type=password&client_id=admin-cli&username=${KEYCLOAK_ADMIN}&password=${KEYCLOAK_ADMIN_PASSWORD}" \
    | sed 's/.*"access_token":"\([^"]*\)".*/\1/')

if [ -z "$ADMIN_TOKEN" ]; then
    echo "  ERROR: Could not acquire Keycloak admin token. Exiting."
    exit 1
fi
echo "  Admin token acquired"

# Generate RSA-2048 key pair, self-signed certificate, and register with Keycloak.
# Idempotent: if the private key already exists the client was already provisioned.
register_l2_client() {
    CLIENT_ID_L2="$1"
    KEY_NAME="$2"

    KEY_FILE="${L2_KEY_DIR}/${KEY_NAME}.key"
    CERT_FILE="${L2_KEY_DIR}/${KEY_NAME}.crt"

    if [ -f "$KEY_FILE" ]; then
        echo "  ${CLIENT_ID_L2}: key already exists — skipping"
        return 0
    fi

    echo "  ${CLIENT_ID_L2}: generating RSA-2048 key pair..."
    openssl genrsa -out "$KEY_FILE" 2048 2>/dev/null
    chmod 644 "$KEY_FILE"
    openssl req -new -x509 \
        -key "$KEY_FILE" \
        -out "$CERT_FILE" \
        -days 3650 \
        -subj "/CN=${CLIENT_ID_L2}" 2>/dev/null

    # Resolve client UUID.
    # Anchor the pattern to the start of the array so the greedy .* in sed
    # does not overshoot to a nested protocolMapper "id" field.
    UUID=$(curl -sf \
        -H "Authorization: Bearer ${ADMIN_TOKEN}" \
        "${KEYCLOAK_URL}/admin/realms/${KEYCLOAK_REALM}/clients?clientId=${CLIENT_ID_L2}" \
        | sed 's/^\[{"id":"\([^"]*\)".*/\1/')

    # Validate it looks like a UUID (contains hyphens, not the raw JSON).
    case "$UUID" in
        *-*-*-*-*)
            ;; # ok
        *)
            echo "  WARNING: ${CLIENT_ID_L2} not found in Keycloak (UUID='${UUID}')"
            echo "  If this is a fresh install, run: docker compose down -v && docker compose up -d --build"
            return 1
            ;;
    esac

    # Upload the self-signed certificate so Keycloak can verify client assertions.
    HTTP_CODE=$(curl -s -o /dev/null -w "%{http_code}" -X POST \
        -H "Authorization: Bearer ${ADMIN_TOKEN}" \
        -F "keystoreFormat=Certificate PEM" \
        -F "file=@${CERT_FILE}" \
        "${KEYCLOAK_URL}/admin/realms/${KEYCLOAK_REALM}/clients/${UUID}/certificates/jwt.credential/upload-certificate")

    if [ "$HTTP_CODE" = "200" ] || [ "$HTTP_CODE" = "201" ]; then
        echo "  ${CLIENT_ID_L2}: certificate registered (HTTP ${HTTP_CODE})"
    else
        echo "  WARNING: certificate upload for ${CLIENT_ID_L2} returned HTTP ${HTTP_CODE}"
    fi
}

register_l2_client "${PLACER_L2_CLIENT_ID}"    "placer-l2"
register_l2_client "${FULFILLER_L2_CLIENT_ID}" "fulfiller-l2"

echo ""
echo "============================================="
echo "Seed data loading and L2 key provisioning complete!"
echo "============================================="
echo ""
echo "Partition layout:"
echo "  /fhir/DEFAULT   -> Shared conformance (Questionnaire, ...)"
echo "  /fhir/placer    -> HospitalP data (Patient, ServiceRequest, Consent)"
echo "  /fhir/fulfiller -> HospitalF data (Task)"
echo "  /fhir/registry  -> Organization directory (HospitalP, HospitalF)"
echo ""
echo "Sandbox endpoints:"
echo "  HAPI FHIR:                    http://localhost:8090/fhir"
echo "  Keycloak:                     http://localhost:8180"
echo "  APISIX Placer internal:       http://localhost:8080"
echo "  APISIX Placer external:       ${PLACER_EXTERNAL_URL}"
echo "  APISIX Fulfiller internal:   http://localhost:8082"
echo "  APISIX Fulfiller external:   ${FULFILLER_EXTERNAL_URL}"
echo "  OPA (Placer):                 http://localhost:8181"
echo "  OPA (Fulfiller):              http://localhost:8182"
echo "  Web App:                      http://localhost:3000"
echo ""
echo "Default users:"
echo "  Placer:     placer-user / placer123"
echo "  Fulfiller:  fulfiller-user / fulfiller123"
echo "  Admin:      admin-user / admin123"
echo ""
