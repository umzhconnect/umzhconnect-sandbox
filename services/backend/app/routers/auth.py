"""
Auth router — token endpoint proxy, client credentials management.
Client secrets never exposed to the browser.
"""
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from app.services.token_manager import get_token, invalidate_token
from app.services.keycloak_admin import get_client_by_id, get_realm_info
from app.config import get_settings

router = APIRouter()
settings = get_settings()


class TokenResponse(BaseModel):
    party_id: str
    token_type: str = "Bearer"
    # Note: access_token NOT returned — stored server-side
    message: str = "Token acquired and cached server-side"
    scopes: list[str] = []


@router.post("/token/{party_id}", response_model=TokenResponse)
async def acquire_token(party_id: str):
    """
    Acquire a client credentials token for the given party.
    Token is cached server-side; only a confirmation is returned to the SPA.
    """
    if party_id not in ("partyA", "partyB"):
        raise HTTPException(status_code=400, detail="party_id must be 'partyA' or 'partyB'")
    try:
        await get_token(party_id)
        return TokenResponse(
            party_id=party_id,
            scopes=_get_scopes(party_id),
        )
    except Exception as e:
        raise HTTPException(status_code=502, detail=f"Token acquisition failed: {e}")


@router.delete("/token/{party_id}")
async def revoke_token(party_id: str):
    """Force token refresh on next request."""
    await invalidate_token(party_id)
    return {"status": "invalidated", "party_id": party_id}


@router.get("/clients")
async def list_clients():
    """List registered M2M clients and their current auth level."""
    placer = await get_client_by_id(settings.placer_client_id)
    fulfiller = await get_client_by_id(settings.fulfiller_client_id)
    return {
        "auth_level": settings.auth_level,
        "clients": [
            {
                "party_id": "partyA",
                "client_id": settings.placer_client_id,
                "status": "registered" if placer else "not found",
            },
            {
                "party_id": "partyB",
                "client_id": settings.fulfiller_client_id,
                "status": "registered" if fulfiller else "not found",
            },
        ],
    }


@router.get("/realm-info")
async def realm_info():
    """Return Keycloak realm metadata."""
    try:
        info = await get_realm_info()
        return {
            "realm": info.get("realm"),
            "display_name": info.get("displayName"),
            "registration_allowed": info.get("registrationAllowed"),
            "issuer": f"{settings.keycloak_url}/realms/{settings.keycloak_realm}",
            "jwks_uri": settings.keycloak_jwks_url,
            "token_endpoint": settings.keycloak_token_url,
        }
    except Exception as e:
        raise HTTPException(status_code=502, detail=str(e))


def _get_scopes(party_id: str) -> list[str]:
    if party_id == "partyA":
        return [
            "system/Patient.r",
            "system/ServiceRequest.cruds",
            "system/Consent.cruds",
            "system/Condition.r",
            "system/Medication.r",
        ]
    return [
        "system/Task.cruds",
        "system/ServiceRequest.rs",
        "system/Patient.r",
        "system/Condition.r",
        "system/Appointment.cruds",
    ]
