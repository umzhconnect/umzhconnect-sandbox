"""Basic health and trust-bundle tests."""
import pytest
from fastapi.testclient import TestClient
from unittest.mock import patch, AsyncMock

from app.main import app

client = TestClient(app)


def test_health():
    resp = client.get("/health")
    assert resp.status_code == 200
    data = resp.json()
    assert data["status"] == "ok"
    assert "backend" in data["service"]


def test_trust_bundle():
    resp = client.get("/trust-bundle")
    assert resp.status_code == 200
    data = resp.json()
    assert "parties" in data
    assert len(data["parties"]) == 2
    party_ids = {p["id"] for p in data["parties"]}
    assert "partyA" in party_ids
    assert "partyB" in party_ids


def test_docs_available():
    resp = client.get("/docs")
    assert resp.status_code == 200


def test_openapi_schema():
    resp = client.get("/openapi.json")
    assert resp.status_code == 200
    schema = resp.json()
    assert schema["info"]["title"] == "COW Sandbox Backend"
