#!/bin/sh
set -e

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
HURL_DIR="${SCRIPT_DIR}/../hurl"
REPORT_DIR="${SCRIPT_DIR}/../reports"

mkdir -p "$REPORT_DIR"

echo "============================================="
echo " UMZH Connect Sandbox — Integration Tests"
echo "============================================="

# -------------------------------------------------------------------
# Step 1: Wait for all services to be reachable
# -------------------------------------------------------------------
"$SCRIPT_DIR/wait-for-services.sh"

# -------------------------------------------------------------------
# Step 2: Acquire tokens
# -------------------------------------------------------------------
echo ""
echo "=== Acquiring tokens ==="

PLACER_TOKEN=$("$SCRIPT_DIR/get-token.sh" placer)
[ -z "$PLACER_TOKEN" ] && echo "  FATAL: could not acquire placer token" && exit 1
echo "  placer M2M                OK"

FULFILLER_TOKEN=$("$SCRIPT_DIR/get-token.sh" fulfiller)
[ -z "$FULFILLER_TOKEN" ] && echo "  FATAL: could not acquire fulfiller token" && exit 1
echo "  fulfiller M2M             OK"

FULFILLER_CONSENT_TOKEN=$("$SCRIPT_DIR/get-token.sh" fulfiller ConsentOrthopedicReferral)
[ -z "$FULFILLER_CONSENT_TOKEN" ] && echo "  FATAL: could not acquire fulfiller consent token" && exit 1
echo "  fulfiller M2M + consent   OK"

PLACER_USER_TOKEN=$("$SCRIPT_DIR/get-token.sh" placer-user)
[ -z "$PLACER_USER_TOKEN" ] && echo "  FATAL: could not acquire placer-user token" && exit 1
echo "  placer-user               OK"

FULFILLER_USER_TOKEN=$("$SCRIPT_DIR/get-token.sh" fulfiller-user)
[ -z "$FULFILLER_USER_TOKEN" ] && echo "  FATAL: could not acquire fulfiller-user token" && exit 1
echo "  fulfiller-user            OK"

echo "=== All tokens acquired ==="

# -------------------------------------------------------------------
# Step 3: Build Hurl variable flags
# -------------------------------------------------------------------
# URL variables (internal Docker hostnames or localhost fallbacks)
KEYCLOAK_URL="${KEYCLOAK_URL:-http://localhost:8180}"
KRAKEND_PLACER_URL="${KRAKEND_PLACER_URL:-http://localhost:8080}"
KRAKEND_PLACER_EXT_URL="${KRAKEND_PLACER_EXT_URL:-http://localhost:8081}"
KRAKEND_FULFILLER_URL="${KRAKEND_FULFILLER_URL:-http://localhost:8082}"
KRAKEND_FULFILLER_EXT_URL="${KRAKEND_FULFILLER_EXT_URL:-http://localhost:8083}"
HAPI_FHIR_URL="${HAPI_FHIR_URL:-http://localhost:8090}"
OPA_PLACER_URL="${OPA_PLACER_URL:-http://localhost:8181}"
OPA_FULFILLER_URL="${OPA_FULFILLER_URL:-http://localhost:8182}"
RESEED_API_URL="${RESEED_API_URL:-http://localhost:9001}"

# -------------------------------------------------------------------
# Step 4: Run each Hurl file in sequence
# -------------------------------------------------------------------
echo ""
TOTAL=0
PASSED=0
FAILED=0
FAILED_NAMES=""

for hurl_file in "$HURL_DIR"/[0-9]*.hurl; do
    [ ! -f "$hurl_file" ] && continue
    test_name=$(basename "$hurl_file" .hurl)
    TOTAL=$((TOTAL + 1))

    echo "--- Running: $test_name ---"
    if hurl --test --color \
        --variable "keycloak_url=$KEYCLOAK_URL" \
        --variable "placer_url=$KRAKEND_PLACER_URL" \
        --variable "placer_ext_url=$KRAKEND_PLACER_EXT_URL" \
        --variable "fulfiller_url=$KRAKEND_FULFILLER_URL" \
        --variable "fulfiller_ext_url=$KRAKEND_FULFILLER_EXT_URL" \
        --variable "hapi_url=$HAPI_FHIR_URL" \
        --variable "opa_placer_url=$OPA_PLACER_URL" \
        --variable "opa_fulfiller_url=$OPA_FULFILLER_URL" \
        --variable "reseed_url=$RESEED_API_URL" \
        --variable "placer_token=$PLACER_TOKEN" \
        --variable "fulfiller_token=$FULFILLER_TOKEN" \
        --variable "fulfiller_consent_token=$FULFILLER_CONSENT_TOKEN" \
        --variable "placer_user_token=$PLACER_USER_TOKEN" \
        --variable "fulfiller_user_token=$FULFILLER_USER_TOKEN" \
        --report-junit "$REPORT_DIR/${test_name}.xml" \
        "$hurl_file"; then
        PASSED=$((PASSED + 1))
    else
        FAILED=$((FAILED + 1))
        FAILED_NAMES="$FAILED_NAMES $test_name"
    fi
    echo ""
done

# -------------------------------------------------------------------
# Step 5: Summary
# -------------------------------------------------------------------
echo "============================================="
echo " Results: $PASSED/$TOTAL passed, $FAILED failed"
if [ "$FAILED" -gt 0 ]; then
    echo " Failed:$FAILED_NAMES"
fi
echo "============================================="

[ "$FAILED" -eq 0 ] || exit 1
