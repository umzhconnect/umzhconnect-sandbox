This maps well onto IHE mCSD (mobile Care Services Discovery) — Organization/Endpoint/HealthcareService is exactly that resource triad, so if this is the Swiss provider/endpoint directory pattern, worth confirming you're aligning with the mCSD actor definitions since that shapes which search params and interactions are actually expected. Either way, here's the hardening approach:

**1. Path and verb allowlist**

Since this is read-only reference data:
- `GET /fhir/metadata` (CapabilityStatement) — allow, but consider whether you want it public; it discloses your exact supported search params and operations to anyone probing
- `GET /fhir/Organization`, `/fhir/Organization/{id}`
- `GET /fhir/Endpoint`, `/fhir/Endpoint/{id}`
- `GET /fhir/HealthcareService`, `/fhir/HealthcareService/{id}`
- Block everything else explicitly: no POST/PUT/PATCH/DELETE on any path (unless you have a separate, non-public ingestion pipeline — which should live behind different auth entirely), no `$everything`, no `$export`, no `_history`, no batch/transaction Bundle POSTs, no other resource types even if the server technically supports them

If you support POST-based search (`POST /fhir/Organization/_search`), treat the body with the same search-parameter validation as query strings below — don't let it bypass query-string rules just because it's in the body.

**2. Search parameter allowlisting**

Enumerate exactly which search params are valid per resource type and reject unknown ones rather than passing them through:
- `Organization`: `name`, `identifier`, `address`, `type`, `active`, `partof`
- `Endpoint`: `organization`, `status`, `connection-type`, `identifier`
- `HealthcareService`: `organization`, `service-type`, `active`, `location`

Common params to allow narrowly: `_id`, `_count` (capped — see below), `_elements`, `_summary`, `_format`, `_sort`.

Common params to block or heavily restrict:
- `_include` / `_revinclude` — these are the main DoS/over-fetch vector on a registry; either disable entirely or allowlist specific chains (e.g. `Endpoint:organization`) rather than allowing arbitrary `_include=*`
- `_filter` — this is a FHIRPath-like expression language; it's powerful enough to be a real injection/DoS surface and most registries don't need it. Disable unless you have a specific reason.
- Chained parameters (`organization.name=...`) — validate against a fixed set of allowed chains rather than passing arbitrary dot-chains through, since these translate into joins/subqueries server-side

**3. Result size / pagination caps**

- Enforce a hard max on `_count` (e.g., 50–100) regardless of what the client requests
- Cap total response size at the WAF/proxy layer as a backstop against unbounded result sets
- If bulk consumption is a legitimate use case, provide a proper `$export`-style bulk endpoint with its own stricter auth/rate limits rather than letting people paginate the whole registry through the normal search API

**4. Rate limiting and scraping protection**

This is the main risk profile for a public, unauthenticated (or lightly authenticated) reference registry — not injection, but bulk harvesting:
- Rate-limit per source IP on both search and by-ID reads
- Specifically watch `GET /Endpoint/{id}` and `GET /Organization/{id}` for sequential-ID enumeration patterns (even if IDs aren't sequential UUIDs, pattern/velocity detection catches scripted crawls)
- Consider a lower, separate threshold for search requests with broad/empty query params (`GET /Organization?` with no filters) vs. targeted lookups — broad unfiltered queries are the expensive ones and the most likely to be scraping rather than legitimate lookups

**5. Content type and format restrictions**

- Only accept `Accept: application/fhir+json`
- Restrict `_format` param to the same allowed set — don't let it be used to smuggle a different parser path

**6. WAF rule tuning for FHIR-shaped values**

Generic SQLi/XSS rulesets will false-positive on legitimate FHIR data:
- Identifier values often contain `system|value` pipe-delimited URIs (e.g. `https://fhir.ch/sid/...|123456`) — colons, slashes, pipes in query params are normal here, not injection
- Names with apostrophes (O'Brien-style) trip naive SQLi quote-detection
- Scope exclusions for these should be tied to the specific search-param names above, not a blanket rule disable

**7. CORS**

If this registry is meant to be called directly from browser-based apps, set an explicit origin allowlist rather than `*`.

**8. Headers**

- `X-Content-Type-Options: nosniff`
- Strip inbound `X-Forwarded-*` and set your own if the FHIR server constructs any self-referencing `fullUrl`/`Bundle.link` values from forwarded headers — otherwise header injection here can poison the pagination links or self-links returned in Bundles
- No caching headers that would let intermediate caches serve stale organization/endpoint data past your actual update cadence, if endpoint URLs change

**9. Logging**

Log source IP, resource type, search params (not full query strings blindly, to avoid logging anything sensitive if params ever expand), and response size per request — the anomaly signal you care about here is volume/pattern (scraping) rather than payload-based attack signatures, since there's no auth flow or write path to exploit.

One thing worth deciding upfront: is this registry meant to be genuinely public/anonymous, or should it sit behind at least an API key even though the data itself isn't patient-sensitive? Given that `Endpoint` resources tell callers *where* to send FHIR requests for actual clinical data, keeping tight control over who can bulk-harvest that list (even without formal auth) is worth it just to limit reconnaissance value for anyone mapping out your healthcare network's attack surface.