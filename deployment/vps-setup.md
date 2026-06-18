# VPS Setup Guide — Infomaniak Ubuntu 26.04

Step-by-step hardening and provisioning of a fresh VPS before running the
sandbox stack. Run all commands as the `ubuntu` user unless a step says otherwise.

---

## 1. First login and system update

SSH in from your local machine:

```bash
ssh ubuntu@<VPS_PUBLIC_IP>
```

Update all packages:

```bash
sudo apt update && sudo apt full-upgrade -y
sudo apt autoremove -y
```

Set the hostname (optional but makes logs easier to read):

```bash
sudo hostnamectl set-hostname sandbox-umzh
```

---

## 2. SSH hardening

Edit the SSH daemon config:

```bash
sudo nano /etc/ssh/sshd_config
```

Set or confirm these values:

```
PermitRootLogin no
PasswordAuthentication no
PubkeyAuthentication yes
AuthorizedKeysFile .ssh/authorized_keys
X11Forwarding no
MaxAuthTries 3
```

Make sure your public key is already in `~/.ssh/authorized_keys` before
restarting — otherwise you will be locked out:

```bash
cat ~/.ssh/authorized_keys   # confirm your key is present
sudo systemctl restart ssh
```

---

## 3. Firewall (UFW)

```bash
sudo ufw default deny incoming
sudo ufw default allow outgoing
sudo ufw allow 22/tcp    # SSH
sudo ufw allow 80/tcp    # HTTP  (Caddy ACME + redirect)
sudo ufw allow 443/tcp   # HTTPS
sudo ufw enable
sudo ufw status verbose
```

All Docker service ports (8080–8090, 8180, etc.) stay bound to `localhost` only
and are never exposed through UFW. Caddy proxies the public-facing ones.

---

## 4. Fail2ban

```bash
sudo apt install -y fail2ban

sudo tee /etc/fail2ban/jail.local > /dev/null <<'EOF'
[DEFAULT]
bantime  = 1h
findtime = 10m
maxretry = 5

[sshd]
enabled = true
port    = ssh
EOF

sudo systemctl enable --now fail2ban
sudo fail2ban-client status sshd
```

---

## 5. Docker

### Install

```bash
sudo apt install -y ca-certificates curl
sudo install -m 0755 -d /etc/apt/keyrings
curl -fsSL https://download.docker.com/linux/ubuntu/gpg \
  | sudo gpg --dearmor -o /etc/apt/keyrings/docker.gpg
sudo chmod a+r /etc/apt/keyrings/docker.gpg

echo \
  "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.gpg] \
  https://download.docker.com/linux/ubuntu \
  $(. /etc/os-release && echo "$VERSION_CODENAME") stable" \
  | sudo tee /etc/apt/sources.list.d/docker.list > /dev/null

sudo apt update
sudo apt install -y docker-ce docker-ce-cli containerd.io \
                    docker-buildx-plugin docker-compose-plugin
```

### Add `ubuntu` to the docker group

```bash
sudo usermod -aG docker ubuntu
```

Apply without logging out:

```bash
newgrp docker
```

Verify:

```bash
docker run --rm hello-world
```

### Harden the Docker daemon

Restrict the daemon socket so only members of the `docker` group can use it
(this is the default, but confirm):

```bash
ls -la /var/run/docker.sock
# Should show: srw-rw---- ... root docker ...
```

Disable the Docker daemon's default iptables manipulation for external exposure
— Caddy handles all inbound routing, and all service ports bind to `127.0.0.1`:

```bash
sudo mkdir -p /etc/docker
sudo tee /etc/docker/daemon.json > /dev/null <<'EOF'
{
  "iptables": false,
  "log-driver": "json-file",
  "log-opts": {
    "max-size": "20m",
    "max-file": "5"
  }
}
EOF

sudo systemctl restart docker
```

> **Why `"iptables": false`?** Docker's default iptables rules bypass UFW and
> can expose container ports to the internet even when UFW would block them. With
> this flag off, only ports explicitly published to `127.0.0.1` (the docker-compose
> default for host-bound ports) are reachable — Caddy is the sole public entry
> point.

Enable Docker to start on boot:

```bash
sudo systemctl enable docker
```

---

## 6. Caddy

```bash
sudo apt install -y debian-keyring debian-archive-keyring apt-transport-https
curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/gpg.key' \
  | sudo gpg --dearmor -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt' \
  | sudo tee /etc/apt/sources.list.d/caddy-stable.list > /dev/null
sudo apt update && sudo apt install -y caddy
```

Caddy runs as the `caddy` system user. It needs no access to the repo. Install
the Caddyfile and verify the config:

```bash
sudo cp /opt/umzhconnect-sandbox/deployment/Caddyfile /etc/caddy/Caddyfile
sudo caddy validate --config /etc/caddy/Caddyfile
sudo systemctl enable --now caddy
sudo systemctl status caddy
```

---

## 7. Clone the repository

```bash
sudo mkdir -p /opt/umzhconnect-sandbox
sudo chown ubuntu:ubuntu /opt/umzhconnect-sandbox

git clone https://github.com/umzhconnect/umzhconnect-sandbox.git /opt/umzhconnect-sandbox
cd /opt/umzhconnect-sandbox
```

### Directory permissions

The stack reads config files and writes nothing to the repo tree at runtime
(all persistent data goes to named Docker volumes). Set ownership to `ubuntu`
and restrict world access:

```bash
# Repo root: ubuntu owns everything
sudo chown -R ubuntu:ubuntu /opt/umzhconnect-sandbox

# No world write anywhere in the repo
find /opt/umzhconnect-sandbox -type d -exec chmod 755 {} \;
find /opt/umzhconnect-sandbox -type f -exec chmod 644 {} \;

# Shell scripts need execute permission
find /opt/umzhconnect-sandbox -name "*.sh" -exec chmod 755 {} \;
```

---

## 8. Environment file

Copy the production template and restrict permissions before filling in secrets:

```bash
cd /opt/umzhconnect-sandbox
cp deployment/.env.prod.example .env
chmod 600 .env      # owner read/write only — secrets inside
nano .env           # fill in all <CHANGE_ME> values
```

The `.env` file must be readable only by `ubuntu` (the user running Docker
Compose). Confirm:

```bash
ls -la .env
# Should show: -rw------- 1 ubuntu ubuntu ...
```

---

## 9. Demo key files

The L2 demo private keys in `services/keys/` are intentionally public sandbox
material (see `services/keys/README.md`), but restrict permissions anyway to
avoid accidental modification:

```bash
chmod 400 /opt/umzhconnect-sandbox/services/keys/*.key
chmod 444 /opt/umzhconnect-sandbox/services/keys/*.json
```

---

## 10. Apply nginx-proxy public URL patch

Run the `sed` command from [deployment.md](../deployment.md) (section 4b) to
rewrite the self-link sub_filter values in `services/nginx-proxy/nginx.conf`
from `localhost` to the public HTTPS URLs.

After patching, verify the change looks right:

```bash
grep "sub_filter " services/nginx-proxy/nginx.conf
# Each line should now reference https://*.sandbox.umzh-connect.ch/fhir/
```

---

## 11. Patch Keycloak realm redirect URIs

Run the Python one-liner from [deployment.md](../deployment.md) (section 4c)
to add the public domain to `services/keycloak/realm-export.json`.

---

## 12. Start the stack

```bash
cd /opt/umzhconnect-sandbox

docker compose \
  -f docker-compose.yml \
  -f deployment/docker-compose.prod.yml \
  up -d --build
```

Follow startup:

```bash
docker compose logs -f keycloak     # wait for "Started Keycloak"
docker compose logs -f seed-loader  # wait for "Seed complete"
```

---

## 13. Verify permissions are intact after first run

Docker Compose creates named volumes owned by root. The repo files themselves
should not have changed ownership. Confirm:

```bash
# Repo files still owned by ubuntu
stat -c "%U %n" /opt/umzhconnect-sandbox/.env
# ubuntu /opt/umzhconnect-sandbox/.env

# .env still mode 600
stat -c "%a %n" /opt/umzhconnect-sandbox/.env
# 600 /opt/umzhconnect-sandbox/.env

# Docker socket still accessible (ubuntu is in docker group)
docker ps
```

---

## 14. Automatic startup on reboot

Create a systemd service so the stack restarts automatically:

```bash
sudo tee /etc/systemd/system/umzh-sandbox.service > /dev/null <<'EOF'
[Unit]
Description=UMZH Connect Sandbox (Docker Compose)
After=docker.service network-online.target
Requires=docker.service

[Service]
Type=oneshot
RemainAfterExit=yes
User=ubuntu
WorkingDirectory=/opt/umzhconnect-sandbox
ExecStart=/usr/bin/docker compose \
  -f docker-compose.yml \
  -f deployment/docker-compose.prod.yml \
  up -d --remove-orphans
ExecStop=/usr/bin/docker compose down
TimeoutStartSec=300

[Install]
WantedBy=multi-user.target
EOF

sudo systemctl daemon-reload
sudo systemctl enable umzh-sandbox.service
```

Test the service (it will report "already running" since you started manually):

```bash
sudo systemctl start umzh-sandbox.service
sudo systemctl status umzh-sandbox.service
```

---

## Quick-reference: permission summary

| Path | Owner | Mode | Reason |
|------|-------|------|--------|
| `/opt/umzhconnect-sandbox/` | `ubuntu:ubuntu` | `755` | compose needs to read all files |
| `.env` | `ubuntu:ubuntu` | `600` | contains secrets |
| `services/keys/*.key` | `ubuntu:ubuntu` | `400` | demo private keys |
| `services/keys/*.json` | `ubuntu:ubuntu` | `444` | public JWK Sets |
| `**/*.sh` | `ubuntu:ubuntu` | `755` | entrypoints need execute |
| `/etc/caddy/Caddyfile` | `root:caddy` | `640` | Caddy reads at startup |
| `/var/run/docker.sock` | `root:docker` | `660` | docker group members only |
