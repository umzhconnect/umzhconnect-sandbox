"""
Client credentials token cache.
Fetches and caches tokens per party, refreshes before expiry.
"""
import time
import asyncio
from typing import Dict, Optional
import httpx

from app.config import get_settings

settings = get_settings()

_PARTY_CREDENTIALS = {
    "partyA": {
        "client_id": settings.placer_client_id,
        "client_secret": settings.placer_client_secret,
        "scope": (
            "system/Patient.r system/ServiceRequest.cruds "
            "system/Consent.cruds system/Condition.r "
            "system/Medication.r system/MedicationStatement.r "
            "system/Practitioner.r system/Organization.r"
        ),
    },
    "partyB": {
        "client_id": settings.fulfiller_client_id,
        "client_secret": settings.fulfiller_client_secret,
        "scope": (
            "system/Task.cruds system/ServiceRequest.rs "
            "system/Patient.r system/Condition.r "
            "system/Medication.r system/Appointment.cruds"
        ),
    },
}

# Cache: party_id -> {access_token, expires_at}
_token_cache: Dict[str, dict] = {}
_lock = asyncio.Lock()


async def get_token(party_id: str) -> str:
    """Return a valid access token for the given party, fetching if needed."""
    async with _lock:
        cached = _token_cache.get(party_id)
        if cached and cached["expires_at"] > time.time() + 30:
            return cached["access_token"]

        token_data = await _fetch_token(party_id)
        _token_cache[party_id] = token_data
        return token_data["access_token"]


async def _fetch_token(party_id: str) -> dict:
    creds = _PARTY_CREDENTIALS.get(party_id)
    if not creds:
        raise ValueError(f"Unknown party: {party_id}")

    async with httpx.AsyncClient(timeout=10) as client:
        resp = await client.post(
            settings.keycloak_token_url,
            data={
                "grant_type": "client_credentials",
                "client_id": creds["client_id"],
                "client_secret": creds["client_secret"],
                "scope": creds["scope"],
            },
        )
        resp.raise_for_status()
        body = resp.json()
        return {
            "access_token": body["access_token"],
            "expires_at": time.time() + body.get("expires_in", 3600),
        }


async def invalidate_token(party_id: str) -> None:
    """Force token refresh on next request."""
    async with _lock:
        _token_cache.pop(party_id, None)
