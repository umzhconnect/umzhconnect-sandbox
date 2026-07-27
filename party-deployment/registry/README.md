# registry — mCSD provider/endpoint directory

The **public, read-only mCSD directory** for the ecosystem: the `Organization`,
`Endpoint` and `HealthcareService` records that let parties discover each other's
FHIR endpoints. This folder is self-contained — it holds its Kubernetes manifests
**and** the assets docker compose consumes, so one set of files drives both.

## Architecture

The registry is **not a separate FHIR server**. It's the `registry` partition of
the shared base HAPI (in the `hapi-fhir` namespace), fronted by a thin nginx proxy
that makes it look like a standalone, partition-less, read-only endpoint:

```
  WAF (registry.umzhconnect.ch, TLS)
    → nginx ingress (registry.dev.umzhc.io.usz.ch)
      → registry-fhir proxy  ── read-only allowlist + canonical-URL rewrite
        → base HAPI  /fhir/registry/*   (namespace hapi-fhir, ClusterIP only)

  registry-seed (one-shot)  ── writes directly to the base, bypassing the proxy
```

The proxy does three things (see `registry-proxy.conf.template`):

1. **Partition hiding** — inbound `/fhir/*` is rewritten onto the base's
   `/fhir/registry/*`; the partition segment is stripped back out of responses,
   so `registry` never appears in an outward URL.
2. **Canonical URL** — HAPI's self-links (`Bundle.link`, `entry.fullUrl`,
   `Location`) are rewritten to `PROXY_OUTWARD_URL`, which is sourced from the
   single canonical `REGISTRY_URL` (see [Configuration](#configuration)). The
   internal ingress/upstream host is never emitted.
3. **Read-only allowlist** — only `GET`/`HEAD` on `Organization`, `Endpoint`,
   `HealthcareService` (+ `/metadata`) pass; every write and every other type is
   `403` at the edge. (Deeper WAF/hardening notes: `waf-hardening-registry.md`.)

The directory content is managed **declaratively**: every seed run **wipes then
reloads** the partition from `registry-bundle.json` (a FHIR transaction of
conditional deletes, then a load), so entries removed from git also disappear from
the server. This is the bootstrap-phase reconciler — idempotent, safe to re-run.

### Files

| File | Role | Used by |
|---|---|---|
| `registry-bundle.json` | The mCSD directory content (USZ + Balgrist orgs, their endpoints & services). Only `__REGISTRY_URL__` is a placeholder; endpoint addresses are hardcoded to the partners' real APIs. | compose seed + k8s Job (as a ConfigMap) |
| `seed-registry.sh` | Create the `registry` partition → purge → load the bundle. Busybox/curl-only, non-root. | compose seed + k8s Job |
| `registry-proxy.conf.template` | nginx `conf.d` fragment: partition rewrite, canonical-URL `sub_filter`/`proxy_redirect`, read-only allowlist. Rendered by the nginx image's envsubst. | compose proxy + k8s proxy (as a ConfigMap) |
| `registry-proxy.yaml` | k8s Deployment + `registry-fhir-service`. |  k8s |
| `registry-ingress.yaml` | k8s Ingress (host + TLS). | k8s |
| `registry-seed.yaml` | k8s Job + the `party-urls` ConfigMap (holds `REGISTRY_URL`). | k8s |
| `ns-registry.yaml`, `kustomization.yaml` | k8s namespace + kustomize entrypoint. | k8s |

## Configuration

**One canonical value — `REGISTRY_URL`** — is the registry's public base URL (no
trailing `/fhir`). It is the single source of truth: the proxy advertises it in
rewritten self-links (`PROXY_OUTWARD_URL`) **and** the seed bakes it into stored
cross-references (`__REGISTRY_URL__`), so self-links and references never diverge.
Set it to the public host (e.g. `https://registry.umzhconnect.ch`) — never the
internal ingress host; the WAF/ingress stay pure transport.

| Setting | compose | k8s |
|---|---|---|
| Canonical URL | `.env` `REGISTRY_URL` | `party-urls` ConfigMap `REGISTRY_URL` (in `registry-seed.yaml`) |
| Proxy outward URL | `PROXY_OUTWARD_URL: ${REGISTRY_URL}` | `PROXY_OUTWARD_URL` ← `configMapKeyRef: party-urls.REGISTRY_URL` |
| Base HAPI upstream | `.env` `HAPI_BASE_UPSTREAM` (`hapi-fhir:8080`) | `hapi-fhir-service.hapi-fhir.svc.cluster.local:8080` (in the manifests) |

## docker-compose

Two services in the party `docker-compose.yml`:

| Service | Image | What |
|---|---|---|
| `registry-fhir` | `nginx:alpine` | The proxy. Mounts `registry-proxy.conf.template` at `/etc/nginx/templates/`; the nginx image renders it from `PROXY_UPSTREAM` + `PROXY_OUTWARD_URL` on start. Published on `${REGISTRY_FHIR_PORT}` (default 9084). |
| `registry-seed` | `alpine:3.19` (+ `apk add curl`) | One-shot: runs `seed-registry.sh` against the base HAPI. |

**Configure** (`.env`, copied from `.env.example`):

```bash
REGISTRY_URL=http://localhost:9084     # canonical URL — dev default; prod: https://registry.umzhconnect.ch
REGISTRY_FHIR_PORT=9084                # host port the proxy is published on (must match REGISTRY_URL's host:port)
HAPI_BASE_UPSTREAM=hapi-fhir:8080      # the base HAPI compose service
```

**Run** (from `party-deployment/`, brings up the base HAPI + DB it depends on):

```bash
cp .env.example .env      # then edit REGISTRY_URL for your environment
docker compose up -d --build hapi-fhir registry-fhir registry-seed

curl http://localhost:9084/fhir/Organization        # partition-less, read-only
curl http://localhost:9084/fhir/metadata
```

Re-running `docker compose up registry-seed` reconciles the directory (wipe +
reload) after editing `registry-bundle.json`.

## Kubernetes

Namespace **`umzhc-registry`**. Apply with kustomize; the folder is self-contained
(generates its own ConfigMaps from the colocated shared files):

```bash
kubectl apply -k party-deployment/registry/      # preview: kubectl kustomize party-deployment/registry/
```

> **Depends on the base HAPI.** The proxy and seed Job target
> `hapi-fhir-service.hapi-fhir.svc.cluster.local:8080`, so the `hapi-fhir/` stack
> must be deployed first (or together).

Resources produced:

| Resource | Notes |
|---|---|
| `Namespace umzhc-registry` | — |
| `Deployment registry-fhir` + `Service registry-fhir-service` | Image `nginxinc/nginx-unprivileged` (non-root UID 101, `restricted` PSS). `PROXY_OUTWARD_URL` from `party-urls.REGISTRY_URL`. Mounts the generated `registry-proxy-tpl` ConfigMap. |
| `Ingress registry-ingress` | Host `registry.dev.umzhc.io.usz.ch`, path `/fhir` → `registry-fhir-service:8080`, cert-manager TLS (`clusterissuer-acme-nginx`). |
| `Job registry-seed` | Image `curlimages/curl` (non-root UID 100, `restricted` PSS). `FHIR_BASE` → base HAPI FQDN; `REGISTRY_URL` via `envFrom: party-urls`. |
| `ConfigMap party-urls` | Holds `REGISTRY_URL` — consumed by both the proxy and the seed. |
| Generated: `registry-proxy-tpl`, `registry-seed` | From the shared `*.conf.template` / `seed-registry.sh` + `registry-bundle.json` (`configMapGenerator`, stable names). |

**Configure:** edit `REGISTRY_URL` in the `party-urls` ConfigMap (in
`registry-seed.yaml`) and the ingress host in `registry-ingress.yaml`.

**Deployment notes:**
- `party-urls` and the generated ConfigMaps use stable names (`disableNameSuffixHash`).
  Env is read at pod start, so after changing `REGISTRY_URL` do
  `kubectl -n umzhc-registry rollout restart deploy/registry-fhir` (the seed Job
  re-runs on its own).
- The seed is a `Job`; to reconcile after editing the bundle, re-apply and
  delete/re-run the Job (or bump it), since a completed Job won't re-run on a
  no-op apply.
- Read-only is **edge** policy. The base HAPI stays writable (that's how the seed
  loads it) — keep it off the public internet / restrict who can reach
  `hapi-fhir-service` (NetworkPolicy) so the writable base isn't a back door.
