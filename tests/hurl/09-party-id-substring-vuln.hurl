# =============================================================================
# 09-party-id-substring-vuln.hurl — CVE-style: party_id substring bypass
#
# Demonstrates that valid_consent uses contains() for the performer reference
# check, which allows any party whose party_id is a substring of the performer
# reference to pass the check — even if they are not the legitimate performer.
#
# Affected rule in services/opa/policies/main.rego:
#   contains(lower(performer.reference), lower(input.token.party_id))
#
# Attack: party_id = "hospital" is a substring of both
#   "Organization/placer-HospitalF"  (fulfiller)
#   "Organization/placer-HospitalP"  (placer)
# so any client claiming party_id "hospital" passes valid_consent for all
# consents regardless of which organisation is the legitimate performer.
#
# Expected behaviour after fix (endswith):
#   allow: false
# Current (buggy) behaviour asserted below:
#   allow: true
#
# OPA is called directly so no Keycloak token or KrakenD routing is needed.
# resource_id is left empty so resource_in_consent_scope passes trivially,
# isolating the valid_consent bug.
# =============================================================================


# ---------------------------------------------------------------------------
# Substring attack: party_id "hospital" matches "Organization/placer-HospitalF"
#
# A client with party_id "hospital" is NOT a legitimate performer on
# ConsentOrthopedicReferral (performer is Organization/placer-HospitalF,
# party_id "hospitalf").  The contains() check incorrectly admits it.
# ---------------------------------------------------------------------------

POST {{opa_placer_url}}/v1/data/umzh/authz
Content-Type: application/json
{
  "input": {
    "method": "GET",
    "path": "/fhir/Patient/PetraMeier",
    "resource_type": "Patient",
    "resource_id": "",
    "token": {
      "party_id": "hospital",
      "smart_scopes": "system/Patient.r",
      "scope": "openid consent:ConsentOrthopedicReferral"
    },
    "consent_id": "",
    "consent": {
      "resourceType": "Consent",
      "id": "ConsentOrthopedicReferral",
      "status": "active",
      "performer": [{"reference": "Organization/placer-HospitalF"}],
      "sourceReference": {"reference": "ServiceRequest/ReferralOrthopedicSurgery"}
    },
    "fhir_base": "http://nginx-proxy:81/fhir/placer"
  }
}
HTTP 200
[Asserts]
# "hospital" is NOT the legitimate performer — this should be denied.
# Currently FAILS because contains() admits any substring of the reference.
# Fix: change contains() to endswith() in valid_consent (main.rego).
jsonpath "$.result.allow" == false


# ---------------------------------------------------------------------------
# Sanity check: the legitimate performer (hospitalf) is also admitted.
# Both pass today — the fix must keep this true while making the above false.
# ---------------------------------------------------------------------------

POST {{opa_placer_url}}/v1/data/umzh/authz
Content-Type: application/json
{
  "input": {
    "method": "GET",
    "path": "/fhir/Patient/PetraMeier",
    "resource_type": "Patient",
    "resource_id": "",
    "token": {
      "party_id": "hospitalf",
      "smart_scopes": "system/Patient.r",
      "scope": "openid consent:ConsentOrthopedicReferral"
    },
    "consent_id": "",
    "consent": {
      "resourceType": "Consent",
      "id": "ConsentOrthopedicReferral",
      "status": "active",
      "performer": [{"reference": "Organization/placer-HospitalF"}],
      "sourceReference": {"reference": "ServiceRequest/ReferralOrthopedicSurgery"}
    },
    "fhir_base": "http://nginx-proxy:81/fhir/placer"
  }
}
HTTP 200
[Asserts]
jsonpath "$.result.allow" == true
