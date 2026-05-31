#!/bin/sh
set -e

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
HURL_DIR="${SCRIPT_DIR}/../hurl"
REPORT_DIR="${SCRIPT_DIR}/../reports"

# Parse flags
USE_L2=false
for arg in "$@"; do
  case "$arg" in
    -l2|--l2) USE_L2=true ;;
  esac
done

mkdir -p "$REPORT_DIR"

echo "============================================="
echo " UMZH Connect Sandbox — Integration Tests"
if [ "$USE_L2" = "true" ]; then
  echo " Auth mode: Level 2 (private_key_jwt)"
else
  echo " Auth mode: Level 1 (client_secret)"
fi
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

FULFILLER_CONTEXT_TOKEN=$("$SCRIPT_DIR/get-token.sh" fulfiller-context ReferralOrthopedicSurgery)
[ -z "$FULFILLER_CONTEXT_TOKEN" ] && echo "  FATAL: could not acquire fulfiller context token" && exit 1
echo "  fulfiller M2M + context   OK"

FULFILLER_CONTEXT_TUMOR_TOKEN=$("$SCRIPT_DIR/get-token.sh" fulfiller-context ReferralTumorboard)
[ -z "$FULFILLER_CONTEXT_TUMOR_TOKEN" ] && echo "  FATAL: could not acquire fulfiller tumorboard context token" && exit 1
echo "  fulfiller M2M + tumor ctx OK"

PLACER_USER_TOKEN=$("$SCRIPT_DIR/get-token.sh" placer-user)
[ -z "$PLACER_USER_TOKEN" ] && echo "  FATAL: could not acquire placer-user token" && exit 1
echo "  placer-user               OK"

FULFILLER_USER_TOKEN=$("$SCRIPT_DIR/get-token.sh" fulfiller-user)
[ -z "$FULFILLER_USER_TOKEN" ] && echo "  FATAL: could not acquire fulfiller-user token" && exit 1
echo "  fulfiller-user            OK"

PLACER_L2_TOKEN=$("$SCRIPT_DIR/get-token.sh" placer-l2)
[ -z "$PLACER_L2_TOKEN" ] && echo "  FATAL: could not acquire placer L2 token" && exit 1
echo "  placer M2M L2             OK"

FULFILLER_L2_TOKEN=$("$SCRIPT_DIR/get-token.sh" fulfiller-l2)
[ -z "$FULFILLER_L2_TOKEN" ] && echo "  FATAL: could not acquire fulfiller L2 token" && exit 1
echo "  fulfiller M2M L2          OK"

FULFILLER_L2_CONTEXT_TOKEN=$("$SCRIPT_DIR/get-token.sh" fulfiller-l2-context ReferralOrthopedicSurgery)
[ -z "$FULFILLER_L2_CONTEXT_TOKEN" ] && echo "  FATAL: could not acquire fulfiller L2 context token" && exit 1
echo "  fulfiller M2M L2+context  OK"

FULFILLER_L2_CONTEXT_TUMOR_TOKEN=$("$SCRIPT_DIR/get-token.sh" fulfiller-l2-context ReferralTumorboard)
[ -z "$FULFILLER_L2_CONTEXT_TUMOR_TOKEN" ] && echo "  FATAL: could not acquire fulfiller L2 tumorboard context token" && exit 1
echo "  fulfiller M2M L2+tumor    OK"

echo "=== All tokens acquired ==="

# Bind effective M2M tokens — L2 tokens shadow L1 when -l2 is passed,
# keeping hurl variable names identical across both modes.
if [ "$USE_L2" = "true" ]; then
  EFFECTIVE_PLACER_TOKEN="$PLACER_L2_TOKEN"
  EFFECTIVE_FULFILLER_TOKEN="$FULFILLER_L2_TOKEN"
  EFFECTIVE_FULFILLER_CONTEXT_TOKEN="$FULFILLER_L2_CONTEXT_TOKEN"
  EFFECTIVE_FULFILLER_CONTEXT_TUMOR_TOKEN="$FULFILLER_L2_CONTEXT_TUMOR_TOKEN"
else
  EFFECTIVE_PLACER_TOKEN="$PLACER_TOKEN"
  EFFECTIVE_FULFILLER_TOKEN="$FULFILLER_TOKEN"
  EFFECTIVE_FULFILLER_CONTEXT_TOKEN="$FULFILLER_CONTEXT_TOKEN"
  EFFECTIVE_FULFILLER_CONTEXT_TUMOR_TOKEN="$FULFILLER_CONTEXT_TUMOR_TOKEN"
fi

# -------------------------------------------------------------------
# Step 3: Build Hurl variable flags
# -------------------------------------------------------------------
# URL variables (internal Docker hostnames or localhost fallbacks)
KEYCLOAK_URL="${KEYCLOAK_URL:-http://localhost:8180}"
APISIX_PLACER_URL="${APISIX_PLACER_URL:-http://localhost:8080}"
APISIX_PLACER_EXT_URL="${APISIX_PLACER_EXT_URL:-http://localhost:8081}"
APISIX_FULFILLER_URL="${APISIX_FULFILLER_URL:-http://localhost:8082}"
APISIX_FULFILLER_EXT_URL="${APISIX_FULFILLER_EXT_URL:-http://localhost:8083}"
HAPI_FHIR_URL="${HAPI_FHIR_URL:-http://localhost:8090}"
REGISTRY_URL="${REGISTRY_URL:-http://localhost:8084}"
OPA_PLACER_URL="${OPA_PLACER_URL:-http://localhost:8181}"
OPA_FULFILLER_URL="${OPA_FULFILLER_URL:-http://localhost:8182}"
RESEED_API_URL="${RESEED_API_URL:-http://localhost:9001}"

# Consent validity window: now + 3 months (tests always refresh end dates)
# Tries GNU date (Linux/CI), then BSD date (macOS), then falls back.
CONSENT_END=$(date -d "+3 months" "+%Y-%m-%d" 2>/dev/null \
  || date -v+3m "+%Y-%m-%d" 2>/dev/null \
  || echo "2030-01-01")

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
        --variable "placer_url=$APISIX_PLACER_URL" \
        --variable "placer_ext_url=$APISIX_PLACER_EXT_URL" \
        --variable "fulfiller_url=$APISIX_FULFILLER_URL" \
        --variable "fulfiller_ext_url=$APISIX_FULFILLER_EXT_URL" \
        --variable "hapi_url=$HAPI_FHIR_URL" \
        --variable "registry_url=$REGISTRY_URL" \
        --variable "opa_placer_url=$OPA_PLACER_URL" \
        --variable "opa_fulfiller_url=$OPA_FULFILLER_URL" \
        --variable "reseed_url=$RESEED_API_URL" \
        --variable "placer_token=$EFFECTIVE_PLACER_TOKEN" \
        --variable "fulfiller_token=$EFFECTIVE_FULFILLER_TOKEN" \
        --variable "fulfiller_context_token=$EFFECTIVE_FULFILLER_CONTEXT_TOKEN" \
        --variable "fulfiller_context_tumorboard_token=$EFFECTIVE_FULFILLER_CONTEXT_TUMOR_TOKEN" \
        --variable "placer_user_token=$PLACER_USER_TOKEN" \
        --variable "fulfiller_user_token=$FULFILLER_USER_TOKEN" \
        --variable "placer_l2_token=$PLACER_L2_TOKEN" \
        --variable "fulfiller_l2_token=$FULFILLER_L2_TOKEN" \
        --variable "fulfiller_l2_context_token=$FULFILLER_L2_CONTEXT_TOKEN" \
        --variable "consent_end=$CONSENT_END" \
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
