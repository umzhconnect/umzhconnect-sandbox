from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
import time
import uuid

from app.config import get_settings
from app.routers import auth, fhir, workflow, onboarding

settings = get_settings()

app = FastAPI(
    title="COW Sandbox Backend",
    description="UMZH-Connect Clinical Order Workflow — BFF & Orchestration API",
    version="0.1.0",
    docs_url="/docs",
    redoc_url="/redoc",
)

# ── CORS ──────────────────────────────────────────────────────────────────────
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# ── Request ID middleware ─────────────────────────────────────────────────────
@app.middleware("http")
async def add_request_id(request: Request, call_next):
    request_id = str(uuid.uuid4())
    request.state.request_id = request_id
    request.state.log = []
    start = time.time()
    response = await call_next(request)
    duration = round((time.time() - start) * 1000)
    response.headers["X-Request-ID"] = request_id
    response.headers["X-Response-Time"] = f"{duration}ms"
    return response

# ── Routers ───────────────────────────────────────────────────────────────────
app.include_router(auth.router, prefix="/auth", tags=["auth"])
app.include_router(fhir.router, prefix="/fhir", tags=["fhir"])
app.include_router(workflow.router, prefix="/workflow", tags=["workflow"])
app.include_router(onboarding.router, prefix="/onboarding", tags=["onboarding"])

# ── Health check ──────────────────────────────────────────────────────────────
@app.get("/health", tags=["system"])
async def health():
    return {"status": "ok", "service": "cow-sandbox-backend"}

@app.get("/trust-bundle", tags=["security"])
async def trust_bundle():
    """Returns the trust bundle: parties, clients, allowed scopes."""
    return {
        "parties": [
            {
                "id": "partyA",
                "name": "PartyA (Placer/Referrer)",
                "client_id": settings.placer_client_id,
                "gateway": settings.krakend_a_url,
                "allowed_scopes": [
                    "system/Patient.r",
                    "system/ServiceRequest.cruds",
                    "system/Consent.cruds",
                    "system/Condition.r",
                    "system/Medication.r",
                    "system/MedicationStatement.r",
                    "system/Practitioner.r",
                    "system/Organization.r",
                ],
            },
            {
                "id": "partyB",
                "name": "PartyB (Fulfiller)",
                "client_id": settings.fulfiller_client_id,
                "gateway": settings.krakend_b_url,
                "allowed_scopes": [
                    "system/Task.cruds",
                    "system/ServiceRequest.rs",
                    "system/Patient.r",
                    "system/Condition.r",
                    "system/Medication.r",
                    "system/Appointment.cruds",
                ],
            },
        ],
        "auth_level": settings.auth_level,
        "issuer": f"{settings.keycloak_url}/realms/{settings.keycloak_realm}",
        "jwks_uri": settings.keycloak_jwks_url,
    }
