#!/usr/bin/env bash
# =============================================================================
# undeploy.sh — Tear down the full perf-platform from OpenShift
# =============================================================================
# Usage:
#   ./openshift/undeploy.sh               # delete all resources, keep PVCs
#   ./openshift/undeploy.sh --purge       # delete everything including PVCs & namespace
# =============================================================================
set -euo pipefail

RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'; CYAN='\033[0;36m'; NC='\033[0m'
info()  { echo -e "${CYAN}[INFO]${NC}  $*"; }
warn()  { echo -e "${YELLOW}[WARN]${NC}  $*"; }
ok()    { echo -e "${GREEN}[OK]${NC}    $*"; }

PURGE=false
for arg in "$@"; do
  [[ "$arg" == "--purge" ]] && PURGE=true
done

NAMESPACE="perf-testing"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

command -v oc &>/dev/null || { echo "oc not found"; exit 1; }
oc whoami      &>/dev/null || { echo "Not logged in"; exit 1; }

if [[ "$PURGE" == "true" ]]; then
  warn "PURGE mode — deleting entire namespace (all data will be lost!)"
  read -r -p "Type 'yes' to confirm: " confirm
  [[ "$confirm" == "yes" ]] || { info "Aborted."; exit 0; }
  oc delete namespace "$NAMESPACE" --ignore-not-found=true
  oc delete scc anyuid-perf hostaccess-perf --ignore-not-found=true
  oc delete clusterrolebinding anyuid-perf-platform hostaccess-perf-promtail \
    promtail-perf --ignore-not-found=true
  oc delete clusterrole promtail-perf --ignore-not-found=true
  ok "Namespace $NAMESPACE and all resources deleted."
  exit 0
fi

info "Deleting application deployments..."
for d in backend frontend sample-app regression-engine grafana prometheus loki tempo pyroscope; do
  oc delete deployment "$d" -n "$NAMESPACE" --ignore-not-found=true
done

info "Deleting StatefulSets..."
for s in postgresql influxdb; do
  oc delete statefulset "$s" -n "$NAMESPACE" --ignore-not-found=true
done

info "Deleting DaemonSet..."
oc delete daemonset promtail -n "$NAMESPACE" --ignore-not-found=true

info "Deleting Services..."
oc delete service postgresql influxdb backend frontend sample-app \
  regression-engine grafana prometheus loki tempo pyroscope \
  -n "$NAMESPACE" --ignore-not-found=true

info "Deleting Routes..."
oc delete route perf-ui perf-api perf-sample-app perf-regression grafana \
  -n "$NAMESPACE" --ignore-not-found=true

info "Deleting ConfigMaps..."
oc delete configmap prometheus-config loki-config tempo-config promtail-config \
  grafana-datasources grafana-dashboards-provider grafana-alerting \
  grafana-dashboard-01 grafana-dashboard-02 grafana-dashboard-03 \
  grafana-dashboard-04 grafana-dashboard-05 grafana-dashboard-06 \
  grafana-dashboard-07 grafana-dashboard-legacy grafana-dashboard-observability \
  postgres-init-scripts \
  -n "$NAMESPACE" --ignore-not-found=true

info "Deleting Secrets..."
oc delete secret postgres-secret influxdb-secret grafana-secret \
  -n "$NAMESPACE" --ignore-not-found=true

warn "PVCs preserved (re-run with --purge to delete data):"
oc get pvc -n "$NAMESPACE" 2>/dev/null || true

ok "Undeploy complete. PVCs and namespace retained."
ok "To fully purge: ./openshift/undeploy.sh --purge"
