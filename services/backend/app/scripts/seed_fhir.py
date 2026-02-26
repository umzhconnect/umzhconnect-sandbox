"""
FHIR seed script — idempotent seed loader for HAPI FHIR.
Run via: python -m app.scripts.seed_fhir
"""
import asyncio
import sys
import httpx
import os

HAPI_URL = os.environ.get("HAPI_FHIR_URL", "http://localhost:8282")
KEYCLOAK_URL = os.environ.get("KEYCLOAK_URL", "http://localhost:8180")
KEYCLOAK_REALM = os.environ.get("KEYCLOAK_REALM", "umzh-sandbox")
PLACER_CLIENT_ID = os.environ.get("PLACER_CLIENT_ID", "placer-client")
PLACER_CLIENT_SECRET = os.environ.get("PLACER_CLIENT_SECRET", "placer-secret-change-me")
FULFILLER_CLIENT_ID = os.environ.get("FULFILLER_CLIENT_ID", "fulfiller-client")
FULFILLER_CLIENT_SECRET = os.environ.get("FULFILLER_CLIENT_SECRET", "fulfiller-secret-change-me")


async def get_token(client_id: str, client_secret: str) -> str:
    async with httpx.AsyncClient(timeout=10) as client:
        resp = await client.post(
            f"{KEYCLOAK_URL}/realms/{KEYCLOAK_REALM}/protocol/openid-connect/token",
            data={
                "grant_type": "client_credentials",
                "client_id": client_id,
                "client_secret": client_secret,
            },
        )
        resp.raise_for_status()
        return resp.json()["access_token"]


async def post_resource(token: str, partition: str, resource: dict) -> dict:
    rt = resource["resourceType"]
    async with httpx.AsyncClient(timeout=30) as client:
        resp = await client.post(
            f"{HAPI_URL}/fhir/{rt}",
            headers={
                "Authorization": f"Bearer {token}",
                "Content-Type": "application/fhir+json",
                "X-HAPI-Partition-Name": partition,
            },
            json=resource,
        )
        if resp.status_code not in (200, 201):
            print(f"  WARNING: {rt} returned {resp.status_code}: {resp.text[:200]}")
            return {}
        data = resp.json()
        print(f"  + {rt}/{data.get('id', '?')} created in {partition}")
        return data


async def setup_partitions():
    """Create HAPI partitions for partyA and partyB."""
    async with httpx.AsyncClient(timeout=30) as client:
        for pid, pname in [(1, "partyA"), (2, "partyB")]:
            payload = {
                "resourceType": "Parameters",
                "parameter": [
                    {"name": "id", "valueInteger": pid},
                    {"name": "name", "valueCode": pname},
                    {"name": "status", "valueCode": "active"},
                ],
            }
            resp = await client.post(
                f"{HAPI_URL}/fhir/$partition-management-create-partition",
                headers={"Content-Type": "application/fhir+json"},
                json=payload,
            )
            if resp.status_code in (200, 201):
                print(f"  Partition '{pname}' created")
            elif resp.status_code == 400 and "already exists" in resp.text.lower():
                print(f"  Partition '{pname}' already exists")
            else:
                print(f"  Partition '{pname}': {resp.status_code} {resp.text[:100]}")


async def seed_party_a(token: str):
    print("\n[PartyA] Seeding resources...")

    org = await post_resource(token, "partyA", {
        "resourceType": "Organization",
        "name": "University Hospital Zurich — Cardiology",
        "identifier": [{"system": "urn:umzh-sandbox:party", "value": "partyA"}],
        "type": [{"coding": [{"system": "http://terminology.hl7.org/CodeSystem/organization-type", "code": "prov"}]}],
    })

    pract = await post_resource(token, "partyA", {
        "resourceType": "Practitioner",
        "name": [{"family": "Muster", "given": ["Hans"], "prefix": ["Dr. med."]}],
        "identifier": [{"system": "urn:oid:2.51.1.3", "value": "7601000000001"}],
    })

    patient = await post_resource(token, "partyA", {
        "resourceType": "Patient",
        "name": [{"family": "Meier", "given": ["Petra"]}],
        "gender": "female",
        "birthDate": "1975-06-15",
        "identifier": [{"system": "urn:oid:2.16.756.5.32", "value": "756.1234.5678.09"}],
        "address": [{"city": "Zürich", "country": "CH", "postalCode": "8001"}],
    })

    patient_id = patient.get("id", "unknown")

    cond1 = await post_resource(token, "partyA", {
        "resourceType": "Condition",
        "subject": {"reference": f"Patient/{patient_id}"},
        "code": {"coding": [{"system": "http://snomed.info/sct", "code": "84114007", "display": "Heart failure (disorder)"}]},
        "clinicalStatus": {"coding": [{"system": "http://terminology.hl7.org/CodeSystem/condition-clinical", "code": "active"}]},
        "verificationStatus": {"coding": [{"system": "http://terminology.hl7.org/CodeSystem/condition-ver-status", "code": "confirmed"}]},
    })

    cond2 = await post_resource(token, "partyA", {
        "resourceType": "Condition",
        "subject": {"reference": f"Patient/{patient_id}"},
        "code": {"coding": [{"system": "http://snomed.info/sct", "code": "444798002", "display": "Rupture of anterior cruciate ligament (disorder)"}]},
        "clinicalStatus": {"coding": [{"system": "http://terminology.hl7.org/CodeSystem/condition-clinical", "code": "active"}]},
        "verificationStatus": {"coding": [{"system": "http://terminology.hl7.org/CodeSystem/condition-ver-status", "code": "provisional"}]},
    })

    med = await post_resource(token, "partyA", {
        "resourceType": "Medication",
        "code": {"coding": [{"system": "http://www.whocc.no/atc", "code": "C07AB07", "display": "Bisoprolol (Concor)"}]},
    })

    med2 = await post_resource(token, "partyA", {
        "resourceType": "Medication",
        "code": {"coding": [{"system": "http://www.whocc.no/atc", "code": "C09DX04", "display": "Sacubitril/Valsartan (Entresto)"}]},
    })

    await post_resource(token, "partyA", {
        "resourceType": "MedicationStatement",
        "status": "active",
        "subject": {"reference": f"Patient/{patient_id}"},
        "medicationReference": {"reference": f"Medication/{med.get('id', 'unknown')}"},
        "dosage": [{"text": "2.5mg once daily"}],
    })

    await post_resource(token, "partyA", {
        "resourceType": "MedicationStatement",
        "status": "active",
        "subject": {"reference": f"Patient/{patient_id}"},
        "medicationReference": {"reference": f"Medication/{med2.get('id', 'unknown')}"},
        "dosage": [{"text": "97mg/103mg twice daily"}],
    })

    return {
        "org_id": org.get("id"),
        "practitioner_id": pract.get("id"),
        "patient_id": patient_id,
        "condition_ids": [cond1.get("id"), cond2.get("id")],
    }


async def seed_party_b(token: str):
    print("\n[PartyB] Seeding resources...")

    org = await post_resource(token, "partyB", {
        "resourceType": "Organization",
        "name": "Balgrist — Orthopedics",
        "identifier": [{"system": "urn:umzh-sandbox:party", "value": "partyB"}],
        "type": [{"coding": [{"system": "http://terminology.hl7.org/CodeSystem/organization-type", "code": "prov"}]}],
    })

    pract = await post_resource(token, "partyB", {
        "resourceType": "Practitioner",
        "name": [{"family": "Schmidt", "given": ["Anna"], "prefix": ["Dr. med."]}],
        "identifier": [{"system": "urn:oid:2.51.1.3", "value": "7601000000002"}],
    })

    return {
        "org_id": org.get("id"),
        "practitioner_id": pract.get("id"),
    }


async def main():
    print("UMZH-Connect COW Sandbox — FHIR Seed Script")
    print("=" * 50)

    print("\n[1/4] Setting up HAPI partitions...")
    await setup_partitions()

    print("\n[2/4] Acquiring tokens...")
    try:
        token_a = await get_token(PLACER_CLIENT_ID, PLACER_CLIENT_SECRET)
        print("  + partyA token acquired")
    except Exception as e:
        print(f"  ERROR: partyA token failed: {e}")
        sys.exit(1)

    try:
        token_b = await get_token(FULFILLER_CLIENT_ID, FULFILLER_CLIENT_SECRET)
        print("  + partyB token acquired")
    except Exception as e:
        print(f"  ERROR: partyB token failed: {e}")
        sys.exit(1)

    print("\n[3/4] Seeding partyA...")
    ids_a = await seed_party_a(token_a)

    print("\n[4/4] Seeding partyB...")
    ids_b = await seed_party_b(token_b)

    print("\n" + "=" * 50)
    print("Seed complete!")
    print(f"  partyA patient:       Patient/{ids_a['patient_id']}")
    print(f"  partyA organization:  Organization/{ids_a['org_id']}")
    print(f"  partyA practitioner:  Practitioner/{ids_a['practitioner_id']}")
    print(f"  partyB organization:  Organization/{ids_b['org_id']}")
    print(f"  partyB practitioner:  Practitioner/{ids_b['practitioner_id']}")


if __name__ == "__main__":
    asyncio.run(main())
