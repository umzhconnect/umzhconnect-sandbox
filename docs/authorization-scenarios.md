# Introduction

When securing cross-domain API calls in the context of UMZH Connect we see the following 3 pattarns that require separate fine-grained authorization:

* Consent-centric requests
* Request for task resourcerces that were authored or assigned to the requesting party
* Request for output resources that are referenced by a given task

We would like to implement an approach where a policy decision/enforcement point (i.e. OPA) as capable of granting access or not, possibly in exchange with the resource store.

In the following a slightly more detailed description of the requirements of each scenario:

## 1. Consent-centric requests

The API consumer provides the context of the request as part of the access token in the form of a dynamic scope where the consentId which is known to the requestor is populated in the token as scope parameter. Authorizing party can extract the consentId and ensure that the requested operation exposes only results allowed by the given consent:

> *Is the consent associated to the requesting client and are the resulting requested resources part of the service request graph?*

## 2. Request for task resourcerces

According to the clinical order workflow the placer (partyA) of a service request will initiate the process by creating a task at fulfiller's (partyB) API. This task should be accessible to partyA for the entire lifetime of the task. Also a task that is assigned to partyA must be accessible to him. Two cases need to be considered:

* How can partyA fetch all tasks that have eighter been created by him or are assigned to him?
* If partyA requests a given resource by id, how does the policy engine enforce that it is part of the previous result set?

## 3. Request for output resources of tasks

In a clinical workflow where the fulfiller produces results (i.e. an appointment, a clinical report etc.) and adds references to these results in the output list of the parent task, we need to ensure that the authorization enforcement checks that the requested resource is referenced by a task where the requestor has access provisioned.
This could be achieved through an additional task centric consent created on the fulfillers side.