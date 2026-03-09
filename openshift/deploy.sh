#!/usr/bin/env bash
# =============================================================================
# deploy.sh — OpenShift deployment for the minimal JMeter performance platform
# =============================================================================
#
# Stack deployed (6 services):
#   ✅ PostgreSQL    — test-run metadata store
#   ✅ InfluxDB      — JMeter BackendListener time-series store (Flux)
#   ✅ Grafana       — live dashboards (jmeter-perf, filtered by workload+run)
#   ✅ Backend API   — REST API + on-demand JMeter Job orchestration
#   ✅ Frontend UI   — Next.js dashboard (Start/Stop/View tests)
#   ✅ Sample App    — e-commerce load-test target
#
# Usage:
#   ./openshift/deploy.sh                   # full deploy
#   ./openshift/deploy.sh --skip-build      # skip image builds (already pushed)
#   ./openshift/deploy.sh --skip-infra      # skip namespace/SCC/RBAC
#   STORAGE_CLASS=ibmc-file-gold ./openshift/deploy.sh
#
# Prerequisites:
#   - oc CLI logged in  (oc login https://<api>:6443 -u kubeadmin -p <pw>)
#   - docker CLI with access to the OpenShift internal registry
# =============================================================================
set -euo pipefail

# ── Colour helpers ──────────────────────────────────────────────────────────
RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'; CYAN='\033[0;36m'; NC='\033[0m'
info()    { echo -e "${CYAN}[INFO]${NC}  $*"; }
success() { echo -e "${GREEN}[OK]${NC}    $*"; }
warn()    { echo -e "${YELLOW}[WARN]${NC}  $*"; }
die()     { echo -e "${RED}[ERROR]${NC} $*"; exit 1; }

# ── Flags ───────────────────────────────────────────────────────────────────
SKIP_BUILD=false
SKIP_INFRA=false
for arg in "$@"; do
  case $arg in
    --skip-build) SKIP_BUILD=true ;;
    --skip-infra) SKIP_INFRA=true ;;
  esac
done

# ── Resolve paths ───────────────────────────────────────────────────────────
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
OC_DIR="$SCRIPT_DIR"

# ── Configuration ───────────────────────────────────────────────────────────
NAMESPACE="perf-testing"
STORAGE_CLASS="${STORAGE_CLASS:-managed-nfs-storage}"

# ── Preflight ───────────────────────────────────────────────────────────────
info "Checking prerequisites..."
command -v oc &>/dev/null || die "oc CLI not found. Install it and log in first."
oc whoami      &>/dev/null || die "Not logged in to OpenShift. Run: oc login <api-url>"

OC_SERVER=$(oc whoami --show-server)
OC_USER=$(oc whoami)
info "Server : $OC_SERVER"
info "User   : $OC_USER"

# Auto-detect cluster wildcard apps domain
APPS_DOMAIN=$(oc get ingresses.config/cluster \
  -o jsonpath='{.spec.domain}' 2>/dev/null || true)
[[ -z "$APPS_DOMAIN" ]] && \
  APPS_DOMAIN="apps.cluster.fyre.ibm.com" && \
  warn "Could not auto-detect apps domain — using default: $APPS_DOMAIN"
info "Apps domain: $APPS_DOMAIN"

# ── Registry ────────────────────────────────────────────────────────────────
REGISTRY="image-registry.openshift-image-registry.svc:5000/${NAMESPACE}"
REGISTRY_ROUTE=$(oc get route default-route -n openshift-image-registry \
  -o jsonpath='{.spec.host}' 2>/dev/null || true)
if [[ -z "$REGISTRY_ROUTE" ]]; then
  info "Exposing internal image registry..."
  oc patch configs.imageregistry.operator.openshift.io/cluster \
    --type merge -p '{"spec":{"defaultRoute":true}}' 2>/dev/null || true
  sleep 5
  REGISTRY_ROUTE=$(oc get route default-route -n openshift-image-registry \
    -o jsonpath='{.spec.host}' 2>/dev/null \
    || echo "default-route-openshift-image-registry.${APPS_DOMAIN}")
fi
info "Image registry route: $REGISTRY_ROUTE"

# ── Step 0: Namespace ───────────────────────────────────────────────────────
if [[ "$SKIP_INFRA" == "false" ]]; then
  info "Creating namespace..."
  oc apply -f "$OC_DIR/00-namespace.yaml"
fi
oc project "$NAMESPACE"

# ── Step 1: SCC ─────────────────────────────────────────────────────────────
if [[ "$SKIP_INFRA" == "false" ]]; then
  info "Applying SecurityContextConstraints..."
  oc apply -f "$OC_DIR/01-scc.yaml"
  # Bind anyuid-perf to perf-platform SA (PostgreSQL uid 999, Grafana uid 472)
  oc adm policy add-scc-to-user anyuid-perf \
    -z perf-platform -n "$NAMESPACE" 2>/dev/null || true
  success "SCCs applied"
fi

# ── Step 2: RBAC ────────────────────────────────────────────────────────────
if [[ "$SKIP_INFRA" == "false" ]]; then
  info "Applying RBAC (ServiceAccounts + jmeter-orchestrator Role)..."
  oc apply -f "$OC_DIR/02-rbac.yaml"
  success "RBAC applied"
fi

# ── Step 3: Secrets ─────────────────────────────────────────────────────────
info "Applying secrets..."
oc apply -f "$OC_DIR/03-secrets.yaml"
success "Secrets applied"

# ── Step 4: Storage (PVCs) ──────────────────────────────────────────────────
info "Creating PersistentVolumeClaims (storageClass: $STORAGE_CLASS)..."
sed "s/managed-nfs-storage/$STORAGE_CLASS/g" "$OC_DIR/04-storage.yaml" | oc apply -f -
success "PVCs created"

# ── Step 5: ConfigMaps ──────────────────────────────────────────────────────
info "Applying Grafana datasource + dashboard-provider ConfigMaps..."
oc apply -f "$OC_DIR/05-configmaps.yaml"

info "Creating Grafana dashboard ConfigMap from jmeter-perf.json..."
oc create configmap grafana-dashboard-jmeter-perf \
  --from-file=jmeter-perf.json="$PROJECT_ROOT/grafana/provisioning/dashboards/jmeter-perf.json" \
  -n "$NAMESPACE" --dry-run=client -o yaml | oc apply -f -
success "ConfigMaps applied"

# ── Step 6: PostgreSQL ──────────────────────────────────────────────────────
info "Applying PostgreSQL init ConfigMap..."
oc apply -f "$OC_DIR/06b-postgres-init-cm.yaml"

info "Deploying PostgreSQL..."
oc apply -f "$OC_DIR/06-postgresql.yaml"
info "Waiting for PostgreSQL (up to 3 min)..."
oc rollout status statefulset/postgresql -n "$NAMESPACE" --timeout=3m
success "PostgreSQL ready"

# ── Step 7: InfluxDB ────────────────────────────────────────────────────────
info "Deploying InfluxDB..."
oc apply -f "$OC_DIR/07-influxdb.yaml"

# ── Step 8: Build & push custom images ─────────────────────────────────────
if [[ "$SKIP_BUILD" == "false" ]]; then
  info "Logging in to OpenShift internal registry..."
  oc registry login --insecure=true 2>/dev/null || \
    docker login -u "$(oc whoami)" -p "$(oc whoami -t)" "$REGISTRY_ROUTE"

  build_and_push() {
    local name="$1"
    local context="$2"
    local tag="$REGISTRY_ROUTE/$NAMESPACE/$name:latest"
    info "  Building $name..."
    docker build --platform linux/amd64 -t "$tag" "$context"
    info "  Pushing $name..."
    docker push "$tag"
    # Also tag with internal registry path for pod image pull
    docker tag "$tag" "$REGISTRY/$name:latest" 2>/dev/null || true
    success "  $name → $tag"
  }

  build_and_push "perf-backend"    "$PROJECT_ROOT/backend"
  build_and_push "perf-frontend"   "$PROJECT_ROOT/frontend"
  build_and_push "perf-sample-app" "$PROJECT_ROOT/sample-app"
  build_and_push "perf-jmeter"     "$PROJECT_ROOT/jmeter"
else
  warn "Skipping image builds (--skip-build)"
fi

# ── Step 9: Grafana ─────────────────────────────────────────────────────────
info "Deploying Grafana (apps domain: $APPS_DOMAIN)..."
sed "s/APPS_DOMAIN/$APPS_DOMAIN/g" "$OC_DIR/17-grafana.yaml" | oc apply -f -

# ── Step 10: Backend API ────────────────────────────────────────────────────
info "Deploying Backend API (GRAFANA_EXTERNAL_URL → grafana.$APPS_DOMAIN)..."
sed "s/APPS_DOMAIN/$APPS_DOMAIN/g" "$OC_DIR/08-backend.yaml" | oc apply -f -

# ── Step 11: Frontend UI ────────────────────────────────────────────────────
info "Deploying Frontend UI (NEXT_PUBLIC_API_URL → perf-api.$APPS_DOMAIN)..."
sed "s/APPS_DOMAIN/$APPS_DOMAIN/g" "$OC_DIR/09-frontend.yaml" | oc apply -f -

# ── Step 12: Sample App ─────────────────────────────────────────────────────
info "Deploying Sample App (load-test target)..."
oc apply -f "$OC_DIR/10-sample-app.yaml"

# ── Step 13: Wait for all deployments ──────────────────────────────────────
info "Waiting for all deployments to roll out (up to 5 min each)..."
DEPLOYMENTS=(grafana backend frontend sample-app)
for d in "${DEPLOYMENTS[@]}"; do
  info "  → $d..."
  oc rollout status deployment/"$d" -n "$NAMESPACE" --timeout=5m || \
    warn "  $d not fully ready — check: oc logs -l app=$d -n $NAMESPACE"
done

oc rollout status statefulset/influxdb -n "$NAMESPACE" --timeout=3m || \
  warn "InfluxDB not ready — check logs"

# ── Step 14: Print Route URLs ───────────────────────────────────────────────
echo ""
echo -e "${GREEN}════════════════════════════════════════════════════════════${NC}"
echo -e "${GREEN}  🚀 JMeter Performance Platform deployed on OpenShift!${NC}"
echo -e "${GREEN}════════════════════════════════════════════════════════════${NC}"
echo ""

print_route() {
  local label="$1" route_name="$2"
  local host
  host=$(oc get route "$route_name" -n "$NAMESPACE" \
    -o jsonpath='{.spec.host}' 2>/dev/null || echo "pending")
  printf "  %-22s ${CYAN}https://%s${NC}\n" "$label" "$host"
}

echo -e "  ${YELLOW}Services:${NC}"
print_route "Frontend UI"   "perf-ui"
print_route "Backend API"   "perf-api"
print_route "Grafana"       "grafana"
print_route "Sample App"    "perf-sample-app"
echo ""
echo -e "  Grafana credentials:  ${YELLOW}admin / changeme123${NC}"
echo -e "  Grafana dashboard:    ${CYAN}JMeter Performance Dashboard${NC}"
echo -e "  Dashboard filters:    ${CYAN}\$workload_name + \$test_run_id (scoped per run)${NC}"
echo ""
echo -e "  Each test run generates a scoped Grafana URL:"
echo -e "    ${CYAN}https://grafana.$APPS_DOMAIN/d/jmeter-perf/jmeter-perf${NC}"
echo -e "    ${CYAN}  ?var-workload_name=<slug>&var-test_run_id=<id>&refresh=5s${NC}"
echo ""
echo -e "  To watch API logs:"
echo -e "    ${CYAN}oc logs -l app=backend -n $NAMESPACE -f${NC}"
echo ""
echo -e "  To tear down:"
echo -e "    ${RED}./openshift/undeploy.sh${NC}"
echo -e "${GREEN}════════════════════════════════════════════════════════════${NC}"
