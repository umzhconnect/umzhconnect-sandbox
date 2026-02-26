"""
Onboarding router — user registration scaffolding and seed data creation.
"""
from fastapi import APIRouter, HTTPException, Request
from pydantic import BaseModel
from typing import Optional

from app.services.fhir_client import fhir_get, fhir_post, fhir_put

router = APIRouter()


class OnboardingRequest(BaseModel):
    user_email: str
    user_name: Optional[str] = None


@router.post("/register")
async def register_user(body: OnboardingRequest, request: Request):
    """
    Called after user registers in Keycloak.
    Seeds FHIR resources for both parties.
    """
    log = getattr(request.state, "log", [])

    results = {}

    # ── Seed partyA resources ─────────────────────────────────────────────────
    try:
        # Organization partyA — PUT with stable ID (create-as-update, idempotent)
        org_a = await fhir_put("partyA", "Organization", "org-party-a", {
            "resourceType": "Organization",
            "id": "org-party-a",
            "name": "University Hospital Zurich — Cardiology",
            "identifier": [{"system": "urn:umzh-sandbox:party", "value": "partyA"}],
            "type": [{"coding": [{"system": "http://terminology.hl7.org/CodeSystem/organization-type", "code": "prov", "display": "Healthcare Provider"}]}],
        }, log=log)
        results["org_a"] = org_a.get("id")

        # Practitioner
        pract = await fhir_post("partyA", "Practitioner", {
            "resourceType": "Practitioner",
            "name": [{"family": "Muster", "given": ["Hans"], "prefix": ["Dr. med."]}],
            "identifier": [{"system": "urn:oid:2.51.1.3", "value": "7601000000001"}],
        }, log=log)
        results["practitioner"] = pract.get("id")

        # Patient
        patient = await fhir_post("partyA", "Patient", {
            "resourceType": "Patient",
            "name": [{"family": "Meier", "given": ["Petra"]}],
            "gender": "female",
            "birthDate": "1975-06-15",
            "identifier": [{"system": "urn:oid:2.16.756.5.32", "value": "756.1234.5678.09"}],
            "address": [{"city": "Zürich", "country": "CH", "postalCode": "8001"}],
        }, log=log)
        results["patient"] = patient.get("id")

        # Condition 1: Heart Failure
        cond1 = await fhir_post("partyA", "Condition", {
            "resourceType": "Condition",
            "subject": {"reference": f"Patient/{patient.get('id')}"},
            "code": {
                "coding": [{
                    "system": "http://snomed.info/sct",
                    "code": "84114007",
                    "display": "Heart failure (disorder)"
                }]
            },
            "clinicalStatus": {"coding": [{"system": "http://terminology.hl7.org/CodeSystem/condition-clinical", "code": "active"}]},
            "verificationStatus": {"coding": [{"system": "http://terminology.hl7.org/CodeSystem/condition-ver-status", "code": "confirmed"}]},
        }, log=log)
        results["condition_hf"] = cond1.get("id")

        # Condition 2: ACL Rupture
        cond2 = await fhir_post("partyA", "Condition", {
            "resourceType": "Condition",
            "subject": {"reference": f"Patient/{patient.get('id')}"},
            "code": {
                "coding": [{
                    "system": "http://snomed.info/sct",
                    "code": "444798002",
                    "display": "Rupture of anterior cruciate ligament (disorder)"
                }]
            },
            "clinicalStatus": {"coding": [{"system": "http://terminology.hl7.org/CodeSystem/condition-clinical", "code": "active"}]},
            "verificationStatus": {"coding": [{"system": "http://terminology.hl7.org/CodeSystem/condition-ver-status", "code": "provisional"}]},
        }, log=log)
        results["condition_acl"] = cond2.get("id")

        # Medication
        med = await fhir_post("partyA", "Medication", {
            "resourceType": "Medication",
            "code": {
                "coding": [{
                    "system": "http://www.whocc.no/atc",
                    "code": "C07AB07",
                    "display": "Bisoprolol (Concor)"
                }]
            },
        }, log=log)
        results["medication"] = med.get("id")

        # MedicationStatement
        med_stmt = await fhir_post("partyA", "MedicationStatement", {
            "resourceType": "MedicationStatement",
            "status": "active",
            "subject": {"reference": f"Patient/{patient.get('id')}"},
            "medicationReference": {"reference": f"Medication/{med.get('id')}"},
            "dosage": [{"text": "2.5mg once daily"}],
        }, log=log)
        results["medication_statement"] = med_stmt.get("id")

    except Exception as e:
        raise HTTPException(status_code=502, detail=f"partyA seed failed: {e}")

    # ── Seed partyB resources ─────────────────────────────────────────────────
    try:
        # Organization partyB — PUT with stable ID (create-as-update, idempotent)
        org_b = await fhir_put("partyB", "Organization", "org-party-b", {
            "resourceType": "Organization",
            "id": "org-party-b",
            "name": "Balgrist — Orthopedics",
            "identifier": [{"system": "urn:umzh-sandbox:party", "value": "partyB"}],
            "type": [{"coding": [{"system": "http://terminology.hl7.org/CodeSystem/organization-type", "code": "prov", "display": "Healthcare Provider"}]}],
        }, log=log)
        results["org_b"] = org_b.get("id")

        # Practitioner partyB
        pract_b = await fhir_post("partyB", "Practitioner", {
            "resourceType": "Practitioner",
            "name": [{"family": "Schmidt", "given": ["Anna"], "prefix": ["Dr. med."]}],
            "identifier": [{"system": "urn:oid:2.51.1.3", "value": "7601000000002"}],
        }, log=log)
        results["practitioner_b"] = pract_b.get("id")

    except Exception as e:
        raise HTTPException(status_code=502, detail=f"partyB seed failed: {e}")

    return {
        "status": "seeded",
        "user": body.user_email,
        "resources": results,
        "log": log,
    }


@router.get("/status")
async def check_status(request: Request):
    """Check if seed data exists for the current setup."""
    log = []
    status = {}

    try:
        patients = await fhir_get("partyA", "Patient", params={"_count": "1"}, log=log)
        status["partyA_patients"] = patients.get("total", 0)
    except Exception:
        status["partyA_patients"] = None

    try:
        orgs_b = await fhir_get("partyB", "Organization", params={"_count": "1"}, log=log)
        status["partyB_organizations"] = orgs_b.get("total", 0)
    except Exception:
        status["partyB_organizations"] = None

    seeded = (
        status.get("partyA_patients", 0) is not None
        and status.get("partyA_patients", 0) > 0
        and status.get("partyB_organizations", 0) is not None
        and status.get("partyB_organizations", 0) > 0
    )

    return {"seeded": seeded, "details": status, "log": log}
