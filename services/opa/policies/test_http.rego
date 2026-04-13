package test_http

import rego.v1

result := resp if {
    resp := http.send({
        "method": "GET",
        "url": "http://hapi-fhir:8080/fhir/placer/Consent/ConsentOrthopedicReferral",
        "headers": {"Accept": "application/fhir+json"},
        "force_json_decode": true
    })
}
