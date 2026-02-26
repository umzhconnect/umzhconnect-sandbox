"""Workflow orchestration tests (mocked FHIR calls)."""
import pytest
from fastapi.testclient import TestClient
from unittest.mock import patch, AsyncMock

from app.main import app

client = TestClient(app)

MOCK_SR = {
    "resourceType": "ServiceRequest",
    "id": "sr-001",
    "status": "active",
    "intent": "order",
}

MOCK_CONSENT = {
    "resourceType": "Consent",
    "id": "consent-001",
    "status": "active",
}

MOCK_TASK = {
    "resourceType": "Task",
    "id": "task-001",
    "status": "requested",
    "intent": "order",
}


@patch("app.routers.workflow.fhir_post", new_callable=AsyncMock, return_value=MOCK_SR)
def test_create_service_request(mock_post):
    resp = client.post("/workflow/service-request", json={
        "patient_id": "patient-001",
        "requester_practitioner_id": "pract-001",
        "performer_organization_id": "org-001",
    })
    assert resp.status_code == 200
    data = resp.json()
    assert data["result"]["resourceType"] == "ServiceRequest"
    mock_post.assert_called_once()


@patch("app.routers.workflow.fhir_post", new_callable=AsyncMock, return_value=MOCK_CONSENT)
def test_create_consent(mock_post):
    resp = client.post("/workflow/consent", json={
        "patient_id": "patient-001",
        "service_request_id": "sr-001",
        "performer_organization_id": "org-002",
    })
    assert resp.status_code == 200
    data = resp.json()
    assert data["result"]["resourceType"] == "Consent"


@patch("app.routers.workflow.fhir_post", new_callable=AsyncMock, return_value=MOCK_TASK)
def test_create_task(mock_post):
    resp = client.post("/workflow/task", json={
        "service_request_id": "sr-001",
        "owner_organization_id": "org-002",
        "requester_organization_id": "org-001",
    })
    assert resp.status_code == 200
    data = resp.json()
    assert data["result"]["resourceType"] == "Task"


@patch("app.routers.workflow.fhir_put", new_callable=AsyncMock, return_value={**MOCK_TASK, "status": "accepted"})
@patch("app.routers.workflow.fhir_get", new_callable=AsyncMock, return_value=MOCK_TASK)
def test_update_task_status(mock_get, mock_put):
    resp = client.put("/workflow/task/task-001/status", json={
        "status": "accepted",
    })
    assert resp.status_code == 200
    data = resp.json()
    assert data["result"]["status"] == "accepted"


@patch("app.routers.workflow.fhir_put", new_callable=AsyncMock, return_value={**MOCK_TASK, "output": [{}]})
@patch("app.routers.workflow.fhir_get", new_callable=AsyncMock, return_value=MOCK_TASK)
def test_add_task_output(mock_get, mock_put):
    resp = client.post("/workflow/task/task-001/output", json={
        "output_type": "Appointment",
        "output_reference": "Appointment/appt-001",
    })
    assert resp.status_code == 200
