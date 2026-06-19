# Deployment Guide — UMZH Connect Sandbox on Infomaniak VPS

This guide covers deploying the full two-party sandbox to an Ubuntu VPS at
Infomaniak with Caddy as the TLS-terminating reverse proxy.

## Subdomain plan

The browser SPA makes direct calls to both the internal and external APISIX
gateways for each party, so seven public subdomains are required (you specified
four — the three gateway subdomains below are the additional ones needed):

| Subdomain | Service | Local port |
|-----------|---------|-----------|
| `sandbox.umzh-connect.ch` | Web app (SPA) | 3000 |
| `auth.sandbox.umzh-connect.ch` | Keycloak | 8180 |
| `registry.sandbox.umzh-connect.ch` | Registry (public mCSD, no auth) | 8084 |
| `placer.sandbox.umzh-connect.ch` | Placer external gateway (cross-party) | 8081 |
| `placer-int.sandbox.umzh-connect.ch` | Placer internal gateway (own-party FHIR) | 8080 |
| `fulfiller.sandbox.umzh-connect.ch` | Fulfiller external gateway (cross-party) | 8083 |
| `fulfiller-int.sandbox.umzh-connect.ch` | Fulfiller internal gateway (own-party FHIR) | 8082 |

## 1. DNS

At Infomaniak's DNS console for `umzh-connect.ch`, create an A record for each
subdomain pointing to the VPS public IP. A wildcard covers all seven with a
single record:

```
*.sandbox    A    <VPS_PUBLIC_IP>    TTL 300
sandbox      A    <VPS_PUBLIC_IP>    TTL 300
```

Verify before continuing:

```bash
dig +short sandbox.umzh-connect.ch
dig +short auth.sandbox.umzh-connect.ch
```

## 2. VPS provisioning

Tested on Ubuntu 22.04 LTS. Minimum recommended: 4 vCPU, 8 GB RAM, 40 GB SSD.

### Install Docker

```bash
curl -fsSL https://get.docker.com | sh
sudo usermod -aG docker $USER
# Log out and back in so group membership takes effect
```

### Install Caddy

```bash
sudo apt install -y debian-keyring debian-archive-keyring apt-transport-https curl
curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/gpg.key' \
  | sudo gpg --dearmor -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt' \
  | sudo tee /etc/apt/sources.list.d/caddy-stable.list
sudo apt update && sudo apt install caddy
```

### Open firewall ports

```bash
sudo ufw allow 22/tcp    # SSH
sudo ufw allow 80/tcp    # HTTP (Caddy ACME challenge + redirect)
sudo ufw allow 443/tcp   # HTTPS
sudo ufw enable
```

## 3. Clone the repository

```bash
cd /opt
sudo git clone <repo-url> umzhconnect-sandbox
sudo chown -R $USER:$USER umzhconnect-sandbox
cd umzhconnect-sandbox
```

## 4. Environment configuration

### 4a. Create `.env`

Copy the production template and fill in strong passwords/secrets:

```bash
cp deployment/.env.prod.example .env
nano .env   # replace all <CHANGE_ME> values
```

Key values that differ from local dev:

```dotenv
VITE_KEYCLOAK_URL=https://auth.sandbox.umzh-connect.ch
VITE_PLACER_URL=https://placer-int.sandbox.umzh-connect.ch
VITE_PLACER_EXTERNAL_URL=https://placer.sandbox.umzh-connect.ch
VITE_FULFILLER_URL=https://fulfiller-int.sandbox.umzh-connect.ch
VITE_FULFILLER_EXTERNAL_URL=https://fulfiller.sandbox.umzh-connect.ch
VITE_REGISTRY_URL=https://registry.sandbox.umzh-connect.ch
```

The `seed-loader` and `reseed-api` read the `VITE_*_EXTERNAL_URL` variables at
start-up to embed the correct absolute references in FHIR resources (Organization
cross-references, Task.requester, etc.). They must be the public HTTPS URLs.

### 4b. nginx-proxy self-link rewriting — no action needed

`services/nginx-proxy/templates/servers.conf.template` uses `${VITE_*}` placeholders
that are resolved by `envsubst` when the container starts. The `VITE_*` values you
set in `.env` above are passed automatically to the nginx-proxy container via
`docker-compose.yml`, so self-link rewriting uses the correct public HTTPS URLs
without any file edits.

### 4c. Keycloak client URIs — no action needed

`services/keycloak/realm-export.json` already includes both `localhost` and
`https://sandbox.umzh-connect.ch` in `redirectUris` and `webOrigins` for all
clients. No modification is required at deploy time.

## 5. Caddy configuration

Copy the Caddyfile to the system location and reload:

```bash
sudo cp deployment/Caddyfile /etc/caddy/Caddyfile
sudo caddy validate --config /etc/caddy/Caddyfile
sudo systemctl reload caddy
```

Caddy will obtain a Let's Encrypt certificate for each subdomain on first
request. Ensure DNS is resolving to the VPS before reloading Caddy.

## 6. Start the stack

Use the production compose overlay which sets the public Keycloak hostname and
the correct `private_key_jwt` audience for the key custodians:

```bash
docker compose \
  -f docker-compose.yml \
  -f deployment/docker-compose.prod.yml \
  up -d --build
```

Watch for readiness:

```bash
docker compose logs -f keycloak      # wait for "Started Keycloak"
docker compose logs -f seed-loader   # wait for "Seed complete"
docker compose logs -f web-app       # wait for nginx to start
```

## 7. Verify the deployment

### Keycloak discovery endpoint

```bash
curl -s https://auth.sandbox.umzh-connect.ch/realms/umzh-connect/.well-known/openid-configuration \
  | python3 -m json.tool | grep issuer
# Should print: "issuer": "https://auth.sandbox.umzh-connect.ch/realms/umzh-connect"
```

### Registry (public, no auth)

```bash
curl -s https://registry.sandbox.umzh-connect.ch/fhir/Organization \
  | python3 -m json.tool | grep '"resourceType"'
# Should print: "resourceType": "Bundle"
```

### FHIR gateway health

```bash
curl -s https://placer.sandbox.umzh-connect.ch/__health
curl -s https://placer-int.sandbox.umzh-connect.ch/__health
curl -s https://fulfiller.sandbox.umzh-connect.ch/__health
curl -s https://fulfiller-int.sandbox.umzh-connect.ch/__health
# Each should return: {"status":"ok"}
```

### Web app

Open `https://sandbox.umzh-connect.ch` in a browser, log in as
`placer-user / placer123`, and confirm the dashboard loads FHIR data.

### Integration tests (from a machine with Hurl installed)

The test scripts can target the VPS. Export the public base URLs and run:

```bash
export PLACER_TOKEN=$(KEYCLOAK_URL=https://auth.sandbox.umzh-connect.ch \
  ./tests/scripts/get-token.sh placer)

hurl --test \
  --variable "placer_url=https://placer-int.sandbox.umzh-connect.ch" \
  --variable "fulfiller_url=https://fulfiller-int.sandbox.umzh-connect.ch" \
  --variable "placer_token=$PLACER_TOKEN" \
  tests/hurl/05-cross-party-context.hurl
```

## 8. Re-seeding

If you need to wipe and reload FHIR data without restarting containers, the
reseed API is available internally on port 9001. Expose it temporarily through
an SSH tunnel rather than opening it publicly:

```bash
ssh -L 9001:localhost:9001 user@<VPS_PUBLIC_IP>
curl -X POST http://localhost:9001/reseed
```

## 9. Updating the deployment

```bash
git pull
docker compose \
  -f docker-compose.yml \
  -f deployment/docker-compose.prod.yml \
  up -d --build
```

If only configuration files changed (APISIX YAML, OPA Rego, nginx.conf), you
can restart the affected service without a full rebuild:

```bash
docker compose restart nginx-proxy
docker compose restart apisix-placer-internal apisix-placer-external
```

## Security notes

- Change all default passwords in `.env` before first start (Postgres, Keycloak
  admin, client secrets).
- The L2 private keys in `services/keys/` are committed demo material — they are
  intentionally public for sandbox teaching purposes. Do not use these keys in any
  non-sandbox environment.
- The reseed API (port 9001) is not exposed through Caddy; access it via SSH tunnel.
- Keycloak admin console (`/admin`) is accessible at
  `https://auth.sandbox.umzh-connect.ch/admin` — consider restricting it with a
  Caddy `basicauth` block or IP allowlist if the server is internet-facing.
