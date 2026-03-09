#!/usr/bin/env bash
# =============================================================================
# deploy-rhel9.sh — Docker Compose deployment for Red Hat Enterprise Linux 9
# =============================================================================
#
# Also compatible with:
#   - Rocky Linux 9   (community RHEL clone)
#   - AlmaLinux 9     (community RHEL clone)
#   - CentOS Stream 9 (upstream RHEL)
#
# Stack deployed (6 containers):
#   ✅ PostgreSQL    :5432  — test-run metadata store
#   ✅ InfluxDB      :8086  — JMeter BackendListener time-series store (Flux)
#   ✅ Grafana       :3001  — live dashboards (jmeter-perf, filtered by workload+run)
#   ✅ Backend API   :8080  — REST API + on-demand JMeter container orchestration
#   ✅ Frontend UI   :3000  — Next.js dashboard (Start/Stop/View tests)
#   ✅ Sample App    :3002  — e-commerce load-test target
#
# JMeter containers are spawned on-demand by the API via the Docker socket
# (LOCAL_MODE=true). They join the compose network automatically and are
# removed when the test finishes.
#
# Usage:
#   cd perf-platform
#   sudo bash linux/deploy-rhel9.sh                # full deploy + build
#   sudo bash linux/deploy-rhel9.sh --skip-build   # use pre-built images
#   sudo bash linux/deploy-rhel9.sh --skip-docker  # Docker already installed
#
# NOTE: RHEL 9 ships with Podman by default. This script installs Docker CE
# from Docker's official RPM repository, which coexists with Podman.
# The docker socket is required for LOCAL_MODE JMeter orchestration.
#
# Architecture: linux/amd64 (x86-64).
# =============================================================================
set -euo pipefail

# ── Colour helpers ──────────────────────────────────────────────────────────
RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'; CYAN='\033[0;36m'; NC='\033[0m'
info()    { echo -e "${CYAN}[INFO]${NC}  $*"; }
success() { echo -e "${GREEN}[OK]${NC}    $*"; }
warn()    { echo -e "${YELLOW}[WARN]${NC}  $*"; }
die()     { echo -e "${RED}[ERROR]${NC} $*"; exit 1; }
section() { echo -e "\n${GREEN}══ $* ${NC}"; }

# ── Flags ───────────────────────────────────────────────────────────────────
SKIP_BUILD=false
SKIP_DOCKER=false
PLATFORM="linux/amd64"
for arg in "$@"; do
  case $arg in
    --skip-build)  SKIP_BUILD=true ;;
    --skip-docker) SKIP_DOCKER=true ;;
    --platform)    shift; PLATFORM="$1" ;;
  esac
done

# ── Must run as root ────────────────────────────────────────────────────────
[[ $EUID -eq 0 ]] || die "Run this script with sudo: sudo bash linux/deploy-rhel9.sh"

# ── Resolve project root ────────────────────────────────────────────────────
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
COMPOSE_FILE="$PROJECT_ROOT/docker-compose.yml"
[[ -f "$COMPOSE_FILE" ]] || die "docker-compose.yml not found at $PROJECT_ROOT"

info "Project root : $PROJECT_ROOT"
info "Platform     : $PLATFORM"

# ── Detect OS variant ───────────────────────────────────────────────────────
if [[ -f /etc/os-release ]]; then
  # shellcheck source=/dev/null
  source /etc/os-release
  info "OS           : ${NAME} ${VERSION_ID}"
  case "${ID:-}" in
    rhel|centos|rocky|almalinux|fedora) : ;;
    *) warn "Untested OS '${ID}' — proceeding anyway, but RHEL9 compatibility is not guaranteed" ;;
  esac
else
  warn "/etc/os-release not found — assuming RHEL/CentOS compatible system"
fi

# ── Detect primary host IP ─────────────────────────────────────────────────
HOST_IP=$(ip -4 route get 1.1.1.1 2>/dev/null | awk '{for(i=1;i<=NF;i++) if($i=="src"){print $(i+1); exit}}')
[[ -z "$HOST_IP" ]] && HOST_IP=$(hostname -I | awk '{print $1}')
[[ -z "$HOST_IP" ]] && HOST_IP="127.0.0.1"
info "Host IP      : $HOST_IP"

# ── Compose project name ────────────────────────────────────────────────────
COMPOSE_PROJECT="${COMPOSE_PROJECT:-perf-platform}"
DOCKER_NETWORK="${COMPOSE_PROJECT}_perf-platform"

# =============================================================================
# STEP 1 — Install Docker CE + Compose plugin
# =============================================================================
section "Step 1 — Docker installation"

if [[ "$SKIP_DOCKER" == "true" ]]; then
  warn "Skipping Docker installation (--skip-docker)"
else
  if command -v docker &>/dev/null && docker compose version &>/dev/null 2>&1; then
    success "Docker $(docker --version | awk '{print $3}' | tr -d ',') already installed"
  else
    info "Installing Docker CE from Docker's official RPM repository..."

    # Install required packages
    dnf install -y -q dnf-plugins-core curl

    # Remove any existing conflicting packages (podman-docker etc.)
    dnf remove -y -q podman-docker docker docker-client docker-client-latest \
      docker-common docker-latest docker-latest-logrotate docker-logrotate \
      docker-engine 2>/dev/null || true

    # Add Docker's official RHEL 9 repo
    # (Docker publishes a dedicated RHEL repo from version 9 onward)
    dnf config-manager \
      --add-repo https://download.docker.com/linux/rhel/docker-ce.repo

    # Install Docker CE + Compose plugin
    dnf install -y docker-ce docker-ce-cli containerd.io docker-compose-plugin

    # Enable and start the Docker daemon
    systemctl enable docker
    systemctl start docker

    success "Docker installed and started"
  fi
fi

# Verify
docker info &>/dev/null || die "Docker daemon is not running. Try: systemctl start docker"
docker compose version &>/dev/null || die "Docker Compose plugin not found"
info "Docker  : $(docker --version)"
info "Compose : $(docker compose version)"

# ── SELinux — allow Docker to access the host socket ───────────────────────
# On RHEL 9, SELinux is enforcing by default. The compose stack mounts
# /var/run/docker.sock and the JMeter results volume. We need the container
# relabelling option (:z) or a policy adjustment.
if command -v getenforce &>/dev/null && [[ "$(getenforce)" == "Enforcing" ]]; then
  info "SELinux is Enforcing — setting docker_socket_t context on docker socket..."
  # The :z volume mount flag in compose relabels volumes for SELinux.
  # This policy adjustment allows containers to use the Docker socket.
  setsebool -P container_manage_cgroup 1 2>/dev/null || true
  # If docker socket context is wrong, restore it:
  restorecon -v /var/run/docker.sock 2>/dev/null || true
  success "SELinux socket context set"
fi

# =============================================================================
# STEP 2 — Firewall (firewalld) — open external-facing ports
# =============================================================================
section "Step 2 — Firewall (firewalld)"

if systemctl is-active --quiet firewalld 2>/dev/null; then
  info "Opening ports: 3000 (UI), 3001 (Grafana), 8080 (API), 3002 (sample-app)"
  firewall-cmd --permanent --add-port=3000/tcp   # Frontend UI
  firewall-cmd --permanent --add-port=3001/tcp   # Grafana
  firewall-cmd --permanent --add-port=8080/tcp   # Backend API
  firewall-cmd --permanent --add-port=3002/tcp   # Sample App
  firewall-cmd --reload
  success "firewalld rules added"
else
  warn "firewalld is not active — skipping firewall configuration"
  warn "Manually open ports 3000, 3001, 8080, 3002 if this is a remote server"
fi

# =============================================================================
# STEP 3 — Write .env (server-specific overrides)
# =============================================================================
section "Step 3 — Environment config (.env)"

ENV_FILE="$PROJECT_ROOT/.env"
cat > "$ENV_FILE" << EOF
# Generated by linux/deploy-rhel9.sh — $(date -u '+%Y-%m-%dT%H:%M:%SZ')
# Host-specific overrides for docker-compose.yml
# Edit and re-run 'docker compose up -d' to apply changes.

# ── Grafana public URL (used by the API to build scoped dashboard links) ────
GRAFANA_EXTERNAL_URL=http://${HOST_IP}:3001

# ── Backend API public URL (baked into the Next.js frontend at build time) ──
API_EXTERNAL_URL=http://${HOST_IP}:8080

# ── Docker Compose project + network name ───────────────────────────────────
COMPOSE_PROJECT_NAME=${COMPOSE_PROJECT}

# ── Docker network the API uses to attach JMeter containers ─────────────────
DOCKER_NETWORK=${DOCKER_NETWORK}
EOF

success ".env written → $ENV_FILE"
info "  GRAFANA_EXTERNAL_URL = http://${HOST_IP}:3001"
info "  API_EXTERNAL_URL     = http://${HOST_IP}:8080"

# =============================================================================
# STEP 4 — Build Docker images
# =============================================================================
section "Step 4 — Build images"

export DOCKER_DEFAULT_PLATFORM="$PLATFORM"
export COMPOSE_PROJECT_NAME="$COMPOSE_PROJECT"

cd "$PROJECT_ROOT"

if [[ "$SKIP_BUILD" == "true" ]]; then
  warn "Skipping image build (--skip-build)"
else
  info "Building images (platform: $PLATFORM) — this may take 5-10 min on first run..."
  docker compose \
    --project-name "$COMPOSE_PROJECT" \
    build \
    --build-arg NEXT_PUBLIC_API_URL="http://${HOST_IP}:8080/api/v1" \
    --build-arg INTERNAL_API_URL="http://perf-platform-api:8080" \
    --no-cache
  success "All images built"
fi

# =============================================================================
# STEP 5 — Start the stack
# =============================================================================
section "Step 5 — Start stack"

# On RHEL 9 with SELinux, volume mounts need the :z relabel option.
# This is handled in docker-compose.yml via the Z/z suffix on volume mounts,
# OR by running the daemon in permissive mode temporarily.
# We use --security-opt label:disable on the API container via override if needed.

docker compose \
  --project-name "$COMPOSE_PROJECT" \
  up -d --remove-orphans

success "All containers started"

# =============================================================================
# STEP 6 — Wait for health checks
# =============================================================================
section "Step 6 — Health checks"

wait_healthy() {
  local name="$1"
  local url="$2"
  local max_wait=120
  local elapsed=0
  local interval=5
  info "  Waiting for $name ($url)..."
  while ! curl -sf "$url" &>/dev/null; do
    sleep $interval
    elapsed=$((elapsed + interval))
    if [[ $elapsed -ge $max_wait ]]; then
      warn "  $name did not respond after ${max_wait}s — check: docker compose logs $name"
      return 1
    fi
  done
  success "  $name is up (${elapsed}s)"
}

wait_healthy "API"        "http://127.0.0.1:8080/api/v1/health"
wait_healthy "Grafana"    "http://127.0.0.1:3001/api/health"
wait_healthy "InfluxDB"   "http://127.0.0.1:8086/health"
wait_healthy "UI"         "http://127.0.0.1:3000"
wait_healthy "Sample App" "http://127.0.0.1:3002/health"

# =============================================================================
# STEP 7 — Summary
# =============================================================================
echo ""
echo -e "${GREEN}════════════════════════════════════════════════════════════${NC}"
echo -e "${GREEN}  🚀 JMeter Performance Platform — RHEL 9 deployment${NC}"
echo -e "${GREEN}════════════════════════════════════════════════════════════${NC}"
echo ""
echo -e "  ${YELLOW}Services:${NC}"
printf "  %-20s ${CYAN}http://%s:3000${NC}\n" "Frontend UI"   "$HOST_IP"
printf "  %-20s ${CYAN}http://%s:8080${NC}\n" "Backend API"   "$HOST_IP"
printf "  %-20s ${CYAN}http://%s:3001${NC}\n" "Grafana"       "$HOST_IP"
printf "  %-20s ${CYAN}http://%s:3002${NC}\n" "Sample App"    "$HOST_IP"
echo ""
echo -e "  Grafana login:    ${YELLOW}admin / changeme123${NC}"
echo -e "  InfluxDB login:   ${YELLOW}admin / changeme123${NC}  (token: changeme123)"
echo ""
echo -e "  Each test run generates a scoped Grafana link:"
echo -e "    ${CYAN}http://$HOST_IP:3001/d/jmeter-perf/jmeter-perf${NC}"
echo -e "    ${CYAN}  ?var-workload_name=<slug>&var-test_run_id=<id>&refresh=5s${NC}"
echo ""
echo -e "  Useful commands:"
echo -e "    ${CYAN}docker compose -p $COMPOSE_PROJECT logs -f api${NC}"
echo -e "    ${CYAN}docker compose -p $COMPOSE_PROJECT ps${NC}"
echo -e "    ${CYAN}docker compose -p $COMPOSE_PROJECT down${NC}           # stop (keep volumes)"
echo -e "    ${CYAN}docker compose -p $COMPOSE_PROJECT down -v${NC}        # stop + wipe data"
echo ""
echo -e "  SELinux note: if containers fail to start with 'permission denied',"
echo -e "    run: ${YELLOW}setenforce 0${NC} temporarily to diagnose, then fix SELinux policy."
echo -e "${GREEN}════════════════════════════════════════════════════════════${NC}"
