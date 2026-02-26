"""
FHIR proxy router.
Proxies FHIR requests to the correct KrakenD gateway with injected Bearer token.
"""
from typing import Optional, Any
from fastapi import APIRouter, Request, HTTPException, Query
from fastapi.responses import JSONResponse

from app.services.fhir_client import (
    fhir_get,
    fhir_post,
    fhir_put,
    fhir_cross_party_get,
)

router = APIRouter()


@router.get("/{party_id}/{resource_type}")
async def search_resources(
    party_id: str,
    resource_type: str,
    request: Request,
):
    """Search FHIR resources for the given party."""
    _validate_party(party_id)
    log = getattr(request.state, "log", [])
    params = dict(request.query_params)
    try:
        result = await fhir_get(party_id, resource_type, params=params, log=log)
        return {"result": result, "log": log}
    except Exception as e:
        raise HTTPException(status_code=502, detail=str(e))


@router.get("/{party_id}/{resource_type}/{resource_id}")
async def get_resource(
    party_id: str,
    resource_type: str,
    resource_id: str,
    request: Request,
):
    """Read a specific FHIR resource."""
    _validate_party(party_id)
    log = getattr(request.state, "log", [])
    try:
        result = await fhir_get(party_id, resource_type, resource_id=resource_id, log=log)
        return {"result": result, "log": log}
    except Exception as e:
        raise HTTPException(status_code=502, detail=str(e))


@router.post("/{party_id}/{resource_type}")
async def create_resource(
    party_id: str,
    resource_type: str,
    body: dict,
    request: Request,
):
    """Create a FHIR resource."""
    _validate_party(party_id)
    log = getattr(request.state, "log", [])
    try:
        result = await fhir_post(party_id, resource_type, body, log=log)
        return {"result": result, "log": log}
    except Exception as e:
        raise HTTPException(status_code=502, detail=str(e))


@router.put("/{party_id}/{resource_type}/{resource_id}")
async def update_resource(
    party_id: str,
    resource_type: str,
    resource_id: str,
    body: dict,
    request: Request,
):
    """Update a FHIR resource."""
    _validate_party(party_id)
    log = getattr(request.state, "log", [])
    try:
        result = await fhir_put(party_id, resource_type, resource_id, body, log=log)
        return {"result": result, "log": log}
    except Exception as e:
        raise HTTPException(status_code=502, detail=str(e))


@router.get("/external/{target_party}/{resource_type}")
async def cross_party_search(
    target_party: str,
    resource_type: str,
    request: Request,
    source_party: str = Query("partyA", description="Party whose data is being read"),
):
    """
    Cross-party resource search.
    E.g., partyB (target) reading ServiceRequest from partyA (source).
    Shows OAuth token negotiation in the protocol log.
    """
    _validate_party(source_party)
    _validate_party(target_party)
    log = getattr(request.state, "log", [])
    params = {k: v for k, v in request.query_params.items() if k != "source_party"}
    try:
        result = await fhir_cross_party_get(
            source_party, target_party, resource_type, params=params, log=log
        )
        return {"result": result, "log": log}
    except Exception as e:
        raise HTTPException(status_code=502, detail=str(e))


@router.get("/external/{target_party}/{resource_type}/{resource_id}")
async def cross_party_get(
    target_party: str,
    resource_type: str,
    resource_id: str,
    request: Request,
    source_party: str = Query("partyA"),
):
    """Cross-party resource read."""
    _validate_party(source_party)
    _validate_party(target_party)
    log = getattr(request.state, "log", [])
    try:
        result = await fhir_cross_party_get(
            source_party, target_party, resource_type,
            resource_id=resource_id, log=log
        )
        return {"result": result, "log": log}
    except Exception as e:
        raise HTTPException(status_code=502, detail=str(e))


def _validate_party(party_id: str):
    if party_id not in ("partyA", "partyB"):
        raise HTTPException(status_code=400, detail=f"Invalid party_id: {party_id}")
