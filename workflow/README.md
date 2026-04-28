# Introduction

In this document we specify the essential steps in a clinical order workflow, with the aim to create a specification for a BPM/workflow engine which is triggered when a clinical order workflow is initiated. The BPM is capable of 'listening' to task triggers and in the following executing RESTful API calls with partner institutions including security negotiation. The capabilities inlcude extraction of parameters from previous request responses and the usage of the latters in the following steps, as well as FHIR reference resolution.

# Use cases

Each use case may require a different set of workflow steps and inlcude optional complexity. In this section we try to establish a set of archetype flows that can be reused.

## Simple referral reception

In this case the referrer/placer posts a task to the fulfillers API with a reference to the service request and associated data accessible at the placers API. The task also contains information for the security context to be used during authentication. The fulfiller's workflow is triggered when the task is posted to his API. The relevant steps are:

* Triggering of workflow through task creation. Trigger mechanismn possible through FHIR subscription to task
* Read task from local FHIR store
  - extract security context (consentId) from task 'meta' property
  - extract service request url from 'basedOn' property
* Get access token using client credentials flow with 'private_key_jwt' hardening. consentId is provided as custom param/scope
* Get service request resource from placer API using access token, _id & _include param in order to include referenced resources
* Convert the received previously received servie request and associated ressources to the format of the local target system and POST to the import API, in our case this is the eToC FHIR profile

### Arazzo specification

A draft Arazzo (OpenAPI Workflows) specification for this use case is provided in [simple-referral-reception.arazzo.yaml](simple-referral-reception.arazzo.yaml).

### BPMN 2.0 diagram

The diagram below models the fulfiller-side workflow as a BPMN 2.0 process. It is rendered with Mermaid for direct viewing in the README; the equivalent BPMN 2.0 XML (importable into Camunda / bpmn.io / Signavio) is provided below in a collapsible block.

```mermaid
flowchart LR
    start(["⏱ Task created<br/>(FHIR Subscription)"]):::event
    t1["Read Task<br/>from local FHIR store"]:::task
    t2["Extract consentId<br/>& serviceRequestUrl"]:::task
    t3["Get access token<br/>(client_credentials +<br/>private_key_jwt,<br/>scope=consent:&lt;id&gt;)"]:::task
    t4["GET ServiceRequest<br/>from placer via proxy<br/>(_id, _include)"]:::task
    t5["Convert to eToC<br/>FHIR profile"]:::task
    t6["POST to local<br/>import API"]:::task
    done(["✅ Referral imported"]):::event

    start --> t1 --> t2 --> t3 --> t4 --> t5 --> t6 --> done

    classDef event fill:#fff7d6,stroke:#b58900,stroke-width:1px,color:#222;
    classDef task fill:#e6f1ff,stroke:#1f6feb,stroke-width:1px,color:#222;
```

<details>
<summary>BPMN 2.0 XML (importable)</summary>

```xml
<?xml version="1.0" encoding="UTF-8"?>
<bpmn:definitions xmlns:bpmn="http://www.omg.org/spec/BPMN/20100524/MODEL"
                  xmlns:bpmndi="http://www.omg.org/spec/BPMN/20100524/DI"
                  xmlns:dc="http://www.omg.org/spec/DD/20100524/DC"
                  xmlns:di="http://www.omg.org/spec/DD/20100524/DI"
                  id="Definitions_SimpleReferralReception"
                  targetNamespace="https://umzh.ch/connect/workflow">
  <bpmn:process id="Process_SimpleReferralReception" name="Simple Referral Reception" isExecutable="true">

    <bpmn:startEvent id="StartEvent_TaskCreated" name="Task created (FHIR Subscription)">
      <bpmn:messageEventDefinition id="MessageEventDefinition_TaskCreated"/>
      <bpmn:outgoing>Flow_1</bpmn:outgoing>
    </bpmn:startEvent>

    <bpmn:serviceTask id="Task_ReadTask" name="Read Task from local FHIR store">
      <bpmn:incoming>Flow_1</bpmn:incoming>
      <bpmn:outgoing>Flow_2</bpmn:outgoing>
    </bpmn:serviceTask>

    <bpmn:task id="Task_ExtractContext" name="Extract consentId &amp; serviceRequestUrl">
      <bpmn:incoming>Flow_2</bpmn:incoming>
      <bpmn:outgoing>Flow_3</bpmn:outgoing>
    </bpmn:task>

    <bpmn:serviceTask id="Task_GetAccessToken" name="Get access token (client_credentials + private_key_jwt, scope=consent:&lt;id&gt;)">
      <bpmn:incoming>Flow_3</bpmn:incoming>
      <bpmn:outgoing>Flow_4</bpmn:outgoing>
    </bpmn:serviceTask>

    <bpmn:serviceTask id="Task_GetServiceRequest" name="GET ServiceRequest from placer via proxy (_id, _include)">
      <bpmn:incoming>Flow_4</bpmn:incoming>
      <bpmn:outgoing>Flow_5</bpmn:outgoing>
    </bpmn:serviceTask>

    <bpmn:scriptTask id="Task_Convert" name="Convert to eToC FHIR profile">
      <bpmn:incoming>Flow_5</bpmn:incoming>
      <bpmn:outgoing>Flow_6</bpmn:outgoing>
    </bpmn:scriptTask>

    <bpmn:serviceTask id="Task_Import" name="POST to local import API">
      <bpmn:incoming>Flow_6</bpmn:incoming>
      <bpmn:outgoing>Flow_7</bpmn:outgoing>
    </bpmn:serviceTask>

    <bpmn:endEvent id="EndEvent_Imported" name="Referral imported">
      <bpmn:incoming>Flow_7</bpmn:incoming>
    </bpmn:endEvent>

    <bpmn:sequenceFlow id="Flow_1" sourceRef="StartEvent_TaskCreated"  targetRef="Task_ReadTask"/>
    <bpmn:sequenceFlow id="Flow_2" sourceRef="Task_ReadTask"           targetRef="Task_ExtractContext"/>
    <bpmn:sequenceFlow id="Flow_3" sourceRef="Task_ExtractContext"     targetRef="Task_GetAccessToken"/>
    <bpmn:sequenceFlow id="Flow_4" sourceRef="Task_GetAccessToken"     targetRef="Task_GetServiceRequest"/>
    <bpmn:sequenceFlow id="Flow_5" sourceRef="Task_GetServiceRequest"  targetRef="Task_Convert"/>
    <bpmn:sequenceFlow id="Flow_6" sourceRef="Task_Convert"            targetRef="Task_Import"/>
    <bpmn:sequenceFlow id="Flow_7" sourceRef="Task_Import"             targetRef="EndEvent_Imported"/>

  </bpmn:process>
</bpmn:definitions>
```

</details>