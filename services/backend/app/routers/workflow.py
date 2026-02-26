"""
Workflow router — COW orchestration actions.
Implements the Clinical Order Workflow steps.
"""
from typing import Optional
from fastapi import APIRouter, HTTPException, Request
from pydantic import BaseModel

from app.services.fhir_client import fhir_post, fhir_put, fhir_get

router = APIRouter()


# ── Request Models ────────────────────────────────────────────────────────────

class ServiceRequestInput(BaseModel):
    patient_id: str
    requester_practitioner_id: str
    performer_organization_id: str
    reason_code: str = "ACL-RUPTURE"
    reason_display: str = "Suspected ACL Rupture"
    note: Optional[str] = None
    condition_ids: list[str] = []


class ConsentInput(BaseModel):
    patient_id: str
    service_request_id: str
    performer_party_id: str = "partyB"
    performer_organization_id: str


class TaskInput(BaseModel):
    service_request_id: str
    service_request_party: str = "partyA"
    owner_organization_id: str
    requester_organization_id: str


class TaskStatusInput(BaseModel):
    status: str
    owner_reference: Optional[str] = None
    business_status_code: Optional[str] = None
    business_status_display: Optional[str] = None


class TaskOutputInput(BaseModel):
    output_type: str = "Appointment"
    output_reference: str


# ── Routes ────────────────────────────────────────────────────────────────────

@router.post("/service-request")
async def create_service_request(body: ServiceRequestInput, request: Request):
    """
    COW Step 1: Placer creates a ServiceRequest in partyA's FHIR store.
    """
    log = getattr(request.state, "log", [])

    sr = {
        "resourceType": "ServiceRequest",
        "status": "active",
        "intent": "order",
        "priority": "routine",
        "subject": {"reference": f"Patient/{body.patient_id}"},
        "requester": {"reference": f"Practitioner/{body.requester_practitioner_id}"},
        "performer": [{"reference": f"Organization/{body.performer_organization_id}"}],
        "reasonCode": [
            {
                "coding": [
                    {
                        "system": "http://snomed.info/sct",
                        "code": body.reason_code,
                        "display": body.reason_display,
                    }
                ]
            }
        ],
        "reasonReference": [
            {"reference": f"Condition/{cid}"} for cid in body.condition_ids
        ],
    }

    if body.note:
        sr["note"] = [{"text": body.note}]

    try:
        result = await fhir_post("partyA", "ServiceRequest", sr, log=log)
        return {"result": result, "log": log}
    except Exception as e:
        raise HTTPException(status_code=502, detail=str(e))


@router.post("/consent")
async def create_consent(body: ConsentInput, request: Request):
    """
    COW Step 2: Placer creates a Consent granting fulfiller access to SR data.
    """
    log = getattr(request.state, "log", [])

    consent = {
        "resourceType": "Consent",
        "status": "active",
        "scope": {
            "coding": [
                {
                    "system": "http://terminology.hl7.org/CodeSystem/consentscope",
                    "code": "treatment",
                    "display": "Treatment",
                }
            ]
        },
        "category": [
            {
                "coding": [
                    {
                        "system": "http://loinc.org",
                        "code": "59284-0",
                        "display": "Consent Document",
                    }
                ]
            }
        ],
        "patient": {"reference": f"Patient/{body.patient_id}"},
        "performer": [{"reference": f"Organization/{body.performer_organization_id}"}],
        "sourceReference": {"reference": f"ServiceRequest/{body.service_request_id}"},
        "provision": {
            "type": "permit",
            "actor": [
                {
                    "role": {
                        "coding": [
                            {
                                "system": "http://terminology.hl7.org/CodeSystem/v3-ParticipationType",
                                "code": "PRCP",
                                "display": "primary information recipient",
                            }
                        ]
                    },
                    "reference": {"reference": f"Organization/{body.performer_organization_id}"},
                }
            ],
            "data": [
                {
                    "meaning": "related",
                    "reference": {"reference": f"ServiceRequest/{body.service_request_id}"},
                }
            ],
        },
    }

    try:
        result = await fhir_post("partyA", "Consent", consent, log=log)
        return {"result": result, "log": log}
    except Exception as e:
        raise HTTPException(status_code=502, detail=str(e))


@router.post("/task")
async def create_task(body: TaskInput, request: Request):
    """
    COW Step 3: Placer creates a Task in partyB's FHIR store referencing the SR.
    """
    log = getattr(request.state, "log", [])

    # Construct absolute reference to partyA's ServiceRequest
    # (fulfiller will resolve this via the cross-party proxy)
    sr_ref = f"ServiceRequest/{body.service_request_id}"

    task = {
        "resourceType": "Task",
        "status": "requested",
        "intent": "order",
        "priority": "routine",
        "focus": {"reference": sr_ref},
        "for": {"reference": "Patient/unknown"},  # will be resolved from SR
        "requester": {"reference": f"Organization/{body.requester_organization_id}"},
        "owner": {"reference": f"Organization/{body.owner_organization_id}"},
        "input": [
            {
                "type": {
                    "coding": [
                        {
                            "system": "http://hl7.org/fhir/uv/sdc/CodeSystem/launchContext",
                            "code": "sourceServiceRequest",
                        }
                    ]
                },
                "valueReference": {"reference": sr_ref},
            }
        ],
    }

    try:
        result = await fhir_post("partyB", "Task", task, log=log)
        return {"result": result, "log": log}
    except Exception as e:
        raise HTTPException(status_code=502, detail=str(e))


@router.put("/task/{task_id}/status")
async def update_task_status(task_id: str, body: TaskStatusInput, request: Request):
    """Update Task status (and optionally owner/business status)."""
    log = getattr(request.state, "log", [])

    # Fetch current task
    try:
        current = await fhir_get("partyB", "Task", resource_id=task_id, log=log)
    except Exception as e:
        raise HTTPException(status_code=404, detail=f"Task not found: {e}")

    current["status"] = body.status

    if body.owner_reference:
        current["owner"] = {"reference": body.owner_reference}

    if body.business_status_code:
        current["businessStatus"] = {
            "coding": [
                {
                    "code": body.business_status_code,
                    "display": body.business_status_display or body.business_status_code,
                }
            ]
        }

    try:
        result = await fhir_put("partyB", "Task", task_id, current, log=log)
        return {"result": result, "log": log}
    except Exception as e:
        raise HTTPException(status_code=502, detail=str(e))


@router.post("/task/{task_id}/output")
async def add_task_output(task_id: str, body: TaskOutputInput, request: Request):
    """Add an output reference to a Task (e.g., Appointment or DiagnosticReport)."""
    log = getattr(request.state, "log", [])

    try:
        current = await fhir_get("partyB", "Task", resource_id=task_id, log=log)
    except Exception as e:
        raise HTTPException(status_code=404, detail=f"Task not found: {e}")

    output_entry = {
        "type": {
            "coding": [
                {"code": body.output_type}
            ]
        },
        "valueReference": {"reference": body.output_reference},
    }

    if "output" not in current:
        current["output"] = []
    current["output"].append(output_entry)

    try:
        result = await fhir_put("partyB", "Task", task_id, current, log=log)
        return {"result": result, "log": log}
    except Exception as e:
        raise HTTPException(status_code=502, detail=str(e))
