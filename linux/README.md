# Linux Bare-Metal / VM Deployment

Docker Compose deployment scripts for standalone Linux servers.
No Kubernetes or OpenShift required.

## Scripts

| Script | Target OS |
|---|---|
| `deploy-ubuntu22.sh` | Ubuntu 22.04 LTS (also 20.04, 24.04) |
| `deploy-rhel9.sh` | RHEL 9, Rocky Linux 9, AlmaLinux 9, CentOS Stream 9 |

## Prerequisites

- A server with **≥ 4 CPU cores** and **≥ 8 GB RAM**
- Root / sudo access
- Outbound internet access (to pull Docker images)
- Ports **3000, 3001, 8080, 3002** open in your cloud security group / VPC firewall

## Usage

```bash
# Clone / copy the project to the server, then:
cd perf-platform

# Ubuntu 22.04
sudo bash linux/deploy-ubuntu22.sh

# RHEL 9 / Rocky 9 / AlmaLinux 9
sudo bash linux/deploy-rhel9.sh
```

### Flags

| Flag | Effect |
|---|---|
| `--skip-build` | Skip `docker compose build` (use images already present locally) |
| `--skip-docker` | Skip Docker CE installation (already installed) |

## What the scripts do

1. **Install Docker CE + Compose plugin** from Docker's official repository
   *(Ubuntu: apt; RHEL: dnf + Docker RPM repo)*
2. **Open firewall ports** — ufw (Ubuntu) or firewalld (RHEL)
3. **Write `.env`** with host-IP-aware overrides:
   - `GRAFANA_EXTERNAL_URL=http://<host-ip>:3001`
   - `API_EXTERNAL_URL=http://<host-ip>:8080`
4. **Build Docker images** (`docker compose build --no-cache`)
5. **Start the stack** (`docker compose up -d`)
6. **Health-check** all 6 services before printing URLs
7. **Print** the access URLs and useful management commands

## After deployment

| URL | Service |
|---|---|
| `http://<host>:3000` | Frontend UI — start/stop tests, view run history |
| `http://<host>:8080/api/v1/health` | Backend API health check |
| `http://<host>:3001` | Grafana — live dashboards |
| `http://<host>:3002/health` | Sample App (load-test target) |

**Grafana:** `admin / changeme123`
**InfluxDB:** `admin / changeme123`, token: `changeme123`

## Managing the stack

```bash
# View logs
docker compose -p perf-platform logs -f api

# Check status
docker compose -p perf-platform ps

# Stop (keep data volumes)
docker compose -p perf-platform down

# Stop + wipe all data
docker compose -p perf-platform down -v

# Restart after config change
docker compose -p perf-platform up -d
```

## RHEL 9 — SELinux note

If containers fail to start with `permission denied` errors, SELinux may be
blocking volume access. Diagnose with:

```bash
setenforce 0          # temporary — sets permissive mode
docker compose -p perf-platform up -d
ausearch -m avc -ts recent   # view SELinux denials
```

To fix permanently, restore enforcing mode after identifying the denial and
creating a targeted policy:

```bash
setenforce 1
audit2allow -a -M perf-platform-docker
semodule -i perf-platform-docker.pp
```
