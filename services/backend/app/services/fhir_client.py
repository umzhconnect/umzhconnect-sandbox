"""
FHIR REST client — thin wrapper around httpx for HAPI FHIR.
Injects the correct partition header and Bearer token.
"""
from typing import Any, Optional
import httpx

from app.config import get_settings
from app.services.token_manager import get_token

settings = get_settings()

PARTY_PARTITION = {
    "partyA": "partyA",
    "partyB": "partyB",
}

PARTY_GATEWAY = {
    "partyA": settings.krakend_a_url,
    "partyB": settings.krakend_b_url,
}


async def fhir_get(
    party_id: str,
    resource_type: str,
    resource_id: Optional[str] = None,
    params: Optional[dict] = None,
    use_direct: bool = False,
    log: Optional[list] = None,
) -> dict:
    """GET a FHIR resource (or search) for the given party."""
    token = await get_token(party_id)
    base = settings.hapi_fhir_url if use_direct else PARTY_GATEWAY[party_id]
    partition = PARTY_PARTITION[party_id]

    url = f"{base}/fhir/{resource_type}"
    if resource_id:
        url = f"{url}/{resource_id}"

    headers = {
        "Authorization": f"Bearer {token}",
        "Accept": "application/fhir+json",
        "X-HAPI-Partition-Name": partition,
    }

    _log_entry = {"method": "GET", "url": url, "params": params}
    async with httpx.AsyncClient(timeout=30) as client:
        resp = await client.get(url, headers=headers, params=params)
        _log_entry["status"] = resp.status_code
        _log_entry["response_size"] = len(resp.content)
        if log is not None:
            log.append(_log_entry)
        resp.raise_for_status()
        return resp.json()


async def fhir_post(
    party_id: str,
    resource_type: str,
    body: dict,
    use_direct: bool = False,
    log: Optional[list] = None,
) -> dict:
    """POST (create) a FHIR resource for the given party."""
    token = await get_token(party_id)
    base = settings.hapi_fhir_url if use_direct else PARTY_GATEWAY[party_id]
    partition = PARTY_PARTITION[party_id]

    url = f"{base}/fhir/{resource_type}"
    headers = {
        "Authorization": f"Bearer {token}",
        "Content-Type": "application/fhir+json",
        "Accept": "application/fhir+json",
        "X-HAPI-Partition-Name": partition,
    }

    _log_entry = {"method": "POST", "url": url, "body_type": resource_type}
    async with httpx.AsyncClient(timeout=30) as client:
        resp = await client.post(url, headers=headers, json=body)
        _log_entry["status"] = resp.status_code
        if log is not None:
            log.append(_log_entry)
        resp.raise_for_status()
        return resp.json()


async def fhir_put(
    party_id: str,
    resource_type: str,
    resource_id: str,
    body: dict,
    use_direct: bool = False,
    log: Optional[list] = None,
) -> dict:
    """PUT (update) a FHIR resource for the given party."""
    token = await get_token(party_id)
    base = settings.hapi_fhir_url if use_direct else PARTY_GATEWAY[party_id]
    partition = PARTY_PARTITION[party_id]

    url = f"{base}/fhir/{resource_type}/{resource_id}"
    headers = {
        "Authorization": f"Bearer {token}",
        "Content-Type": "application/fhir+json",
        "Accept": "application/fhir+json",
        "X-HAPI-Partition-Name": partition,
    }

    _log_entry = {"method": "PUT", "url": url, "resource_id": resource_id}
    async with httpx.AsyncClient(timeout=30) as client:
        resp = await client.put(url, headers=headers, json=body)
        _log_entry["status"] = resp.status_code
        if log is not None:
            log.append(_log_entry)
        resp.raise_for_status()
        return resp.json()


async def fhir_cross_party_get(
    source_party: str,
    target_party: str,
    resource_type: str,
    resource_id: Optional[str] = None,
    params: Optional[dict] = None,
    log: Optional[list] = None,
) -> dict:
    """
    Cross-party read: target_party fetches resource from source_party's store.
    Uses source_party's gateway but target_party's token (with appropriate scope).
    The consent is enforced by OPA at the gateway level.
    """
    token = await get_token(target_party)
    base = PARTY_GATEWAY[source_party]
    partition = PARTY_PARTITION[source_party]

    url = f"{base}/fhir/{resource_type}"
    if resource_id:
        url = f"{url}/{resource_id}"

    headers = {
        "Authorization": f"Bearer {token}",
        "Accept": "application/fhir+json",
        "X-HAPI-Partition-Name": partition,
    }

    _log_entry = {
        "method": "GET",
        "url": url,
        "note": f"Cross-party: {target_party} reading from {source_party}",
        "params": params,
    }
    async with httpx.AsyncClient(timeout=30) as client:
        resp = await client.get(url, headers=headers, params=params)
        _log_entry["status"] = resp.status_code
        if log is not None:
            log.append(_log_entry)
        resp.raise_for_status()
        return resp.json()
