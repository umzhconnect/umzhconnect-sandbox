# =============================================================================
# 08-consent-enforcement.hurl — Scenario 1: Consent-centric access control
#
# Validates that the placer-external gateway enforces consent-graph membership.
# The built-in APISIX `opa` plugin calls OPA on every request; the adapter
# package `umzh.authz.apisix` (apisix.rego) maps the plugin's input shape to
# the existing main.rego input using `with input as`:
#   1. openid-connect — validates JWT, enforces bearer token presence
#   2. opa plugin     — calls OPA; 403 on deny, passes through on allow
#   3. upstream (HAPI FHIR) — serves the resource (only reached when allowed)
#
# On deny, APISIX returns HTTP 403.
#
# Consent scope — derived dynamically from Consent.sourceReference → ServiceRequest
# ---------------------------------------------------------------------------------
# OPA fetches the ServiceRequest and collects references from:
#   subject, requester, reasonReference, supportingInfo, insurance
# (performer is excluded; directory resources are covered by Rule 6)
#
# ReferralOrthopedicSurgery graph includes:
#   Patient/PetraMeier, Condition/SuspectedACLRupture,
#   Condition/HeartFailureHFrEF, ServiceRequest/ReferralOrthopedicSurgery,
#   MedicationStatement/*, Coverage/CoverageMeier,
#   DocumentReference/DocCardiologyAttachment, PractitionerRole/HansMusterRole
#
# ReferralOrthopedicSurgery does NOT include:
#   Condition/SarcomaKnee  (only in ReferralTumorboard)
#   ImagingStudy/ImagingCT (only in ReferralTumorboard)
# =============================================================================


# ---------------------------------------------------------------------------
# Step 1 — Acquire a consent-scoped token for ConsentOrthopedicReferral
#   fulfiller-client requests a token scoped to the orthopedic referral consent
# ---------------------------------------------------------------------------

POST {{keycloak_url}}/realms/umzh-connect/protocol/openid-connect/token
[FormParams]
grant_type: client_credentials
client_id: fulfiller-client
client_secret: fulfiller-secret-2025
scope: smart-clinical-read smart-servicerequest-read consent:ConsentOrthopedicReferral
HTTP 200
[Captures]
ortho_token: jsonpath "$.access_token"
[Asserts]
jsonpath "$.scope" contains "consent:ConsentOrthopedicReferral"


# ---------------------------------------------------------------------------
# POSITIVE TEST — Resource IS in the consent graph
#
# Condition/SuspectedACLRupture appears in ReferralOrthopedicSurgery.reasonReference.
# OPA fetches the Consent, verifies performer matches "hospitalf", fetches the SR,
# finds the reference in the SR graph → allow: true → HTTP 200
# ---------------------------------------------------------------------------

GET {{placer_ext_url}}/fhir/Condition/SuspectedACLRupture
Authorization: Bearer {{ortho_token}}
HTTP 200
[Asserts]
jsonpath "$.resourceType" == "Condition"
jsonpath "$.id"           == "SuspectedACLRupture"


# ---------------------------------------------------------------------------
# NEGATIVE TEST — Resource is NOT in the consent graph
#
# Condition/SarcomaKnee exists in the placer FHIR partition but is only
# referenced by ReferralTumorboard.  With consent:ConsentOrthopedicReferral,
# OPA fetches ReferralOrthopedicSurgery and finds no reference to SarcomaKnee
# → allow: false → HTTP 403.
# ---------------------------------------------------------------------------

GET {{placer_ext_url}}/fhir/Condition/SarcomaKnee
Authorization: Bearer {{ortho_token}}
HTTP 403


# ---------------------------------------------------------------------------
# POSITIVE TEST — Second consent (tumorboard) grants access to its own graph
#
# ImagingStudy/ImagingCT is in ReferralTumorboard.supportingInfo but NOT in
# ReferralOrthopedicSurgery.  With the tumorboard-scoped token, OPA allows.
# ---------------------------------------------------------------------------

POST {{keycloak_url}}/realms/umzh-connect/protocol/openid-connect/token
[FormParams]
grant_type: client_credentials
client_id: fulfiller-client
client_secret: fulfiller-secret-2025
scope: smart-clinical-read consent:ConsentTumorboardReferral
HTTP 200
[Captures]
tumor_token: jsonpath "$.access_token"
[Asserts]
jsonpath "$.scope" contains "consent:ConsentTumorboardReferral"

GET {{placer_ext_url}}/fhir/ImagingStudy/ImagingCT
Authorization: Bearer {{tumor_token}}
HTTP 200
[Asserts]
jsonpath "$.resourceType" == "ImagingStudy"
jsonpath "$.id"           == "ImagingCT"


# ---------------------------------------------------------------------------
# NEGATIVE TEST — Cross-consent: tumorboard token denied for orthopedic data
#
# MedicationStatement/MedicationEntresto is in ReferralOrthopedicSurgery.supportingInfo
# but NOT in ReferralTumorboard → OPA denies → HTTP 403.
# ---------------------------------------------------------------------------

GET {{placer_ext_url}}/fhir/MedicationStatement/MedicationEntresto
Authorization: Bearer {{tumor_token}}
HTTP 403
