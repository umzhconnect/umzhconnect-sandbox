# =============================================================================
# 09-party-id-exact-match.hurl — party_id exact-match enforcement
#
# Verifies that the new full-URL party_id (e.g.
# "http://localhost:8084/fhir/Organization/HospitalF") is compared with
# provision.actor[].reference.reference using exact equality, not substring.
#
# Attack scenario: a client with a party_id that is a prefix or substring of
# a legitimate actor URL must be denied.
#
# OPA is called directly so no Keycloak token or APISIX routing is needed.
# resource_id is left empty so resource_in_consent_scope passes trivially,
# isolating the valid_consent check.
# =============================================================================


# ---------------------------------------------------------------------------
# Substring / prefix attack: a short party_id that is a substring of the
# legitimate actor reference must NOT pass the exact-match check.
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
      "party_id": "http://localhost:8084/fhir/Organization/Hospital",
      "smart_scopes": "system/Patient.r",
      "fhir_context": [{"reference": "ServiceRequest/ReferralOrthopedicSurgery", "type": "ServiceRequest"}]
    },
    "fhir_base": "http://nginx-proxy:81/fhir/placer"
  }
}
HTTP 200
[Asserts]
# "Hospital" is a prefix of both HospitalF and HospitalP — must be denied.
jsonpath "$.result.allow" == false


# ---------------------------------------------------------------------------
# Sanity check: the legitimate actor (HospitalF) is admitted.
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
      "party_id": "http://localhost:8084/fhir/Organization/HospitalF",
      "smart_scopes": "system/Patient.r",
      "fhir_context": [{"reference": "ServiceRequest/ReferralOrthopedicSurgery", "type": "ServiceRequest"}]
    },
    "fhir_base": "http://nginx-proxy:81/fhir/placer"
  }
}
HTTP 200
[Asserts]
jsonpath "$.result.allow" == true
