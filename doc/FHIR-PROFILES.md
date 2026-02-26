# FHIR Resources & Profiles — UMZH-Connect COW Sandbox

## Base IG

- **FHIR Version:** R4 (4.0.1)
- **UMZH-Connect IG:** https://build.fhir.org/ig/umzhconnect/umzhconnect-ig/
- **CH Core:** https://fhir.ch/ig/ch-core/
- **CH ORF:** https://fhir.ch/ig/ch-orf/

---

## Resources Used

### PartyA (Placer) Resources

#### Patient
**Profile:** CH Core Patient

```json
{
  "resourceType": "Patient",
  "name": [{"family": "Meier", "given": ["Petra"]}],
  "gender": "female",
  "birthDate": "1975-06-15",
  "identifier": [
    {"system": "urn:oid:2.16.756.5.32", "value": "756.1234.5678.09"}
  ],
  "address": [{"city": "Zürich", "country": "CH", "postalCode": "8001"}]
}
```

#### Practitioner
**Profile:** CH Core Practitioner

```json
{
  "resourceType": "Practitioner",
  "name": [{"family": "Muster", "given": ["Hans"], "prefix": ["Dr. med."]}],
  "identifier": [{"system": "urn:oid:2.51.1.3", "value": "7601000000001"}]
}
```

#### Organization
**Profile:** CH Core Organization

```json
{
  "resourceType": "Organization",
  "name": "University Hospital Zurich — Cardiology",
  "identifier": [{"system": "urn:umzh-sandbox:party", "value": "partyA"}],
  "type": [{"coding": [{"code": "prov", "display": "Healthcare Provider"}]}]
}
```

#### Condition (Heart Failure)
```json
{
  "resourceType": "Condition",
  "subject": {"reference": "Patient/{id}"},
  "code": {
    "coding": [{
      "system": "http://snomed.info/sct",
      "code": "84114007",
      "display": "Heart failure (disorder)"
    }]
  },
  "clinicalStatus": {"coding": [{"code": "active"}]},
  "verificationStatus": {"coding": [{"code": "confirmed"}]}
}
```

#### Condition (Suspected ACL Rupture)
```json
{
  "resourceType": "Condition",
  "subject": {"reference": "Patient/{id}"},
  "code": {
    "coding": [{
      "system": "http://snomed.info/sct",
      "code": "444798002",
      "display": "Rupture of anterior cruciate ligament (disorder)"
    }]
  },
  "clinicalStatus": {"coding": [{"code": "active"}]},
  "verificationStatus": {"coding": [{"code": "provisional"}]}
}
```

#### Medication
```json
{
  "resourceType": "Medication",
  "code": {
    "coding": [{
      "system": "http://www.whocc.no/atc",
      "code": "C07AB07",
      "display": "Bisoprolol (Concor)"
    }]
  }
}
```

#### ServiceRequest
**Profile:** UMZH-Connect ServiceRequest (CH ORF-based)

```json
{
  "resourceType": "ServiceRequest",
  "status": "active",
  "intent": "order",
  "priority": "routine",
  "subject": {"reference": "Patient/{id}"},
  "requester": {"reference": "Practitioner/{id}"},
  "performer": [{"reference": "Organization/{id}"}],
  "reasonCode": [{
    "coding": [{
      "system": "http://snomed.info/sct",
      "code": "444798002",
      "display": "Suspected ACL Rupture"
    }]
  }],
  "reasonReference": [{"reference": "Condition/{id}"}]
}
```

#### Consent
**Profile:** FHIR R4 Consent (treatment scope)

```json
{
  "resourceType": "Consent",
  "status": "active",
  "scope": {"coding": [{"code": "treatment"}]},
  "category": [{"coding": [{"system": "http://loinc.org", "code": "59284-0"}]}],
  "patient": {"reference": "Patient/{id}"},
  "performer": [{"reference": "Organization/{partyB-org-id}"}],
  "sourceReference": {"reference": "ServiceRequest/{id}"},
  "provision": {
    "type": "permit",
    "actor": [{
      "role": {"coding": [{"code": "PRCP"}]},
      "reference": {"reference": "Organization/{partyB-org-id}"}
    }],
    "data": [{
      "meaning": "related",
      "reference": {"reference": "ServiceRequest/{id}"}
    }]
  }
}
```

---

### PartyB (Fulfiller) Resources

#### Task
**Profile:** UMZH-Connect Task

```json
{
  "resourceType": "Task",
  "status": "requested",
  "intent": "order",
  "priority": "routine",
  "focus": {"reference": "ServiceRequest/{partyA-sr-id}"},
  "requester": {"reference": "Organization/{partyA-org-id}"},
  "owner": {"reference": "Organization/{partyB-org-id}"},
  "input": [{
    "type": {"coding": [{"code": "sourceServiceRequest"}]},
    "valueReference": {"reference": "ServiceRequest/{partyA-sr-id}"}
  }]
}
```

Task status progression:
- `requested` → `accepted` → `in-progress` → `completed`
- or → `rejected` / `cancelled`

#### Appointment (Output)
```json
{
  "resourceType": "Appointment",
  "status": "booked",
  "serviceType": [{"coding": [{"code": "56"}]}],
  "participant": [
    {"actor": {"reference": "Patient/{id}"}, "required": "required", "status": "accepted"},
    {"actor": {"reference": "Practitioner/{partyB-pract-id}"}, "required": "required", "status": "accepted"}
  ],
  "start": "2025-04-01T09:00:00+01:00",
  "end": "2025-04-01T09:30:00+01:00"
}
```

---

## SMART on FHIR Scopes

| Scope | Description |
|---|---|
| `system/Patient.r` | Read Patient |
| `system/ServiceRequest.cruds` | Create/Read/Update/Delete/Search ServiceRequest |
| `system/Consent.cruds` | Full Consent access |
| `system/Task.cruds` | Full Task access |
| `system/Condition.r` | Read Condition |
| `system/Medication.r` | Read Medication |
| `system/MedicationStatement.r` | Read MedicationStatement |
| `system/Practitioner.r` | Read Practitioner |
| `system/Organization.r` | Read Organization |
| `system/Appointment.cruds` | Full Appointment access |

---

## HAPI FHIR Partitioning

The sandbox uses a single HAPI FHIR instance with server-side partitioning:

| Partition | Name | Party | Prefix Header |
|---|---|---|---|
| 1 | `partyA` | Placer | `X-HAPI-Partition-Name: partyA` |
| 2 | `partyB` | Fulfiller | `X-HAPI-Partition-Name: partyB` |

Cross-partition reads are mediated by the FastAPI backend + KrakenD,
ensuring consent-based access control via OPA.
