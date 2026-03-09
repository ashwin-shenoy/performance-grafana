#!/usr/bin/env bash
# =============================================================================
# deploy.sh — Full IBM Fyre OpenShift deployment for perf-platform
# =============================================================================
# Usage:
#   ./openshift/deploy.sh                   # full deploy
#   ./openshift/deploy.sh --skip-build      # skip image builds (images already pushed)
#   ./openshift/deploy.sh --skip-infra      # skip namespace/SCC/RBAC (already applied)
#
# Prerequisites:
#   - oc CLI logged in to Fyre cluster  (oc login https://<api>:6443 -u kubeadmin -p <pw>)
#   - docker/podman CLI with access to internal registry
# =============================================================================
set -euo pipefail

# ── Colour helpers ─────────────────────────────────────────────────────────────
RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'; CYAN='\033[0;36m'; NC='\033[0m'
info()    { echo -e "${CYAN}[INFO]${NC}  $*"; }
success() { echo -e "${GREEN}[OK]${NC}    $*"; }
warn()    { echo -e "${YELLOW}[WARN]${NC}  $*"; }
die()     { echo -e "${RED}[ERROR]${NC} $*"; exit 1; }

# ── Flags ──────────────────────────────────────────────────────────────────────
SKIP_BUILD=false
SKIP_INFRA=false
for arg in "$@"; do
  case $arg in
    --skip-build) SKIP_BUILD=true ;;
    --skip-infra) SKIP_INFRA=true ;;
  esac
done

# ── Resolve paths ──────────────────────────────────────────────────────────────
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
OC_DIR="$SCRIPT_DIR"

# ── Configuration ──────────────────────────────────────────────────────────────
NAMESPACE="perf-testing"
STORAGE_CLASS="${STORAGE_CLASS:-managed-nfs-storage}"   # override if needed

# ── Preflight checks ───────────────────────────────────────────────────────────
info "Checking prerequisites..."
command -v oc   &>/dev/null || die "oc CLI not found. Install it and log in first."
oc whoami       &>/dev/null || die "Not logged in to OpenShift. Run: oc login <api-url>"

OC_SERVER=$(oc whoami --show-server)
OC_USER=$(oc whoami)
info "Server : $OC_SERVER"
info "User   : $OC_USER"

# Detect apps domain from cluster
APPS_DOMAIN=$(oc get ingresses.config/cluster -o jsonpath='{.spec.domain}' 2>/dev/null || true)
if [[ -z "$APPS_DOMAIN" ]]; then
  warn "Could not auto-detect apps domain. Routes will use default OpenShift wildcard."
  APPS_DOMAIN="apps.cluster.fyre.ibm.com"
fi
info "Apps domain: $APPS_DOMAIN"

# ── Registry ───────────────────────────────────────────────────────────────────
REGISTRY="image-registry.openshift-image-registry.svc:5000/${NAMESPACE}"
# For external push we need the exposed registry route
REGISTRY_ROUTE=$(oc get route default-route -n openshift-image-registry \
  -o jsonpath='{.spec.host}' 2>/dev/null || true)
if [[ -z "$REGISTRY_ROUTE" ]]; then
  info "Exposing internal image registry..."
  oc patch configs.imageregistry.operator.openshift.io/cluster \
    --type merge -p '{"spec":{"defaultRoute":true}}' 2>/dev/null || true
  sleep 5
  REGISTRY_ROUTE=$(oc get route default-route -n openshift-image-registry \
    -o jsonpath='{.spec.host}' 2>/dev/null || echo "default-route-openshift-image-registry.${APPS_DOMAIN}")
fi
info "Image registry route: $REGISTRY_ROUTE"

# ── Step 0: Namespace ─────────────────────────────────────────────────────────
if [[ "$SKIP_INFRA" == "false" ]]; then
  info "Creating namespace..."
  oc apply -f "$OC_DIR/00-namespace.yaml"
  oc project "$NAMESPACE"
else
  oc project "$NAMESPACE"
fi

# ── Step 1: SCC ───────────────────────────────────────────────────────────────
if [[ "$SKIP_INFRA" == "false" ]]; then
  info "Applying SecurityContextConstraints..."
  oc apply -f "$OC_DIR/01-scc.yaml"

  # Bind SCCs using oc adm (more reliable than ClusterRoleBinding for SCCs)
  oc adm policy add-scc-to-user anyuid-perf \
    -z perf-platform -n "$NAMESPACE" 2>/dev/null || true
  oc adm policy add-scc-to-user hostaccess-perf \
    -z promtail -n "$NAMESPACE" 2>/dev/null || true
  success "SCCs applied"
fi

# ── Step 2: RBAC ──────────────────────────────────────────────────────────────
if [[ "$SKIP_INFRA" == "false" ]]; then
  info "Applying RBAC..."
  oc apply -f "$OC_DIR/02-rbac.yaml"
  success "RBAC applied"
fi

# ── Step 3: Secrets ───────────────────────────────────────────────────────────
info "Applying secrets..."
oc apply -f "$OC_DIR/03-secrets.yaml"
success "Secrets applied"

# ── Step 4: Storage (PVCs) ────────────────────────────────────────────────────
info "Creating PersistentVolumeClaims (storageClass: $STORAGE_CLASS)..."
# Substitute storage class if not the default
sed "s/managed-nfs-storage/$STORAGE_CLASS/g" "$OC_DIR/04-storage.yaml" | oc apply -f -
success "PVCs created"

# ── Step 5: ConfigMaps ────────────────────────────────────────────────────────
info "Applying monitoring ConfigMaps..."
oc apply -f "$OC_DIR/05-configmaps.yaml"

info "Applying Grafana dashboard ConfigMaps (9 dashboards + alerting)..."
oc apply -f "$OC_DIR/18-grafana-dashboard-cms.yaml"
success "ConfigMaps applied"

# ── Step 6: Database ─────────────────────────────────────────────────────────
info "Applying Postgres init scripts ConfigMap..."
oc apply -f "$OC_DIR/06b-postgres-init-cm.yaml"

info "Deploying PostgreSQL..."
oc apply -f "$OC_DIR/06-postgresql.yaml"
info "Waiting for PostgreSQL to be ready (up to 3m)..."
oc rollout status statefulset/postgresql -n "$NAMESPACE" --timeout=3m
success "PostgreSQL ready"

info "Deploying InfluxDB..."
oc apply -f "$OC_DIR/07-influxdb.yaml"

# ── Step 7: Build & push custom images ────────────────────────────────────────
if [[ "$SKIP_BUILD" == "false" ]]; then
  info "Logging in to OpenShift internal registry..."
  oc registry login --insecure=true 2>/dev/null || \
    docker login -u "$(oc whoami)" -p "$(oc whoami -t)" "$REGISTRY_ROUTE"

  build_and_push() {
    local name="$1"
    local context="$2"
    local tag="$REGISTRY_ROUTE/$NAMESPACE/$name:latest"
    info "Building $name..."
    docker build --platform linux/amd64 -t "$tag" "$context"
    info "Pushing $name..."
    docker push "$tag"
    success "$name → $tag"
  }

  build_and_push "perf-backend"          "$PROJECT_ROOT/backend"
  build_and_push "perf-frontend"         "$PROJECT_ROOT/frontend"
  build_and_push "perf-sample-app"       "$PROJECT_ROOT/sample-app"
  build_and_push "perf-regression-engine" "$PROJECT_ROOT/regression-engine"
  build_and_push "perf-jmeter"           "$PROJECT_ROOT/jmeter"

  # Tag images also with internal registry path (for pod pull)
  for name in perf-backend perf-frontend perf-sample-app perf-regression-engine perf-jmeter; do
    docker tag "$REGISTRY_ROUTE/$NAMESPACE/$name:latest" \
               "$REGISTRY/$name:latest" 2>/dev/null || true
  done
else
  warn "Skipping image builds (--skip-build)"
fi

# ── Step 8: Observability stack ───────────────────────────────────────────────
info "Deploying observability stack..."
oc apply -f "$OC_DIR/12-prometheus.yaml"
oc apply -f "$OC_DIR/13-loki.yaml"
oc apply -f "$OC_DIR/14-tempo.yaml"
oc apply -f "$OC_DIR/15-pyroscope.yaml"
oc apply -f "$OC_DIR/16-promtail.yaml"

# ── Step 9: Grafana ───────────────────────────────────────────────────────────
info "Patching Grafana ROOT_URL with detected apps domain..."
sed "s/APPS_DOMAIN/$APPS_DOMAIN/g" "$OC_DIR/17-grafana.yaml" | oc apply -f -

# ── Step 10: Application services ─────────────────────────────────────────────
info "Patching frontend NEXT_PUBLIC_API_URL with apps domain..."
sed "s/APPS_DOMAIN/$APPS_DOMAIN/g" "$OC_DIR/09-frontend.yaml" | oc apply -f -

info "Deploying backend API..."
oc apply -f "$OC_DIR/08-backend.yaml"

info "Deploying sample app..."
oc apply -f "$OC_DIR/10-sample-app.yaml"

info "Deploying regression engine..."
oc apply -f "$OC_DIR/11-regression-engine.yaml"

# ── Step 11: Wait for all deployments ─────────────────────────────────────────
info "Waiting for all deployments to roll out (up to 5m each)..."
DEPLOYMENTS=(loki tempo pyroscope prometheus grafana backend frontend sample-app regression-engine)
for d in "${DEPLOYMENTS[@]}"; do
  info "  waiting for $d..."
  oc rollout status deployment/"$d" -n "$NAMESPACE" --timeout=5m || \
    warn "  $d did not become ready in time — check: oc logs -l app=$d -n $NAMESPACE"
done

oc rollout status statefulset/influxdb -n "$NAMESPACE" --timeout=3m || \
  warn "InfluxDB not ready — check logs"

# ── Step 12: Print Route URLs ─────────────────────────────────────────────────
echo ""
echo -e "${GREEN}════════════════════════════════════════════════════════════${NC}"
echo -e "${GREEN}  🚀 Perf Platform deployed on OpenShift!${NC}"
echo -e "${GREEN}════════════════════════════════════════════════════════════${NC}"

print_route() {
  local name="$1"
  local route_name="$2"
  local host
  host=$(oc get route "$route_name" -n "$NAMESPACE" \
    -o jsonpath='{.spec.host}' 2>/dev/null || echo "pending")
  printf "  %-22s https://%s\n" "$name" "$host"
}

print_route "Frontend UI"        "perf-ui"
print_route "Backend API"        "perf-api"
print_route "Grafana"            "grafana"
print_route "Regression Engine"  "perf-regression"
print_route "Sample App"         "perf-sample-app"

echo ""
echo -e "  Grafana credentials:  ${YELLOW}admin / changeme123${NC}"
echo -e "  Grafana dashboards:   ${CYAN}9 dashboards auto-provisioned${NC}"
echo ""
echo -e "  To run a load test:"
echo -e "    ${CYAN}oc create job jmeter-run-1 --from=cronjob/... -n $NAMESPACE${NC}"
echo ""
echo -e "  To watch logs:"
echo -e "    ${CYAN}oc logs -l app=backend -n $NAMESPACE -f${NC}"
echo -e "${GREEN}════════════════════════════════════════════════════════════${NC}"
