from pydantic_settings import BaseSettings, SettingsConfigDict
from functools import lru_cache


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    # ── Keycloak ──────────────────────────────────────────────────────────────
    keycloak_url: str = "http://keycloak:8080"
    keycloak_realm: str = "umzh-sandbox"
    keycloak_admin: str = "admin"
    keycloak_admin_password: str = "admin"

    # ── HAPI FHIR ─────────────────────────────────────────────────────────────
    hapi_fhir_url: str = "http://hapi-fhir:8080"

    # ── Gateways ──────────────────────────────────────────────────────────────
    krakend_a_url: str = "http://krakend-a:8080"
    krakend_b_url: str = "http://krakend-b:8080"

    # ── OPA ───────────────────────────────────────────────────────────────────
    opa_a_url: str = "http://opa-a:8181"
    opa_b_url: str = "http://opa-b:8182"

    # ── Client Credentials ────────────────────────────────────────────────────
    placer_client_id: str = "placer-client"
    placer_client_secret: str = "placer-secret-change-me"
    fulfiller_client_id: str = "fulfiller-client"
    fulfiller_client_secret: str = "fulfiller-secret-change-me"
    backend_client_id: str = "backend-client"
    backend_client_secret: str = "backend-secret-change-me"

    # ── Security Level ────────────────────────────────────────────────────────
    auth_level: int = 1

    # ── Frontend ──────────────────────────────────────────────────────────────
    frontend_url: str = "http://localhost:3000"

    @property
    def keycloak_token_url(self) -> str:
        return f"{self.keycloak_url}/realms/{self.keycloak_realm}/protocol/openid-connect/token"

    @property
    def keycloak_jwks_url(self) -> str:
        return f"{self.keycloak_url}/realms/{self.keycloak_realm}/protocol/openid-connect/certs"

    @property
    def keycloak_admin_url(self) -> str:
        return f"{self.keycloak_url}/admin/realms/{self.keycloak_realm}"


@lru_cache
def get_settings() -> Settings:
    return Settings()
