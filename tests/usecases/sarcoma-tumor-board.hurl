# --- Placer client_credentials ---
POST {{keycloak_url}}/realms/umzh-connect/protocol/openid-connect/token
[FormParams]
grant_type: client_credentials
client_id: {{placer_client_id}}
client_secret: {{placer_client_secret}}
HTTP 200
[Captures]
placer_cc_token: jsonpath "$.access_token"

# --- Fulfiller client_credentials ---
POST {{keycloak_url}}/realms/umzh-connect/protocol/openid-connect/token
[FormParams]
grant_type: client_credentials
client_id: {{fulfiller_client_id}}
client_secret: {{fulfiller_client_secret}}
HTTP 200
[Captures]
fulfiller_cc_token: jsonpath "$.access_token"

# We expect the Patient (PetraMeier) to already exist

# --- Create the main Condition
POST {{placer_int_url}}/fhir/Condition
Authorization: Bearer {{placer_cc_token}}
Content-Type: application/fhir+xml
<Condition xmlns="http://hl7.org/fhir">
  <id value="SarcomaKnee"/>
  <meta>
    <profile value="http://fhir.ch/ig/ch-etoc/StructureDefinition/ch-etoc-primary-diagnosis"/>
  </meta>
  <category>
    <coding>
      <system value="http://fhir.ch/ig/ch-etoc/CodeSystem/ch-etoc-conditioncategory"/>
      <code value="primary-diagnosis"/>
    </coding>
  </category>
  <code>
    <text value="Synovial sarcoma of the right knee"/>
  </code>
  <subject>
    <reference value="Patient/PetraMeier"/>
  </subject>
  <note>
    <text value="- Histologically confirmed synovial sarcoma."/>
  </note>
</Condition>
HTTP 201
[Captures]
condition_id: header "Location" regex ".*/Condition/([^/_?]+).*"

# --- Create an AllergyIntolerance
POST {{placer_int_url}}/fhir/AllergyIntolerance
Authorization: Bearer {{placer_cc_token}}
Content-Type: application/fhir+xml
<AllergyIntolerance xmlns="http://hl7.org/fhir">
  <id value="AllergyGado"/>
  <meta>
    <profile value="http://fhir.ch/ig/ch-core/StructureDefinition/ch-core-allergyintolerance"/>
  </meta>
  <clinicalStatus>
    <coding>
      <system
              value="http://terminology.hl7.org/CodeSystem/allergyintolerance-clinical"/>
      <code value="active"/>
      <display value="Active"/>
    </coding>
  </clinicalStatus>
  <type value="allergy"/>
  <category value="medication"/>
  <code>
    <text value="Komplexbildner-Allergie (Gadotersäure-Typ)"/>
  </code>
  <patient>
    <reference value="Patient/PetraMeier"/>
  </patient>
</AllergyIntolerance>
HTTP 201
[Captures]
allergy_id: header "Location" regex ".*/AllergyIntolerance/([^/_?]+).*"

# --- Create an imaging CT
POST {{placer_int_url}}/fhir/ImagingStudy
Authorization: Bearer {{placer_cc_token}}
Content-Type: application/fhir+xml
<ImagingStudy xmlns="http://hl7.org/fhir">
  <id value="ImagingCT"/>
  <identifier>
    <use value="official"/>
    <system value="urn:dicom:uid"/>
    <value value="urn:oid:1.2.4.7.6.1.35921.32671128.2255.7333"/>
  </identifier>
  <status value="available"/>
  <modality>
    <system value="http://dicom.nema.org/resources/ontology/DCM"/>
    <code value="CT"/>
  </modality>
  <subject>🔗
    <reference value="Patient/PetraMeier"/>
  </subject>
  <started value="2025-12-18"/>
  <numberOfSeries value="1"/>
  <description value="CT Scan Right Knee"/>
</ImagingStudy>
HTTP 201
[Captures]
imaging_ct_id: header "Location" regex ".*/ImagingStudy/([^/_?]+).*"

# --- Create an imaging PET
POST {{placer_int_url}}/fhir/ImagingStudy
Authorization: Bearer {{placer_cc_token}}
Content-Type: application/fhir+xml
<ImagingStudy xmlns="http://hl7.org/fhir">
  <id value="ImagingPET"/>
  <identifier>
    <use value="official"/>
    <system value="urn:dicom:uid"/>
    <value value="urn:oid:1.3.6.1.7.1.34920.32661028.1144.8635"/>
  </identifier>
  <status value="available"/>
  <modality>
    <system value="http://dicom.nema.org/resources/ontology/DCM"/>
    <code value="PT"/>
  </modality>
  <subject>
    <reference value="Patient/PetraMeier"/>
  </subject>
  <started value="2026-01-18"/>
  <numberOfSeries value="3"/>
  <description value="While Body PET (external)"/>
</ImagingStudy>
HTTP 201
[Captures]
imaging_pet_id: header "Location" regex ".*/ImagingStudy/([^/_?]+).*"

# --- Create a ServiceRequest
POST {{placer_int_url}}/fhir/ServiceRequest
Authorization: Bearer {{placer_cc_token}}
Content-Type: application/fhir+xml
```
<ServiceRequest xmlns="http://hl7.org/fhir">
  <id value="ReferralTumorboard"/>
  <meta>
    <profile value="http://fhir.ch/ig/ch-umzh-connect/StructureDefinition/ch-umzh-connect-servicerequest"/>
  </meta>
  <identifier>
    <type>
      <coding>
        <system value="http://terminology.hl7.org/CodeSystem/v2-0203"/>
        <code value="PLAC"/>
      </coding>
    </type>
    <value value="REF-2025-002"/>
  </identifier>
  <status value="active"/>
  <intent value="order"/>
  <category>
    <coding>
      <system value="http://snomed.info/sct"/>
      <code value="720006006"/>
      <display value="Cancer care review (procedure)"/>
    </coding>
  </category>
  <subject>
    <reference value="Patient/PetraMeier"/>
  </subject>
  <authoredOn value="2026-01-26"/>
  <requester>
    <reference value="PractitionerRole/HansMusterRole"/>
  </requester>
  <reasonReference>
    <reference value="Condition/{{condition_id}}"/>
  </reasonReference>
  <supportingInfo>
    <reference value="AllergyIntolerance/{{allergy_id}}"/>
  </supportingInfo>
  <supportingInfo>
    <reference value="ImagingStudy/{{imaging_ct_id}}"/>
  </supportingInfo>
  <supportingInfo>
    <reference value="ImagingStudy/{{imaging_pet_id}}"/>
  </supportingInfo>
  <note>
    <text value="Review therapy recommendations."/>
  </note>
</ServiceRequest>
```
HTTP 201
[Captures]
service_request_id: header "Location" regex ".*/ServiceRequest/([^/_?]+).*"

# --- Create a Consent for the ServiceRequest
POST {{placer_int_url}}/fhir/Consent
Authorization: Bearer {{placer_cc_token}}
Content-Type: application/fhir+json
{
  "resourceType": "Consent",
  "status": "active",
  "provision": {
    "period": {"end": "2030-12-31"},
    "actor": [
      {
        "reference": {"reference": "{{registry_url}}/fhir/Organization/HospitalF"}
      }
    ],
    "data": [
      {
        "meaning": "related",
        "reference": {"reference": "ServiceRequest/{{service_request_id}}"}
      }
    ]
  }
}
HTTP 201

# --- Then the Placer can submit a Task to the Fulfiller
POST {{fulfiller_ext_url}}/fhir/Task
Authorization: Bearer {{placer_cc_token}}
Content-Type: application/fhir+xml
```
<Task xmlns="http://hl7.org/fhir">
  <id value="TaskReferralTumorboard"/>
  <meta>
    <profile value="http://fhir.ch/ig/ch-umzh-connect/StructureDefinition/ch-umzh-connect-coordinationtask"/>
  </meta>
  <identifier>
    <system value="urn:ietf:rfc:3986"/>
    <value value="urn:uuid:a8b9cb16-aaaa-aaaa-aaaa-33f0c5858097"/>
  </identifier>
  <status value="requested"/>
  <intent value="order"/>
  <priority value="routine"/>
  <code>
    <coding>
      <system value="http://hl7.org/fhir/CodeSystem/task-code"/>
      <code value="fulfill"/>
      <display value="Fulfill the focal request"/>
    </coding>
  </code>
  <focus>
    <reference value="{{placer_ext_url}}/fhir/ServiceRequest/{{service_request_id}}"/>
  </focus>
  <for>
    <reference value="{{placer_ext_url}}/fhir/Patient/PetraMeier"/>
  </for>
  <authoredOn value="2026-07-07"/>
  <requester>
    <reference value="{{registry_url}}/fhir/Organization/HospitalP"/>
  </requester>
  <owner>
    <reference value="{{registry_url}}/fhir/Organization/HospitalF"/>
  </owner>
</Task>
```
HTTP 201
[Captures]
task_id: header "Location" regex ".*/Task/([^/_?]+).*"

# --- The fulfiller automatically grants access to the Placer

POST {{fulfiller_int_url}}/fhir/Consent
Authorization: Bearer {{fulfiller_cc_token}}
Content-Type: application/fhir+json
{
  "resourceType": "Consent",
  "status": "active",
  "provision": {
    "period": {"end": "2030-12-31"},
    "actor": [
      {
        "reference": {"reference": "{{registry_url}}/fhir/Organization/HospitalP"}
      }
    ],
    "data": [
      {
        "meaning": "related",
        "reference": {"reference": "Task/{{task_id}}"}
      }
    ]
  }
}
HTTP 201

# --- The fulfiller logs in in the context of that ServiceRequest ---

POST {{keycloak_url}}/realms/umzh-connect/protocol/openid-connect/token
[FormParams]
grant_type: client_credentials
client_id: {{fulfiller_client_id}}
client_secret: {{fulfiller_client_secret}}
authorization_details: [{"type":"umzh-connect-context","identifier":"ServiceRequest/{{service_request_id}}"}]
HTTP 200
[Captures]
fulfiller_context_token: jsonpath "$.access_token"

# --- The fulfiller has access to the ServiceRequest and the related resources
GET {{placer_ext_url}}/fhir/ServiceRequest?_id={{service_request_id}}&_include=ServiceRequest:patient&_include=ServiceRequest:subject&_include=ServiceRequest:requester&_include=ServiceRequest:reason-reference&_include=ServiceRequest:supporting-info&_include=ServiceRequest:insurance
Authorization: Bearer {{fulfiller_context_token}}
HTTP 200
[Asserts]
body contains "ServiceRequest/{{service_request_id}}"
body contains "Condition/{{condition_id}}"
body contains "AllergyIntolerance/{{allergy_id}}"
body contains "ImagingStudy/{{imaging_ct_id}}"
body contains "ImagingStudy/{{imaging_pet_id}}"

# --- The fulfiller can complete the Task
PATCH {{fulfiller_int_url}}/fhir/Task/{{task_id}}
Authorization: Bearer {{fulfiller_context_token}}
Content-Type: application/json-patch+json
[
  {
    "op": "replace",
    "path": "/status",
    "value": "completed"
  }
]
HTTP 200

# --- The placer logs in in the context of that Task ---

POST {{keycloak_url}}/realms/umzh-connect/protocol/openid-connect/token
[FormParams]
grant_type: client_credentials
client_id: {{placer_client_id}}
client_secret: {{placer_client_secret}}
authorization_details: [{"type":"umzh-connect-context","identifier":"Task/{{task_id}}"}]
HTTP 200
[Captures]
placer_context_token: jsonpath "$.access_token"

POST {{keycloak_url}}/realms/umzh-connect/protocol/openid-connect/token/introspect
[FormParams]
token: {{placer_context_token}}
client_id: {{placer_client_id}}
client_secret: {{placer_client_secret}}
HTTP 200

# --- The placer can read the Task and see it completed
GET {{fulfiller_ext_url}}/fhir/Task?_id={{task_id}}
Authorization: Bearer {{placer_context_token}}
HTTP 200
[Asserts]
body contains "Task/{{task_id}}"
body contains "completed"