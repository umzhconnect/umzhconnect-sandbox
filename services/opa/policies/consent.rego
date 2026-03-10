# =============================================================================
# UMZH Connect Sandbox - Consent Evaluation Policies
# =============================================================================
# Specialized consent evaluation logic for the clinical order workflow.
# Evaluates whether requested resources are part of the ServiceRequest graph.
# =============================================================================

package umzh.consent

import rego.v1

# ---------------------------------------------------------------------------
# Evaluate if a resource reference is within a ServiceRequest's resource graph
# ---------------------------------------------------------------------------

# Input:
# {
#   "service_request": {
#     "id": "ReferralOrthopedicSurgery",
#     "subject": { "reference": "Patient/PetraMeier" },
#     "requester": { "reference": "PractitionerRole/HansMusterRole" },
#     "reasonReference": [
#       { "reference": "Condition/SuspectedACLRupture" }
#     ],
#     "supportingInfo": [
#       { "reference": "Condition/HeartFailureHFrEF" },
#       { "reference": "MedicationStatement/MedicationEntresto" },
#       { "reference": "MedicationStatement/MedicationConcor" },
#       { "reference": "DocumentReference/DocCardiologyAttachment" }
#     ],
#     "insurance": [
#       { "reference": "Coverage/CoverageMeier" }
#     ]
#   },
#   "requested_resource": "Patient/PetraMeier"
# }

default in_graph := false

# Build the complete set of resource references in the ServiceRequest graph
graph_references contains ref if {
    ref := input.service_request.subject.reference
}

graph_references contains ref if {
    ref := input.service_request.requester.reference
}

graph_references contains ref if {
    some reason_ref in input.service_request.reasonReference
    ref := reason_ref.reference
}

graph_references contains ref if {
    some support_ref in input.service_request.supportingInfo
    ref := support_ref.reference
}

graph_references contains ref if {
    some insurance_ref in input.service_request.insurance
    ref := insurance_ref.reference
}

# The ServiceRequest itself is in its own graph
graph_references contains ref if {
    ref := concat("/", ["ServiceRequest", input.service_request.id])
}

# Check if the requested resource is in the graph
in_graph if {
    input.requested_resource in graph_references
}

# Return the full graph for debugging/logging
result := {
    "in_graph": in_graph,
    "requested_resource": input.requested_resource,
    "graph_size": count(graph_references),
    "graph_references": graph_references,
}
