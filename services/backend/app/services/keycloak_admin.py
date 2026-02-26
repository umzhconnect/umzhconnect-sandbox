"""
Keycloak Admin REST API client.
Used for user management and client registration.
"""
import httpx
from typing import Optional
from app.config import get_settings

settings = get_settings()


async def get_admin_token() -> str:
    """Get an admin token for the master realm."""
    async with httpx.AsyncClient(timeout=10) as client:
        resp = await client.post(
            f"{settings.keycloak_url}/realms/master/protocol/openid-connect/token",
            data={
                "grant_type": "password",
                "client_id": "admin-cli",
                "username": settings.keycloak_admin,
                "password": settings.keycloak_admin_password,
            },
        )
        resp.raise_for_status()
        return resp.json()["access_token"]


async def get_realm_clients() -> list:
    """List all clients in the umzh-sandbox realm."""
    token = await get_admin_token()
    async with httpx.AsyncClient(timeout=10) as client:
        resp = await client.get(
            f"{settings.keycloak_admin_url}/clients",
            headers={"Authorization": f"Bearer {token}"},
        )
        resp.raise_for_status()
        return resp.json()


async def get_client_by_id(client_id: str) -> Optional[dict]:
    """Find a client by clientId."""
    clients = await get_realm_clients()
    for c in clients:
        if c.get("clientId") == client_id:
            return c
    return None


async def create_client(client_config: dict) -> dict:
    """Create a new client in the umzh-sandbox realm."""
    token = await get_admin_token()
    async with httpx.AsyncClient(timeout=10) as client:
        resp = await client.post(
            f"{settings.keycloak_admin_url}/clients",
            headers={
                "Authorization": f"Bearer {token}",
                "Content-Type": "application/json",
            },
            json=client_config,
        )
        resp.raise_for_status()
        return {"status": "created", "client_id": client_config.get("clientId")}


async def get_realm_info() -> dict:
    """Get realm configuration."""
    token = await get_admin_token()
    async with httpx.AsyncClient(timeout=10) as client:
        resp = await client.get(
            settings.keycloak_admin_url,
            headers={"Authorization": f"Bearer {token}"},
        )
        resp.raise_for_status()
        return resp.json()
