#!/bin/sh
# =============================================================================
# config-init — renders the env-specific config files for this party into the
# shared `rendered` volume that nginx-proxy, opa, and kestra-flow-loader read.
#
# Uses envsubst with an explicit variable allowlist per file so that runtime
# tokens that legitimately contain `$` (e.g. nginx's $host) are left untouched.
# =============================================================================
set -eu

TPL=/templates
FLOWSRC=/flows-src
OUT=/rendered

echo "[config-init] rendering for PARTY=${PARTY}"

# nginx-proxy.conf — only our three vars; nginx's own $host/$remote_addr survive.
envsubst '${PARTY} ${OWN_INTERNAL_URL} ${OWN_EXTERNAL_URL}' \
  < "${TPL}/nginx-proxy.conf.template" > "${OUT}/nginx.conf"

# opa data document
envsubst '${PARTNER_REALM_ROLE} ${PARTY}' \
  < "${TPL}/opa-config.json.template" > "${OUT}/opa-config.json"

# kestra flow (referral reception)
mkdir -p "${OUT}/flows"
envsubst '${PARTY} ${AUTH_TOKEN_URL} ${AUTH_AUDIENCE} ${PARTNER_EXTERNAL_URL} ${L2_CLIENT_ID}' \
  < "${FLOWSRC}/referral-reception.yml.template" > "${OUT}/flows/referral-reception.yml"

echo "[config-init] done:"
ls -la "${OUT}" "${OUT}/flows"
