#!/usr/bin/env bash
# =============================================================================
# UMZH-Connect COW Sandbox — End-to-End Test Script
# =============================================================================
set -euo pipefail

BACKEND_URL="${BACKEND_URL:-http://localhost:8000}"
KC_URL="${KC_URL:-http://localhost:8180}"
HAPI_URL="${HAPI_URL:-http://localhost:8282}"
REALM="${REALM:-umzh-sandbox}"
PLACER_CLIENT="${PLACER_CLIENT:-placer-client}"
PLACER_SECRET="${PLACER_SECRET:-placer-secret-change-me}"
FULFILLER_CLIENT="${FULFILLER_CLIENT:-fulfiller-client}"
FULFILLER_SECRET="${FULFILLER_SECRET:-fulfiller-secret-change-me}"

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

PASS=0
FAIL=0

pass() { echo -e "${GREEN}PASS${NC} $1"; ((PASS++)) || true; }
fail() { echo -e "${RED}FAIL${NC} $1"; ((FAIL++)) || true; }
info() { echo -e "${YELLOW}----${NC} $1"; }

echo ""
echo "============================================"
echo " UMZH-Connect COW Sandbox — E2E Test"
echo "============================================"
echo ""

# ── 1. Backend health ─────────────────────────────────────────────────────────
info "1. Backend health check"
STATUS=$(curl -sf -o /dev/null -w "%{http_code}" "${BACKEND_URL}/health" || echo "000")
[ "$STATUS" = "200" ] && pass "Backend /health → 200" || fail "Backend /health → $STATUS"

# ── 2. Keycloak OIDC discovery ────────────────────────────────────────────────
info "2. Keycloak OIDC discovery"
STATUS=$(curl -sf -o /dev/null -w "%{http_code}" "${KC_URL}/realms/${REALM}/.well-known/openid-configuration" || echo "000")
[ "$STATUS" = "200" ] && pass "Keycloak OIDC discovery → 200" || fail "Keycloak OIDC → $STATUS"

# ── 3. Token acquisition ──────────────────────────────────────────────────────
info "3. Token acquisition (client credentials)"

TOKEN_A=$(curl -sf -X POST \
  "${KC_URL}/realms/${REALM}/protocol/openid-connect/token" \
  -d "grant_type=client_credentials&client_id=${PLACER_CLIENT}&client_secret=${PLACER_SECRET}" \
  | python3 -c "import sys,json; print(json.load(sys.stdin)['access_token'])" 2>/dev/null || echo "")

[ -n "$TOKEN_A" ] && pass "partyA token acquired" || fail "partyA token acquisition failed"

TOKEN_B=$(curl -sf -X POST \
  "${KC_URL}/realms/${REALM}/protocol/openid-connect/token" \
  -d "grant_type=client_credentials&client_id=${FULFILLER_CLIENT}&client_secret=${FULFILLER_SECRET}" \
  | python3 -c "import sys,json; print(json.load(sys.stdin)['access_token'])" 2>/dev/null || echo "")

[ -n "$TOKEN_B" ] && pass "partyB token acquired" || fail "partyB token acquisition failed"

# ── 4. HAPI FHIR metadata ─────────────────────────────────────────────────────
info "4. HAPI FHIR metadata"
STATUS=$(curl -sf -o /dev/null -w "%{http_code}" "${HAPI_URL}/fhir/metadata" || echo "000")
[ "$STATUS" = "200" ] && pass "HAPI FHIR /fhir/metadata → 200" || fail "HAPI FHIR metadata → $STATUS"

# ── 5. Trust bundle ───────────────────────────────────────────────────────────
info "5. Trust bundle"
BUNDLE=$(curl -sf "${BACKEND_URL}/trust-bundle" | python3 -c "import sys,json; d=json.load(sys.stdin); print(len(d['parties']))" 2>/dev/null || echo "0")
[ "$BUNDLE" = "2" ] && pass "Trust bundle has 2 parties" || fail "Trust bundle: unexpected parties=$BUNDLE"

# ── 6. Seed + COW workflow ────────────────────────────────────────────────────
info "6. Onboarding status"
SEEDED=$(curl -sf "${BACKEND_URL}/onboarding/status" | python3 -c "import sys,json; print(json.load(sys.stdin).get('seeded','false'))" 2>/dev/null || echo "false")
echo "  Seeded: $SEEDED"

if [ "$SEEDED" != "True" ] && [ "$SEEDED" != "true" ]; then
  info "  Running seed..."
  curl -sf -X POST "${BACKEND_URL}/onboarding/register" \
    -H "Content-Type: application/json" \
    -d '{"user_email":"e2e@test.local"}' > /dev/null && pass "Seed completed" || fail "Seed failed"
else
  pass "Already seeded"
fi

# ── 7. List patients from partyA ──────────────────────────────────────────────
info "7. List patients (partyA)"
PATIENT_COUNT=$(curl -sf "${BACKEND_URL}/fhir/partyA/Patient" \
  | python3 -c "import sys,json; d=json.load(sys.stdin); print(d.get('result',{}).get('total',0))" 2>/dev/null || echo "0")
[ "$PATIENT_COUNT" -gt "0" ] 2>/dev/null && pass "partyA has $PATIENT_COUNT patient(s)" || fail "partyA patients: $PATIENT_COUNT"

# ── 8. Create ServiceRequest ──────────────────────────────────────────────────
info "8. Create ServiceRequest"
SR_RESULT=$(curl -sf -X POST "${BACKEND_URL}/workflow/service-request" \
  -H "Content-Type: application/json" \
  -d '{"patient_id":"test-patient","requester_practitioner_id":"test-pract","performer_organization_id":"test-org"}' 2>/dev/null || echo "{}")
SR_ID=$(echo "$SR_RESULT" | python3 -c "import sys,json; print(json.load(sys.stdin).get('result',{}).get('id',''))" 2>/dev/null || echo "")
[ -n "$SR_ID" ] && pass "ServiceRequest created: $SR_ID" || fail "ServiceRequest creation failed"

# ── 9. Create Consent ─────────────────────────────────────────────────────────
info "9. Create Consent"
CONSENT_RESULT=$(curl -sf -X POST "${BACKEND_URL}/workflow/consent" \
  -H "Content-Type: application/json" \
  -d "{\"patient_id\":\"test-patient\",\"service_request_id\":\"${SR_ID:-sr-test}\",\"performer_organization_id\":\"org-b\"}" 2>/dev/null || echo "{}")
CONSENT_ID=$(echo "$CONSENT_RESULT" | python3 -c "import sys,json; print(json.load(sys.stdin).get('result',{}).get('id',''))" 2>/dev/null || echo "")
[ -n "$CONSENT_ID" ] && pass "Consent created: $CONSENT_ID" || fail "Consent creation failed"

# ── 10. Create Task ───────────────────────────────────────────────────────────
info "10. Create Task at partyB"
TASK_RESULT=$(curl -sf -X POST "${BACKEND_URL}/workflow/task" \
  -H "Content-Type: application/json" \
  -d "{\"service_request_id\":\"${SR_ID:-sr-test}\",\"owner_organization_id\":\"org-b\",\"requester_organization_id\":\"org-a\"}" 2>/dev/null || echo "{}")
TASK_ID=$(echo "$TASK_RESULT" | python3 -c "import sys,json; print(json.load(sys.stdin).get('result',{}).get('id',''))" 2>/dev/null || echo "")
[ -n "$TASK_ID" ] && pass "Task created at partyB: $TASK_ID" || fail "Task creation failed"

# ── 11. List tasks at partyB ──────────────────────────────────────────────────
info "11. List tasks (partyB)"
TASK_COUNT=$(curl -sf "${BACKEND_URL}/fhir/partyB/Task" \
  | python3 -c "import sys,json; d=json.load(sys.stdin); print(d.get('result',{}).get('total',0))" 2>/dev/null || echo "0")
[ "$TASK_COUNT" -gt "0" ] 2>/dev/null && pass "partyB has $TASK_COUNT task(s)" || fail "partyB tasks: $TASK_COUNT"

# ── 12. Update task status ────────────────────────────────────────────────────
if [ -n "$TASK_ID" ]; then
  info "12. Update task status to 'accepted'"
  STATUS=$(curl -sf -o /dev/null -w "%{http_code}" -X PUT "${BACKEND_URL}/workflow/task/${TASK_ID}/status" \
    -H "Content-Type: application/json" \
    -d '{"status":"accepted"}' || echo "000")
  [ "$STATUS" = "200" ] && pass "Task status updated → 200" || fail "Task status update → $STATUS"
fi

echo ""
echo "============================================"
echo " Results: ${GREEN}${PASS} passed${NC}, ${RED}${FAIL} failed${NC}"
echo "============================================"
echo ""

[ "$FAIL" -eq 0 ] && exit 0 || exit 1
