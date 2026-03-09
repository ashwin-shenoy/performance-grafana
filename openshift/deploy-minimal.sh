#!/usr/bin/env bash
# =============================================================================
# deploy-minimal.sh — Minimal IBM Fyre OpenShift deployment
# =============================================================================
# Stack included:
#   ✅ PostgreSQL          (metadata store + dashboards)
#   ✅ InfluxDB            (JMeter time-series metrics)
#   ✅ Prometheus          (infra/app metrics)
#   ✅ Grafana             (dashboards — 8 of 9 fully functional)
#   ✅ Backend API
#   ✅ Frontend UI
#   ✅ Regression Engine
#
# Stack excluded:
#   ❌ Loki               (log aggregation)
#   ❌ Tempo              (distributed tracing)
#   ❌ Pyroscope          (continuous profiling)
#   ❌ Promtail           (log collector)
#   ❌ Sample App         (load-test target — bring your own)
#
# Usage:
#   ./openshift/deploy-minimal.sh
#   ./openshift/deploy-minimal.sh --skip-build
#   ./openshift/deploy-minimal.sh --skip-infra
#   STORAGE_CLASS=ibmc-file-gold ./openshift/deploy-minimal.sh
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

NAMESPACE="perf-testing"
STORAGE_CLASS="${STORAGE_CLASS:-managed-nfs-storage}"

# ── Preflight ──────────────────────────────────────────────────────────────────
info "Checking prerequisites..."
command -v oc &>/dev/null || die "oc CLI not found. Install it and log in first."
oc whoami      &>/dev/null || die "Not logged in. Run: oc login <api-url>"

OC_SERVER=$(oc whoami --show-server)
OC_USER=$(oc whoami)
info "Server : $OC_SERVER"
info "User   : $OC_USER"

APPS_DOMAIN=$(oc get ingresses.config/cluster -o jsonpath='{.spec.domain}' 2>/dev/null || true)
[[ -z "$APPS_DOMAIN" ]] && APPS_DOMAIN="apps.cluster.fyre.ibm.com"
info "Apps domain: $APPS_DOMAIN"

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

# ══════════════════════════════════════════════════════════════════════════════
# STEP 0 — Namespace
# ══════════════════════════════════════════════════════════════════════════════
if [[ "$SKIP_INFRA" == "false" ]]; then
  info "Creating namespace..."
  oc apply -f "$OC_DIR/00-namespace.yaml"
fi
oc project "$NAMESPACE"

# ══════════════════════════════════════════════════════════════════════════════
# STEP 1 — SCC & RBAC  (anyuid for postgres/grafana/influxdb only)
# ══════════════════════════════════════════════════════════════════════════════
if [[ "$SKIP_INFRA" == "false" ]]; then
  info "Applying SCC..."
  # Apply only anyuid-perf — hostaccess-perf (promtail) not needed
  oc apply -f - <<'EOF'
apiVersion: security.openshift.io/v1
kind: SecurityContextConstraints
metadata:
  name: anyuid-perf
allowPrivilegeEscalation: false
allowPrivilegedContainer: false
allowedCapabilities: []
defaultAddCapabilities: []
requiredDropCapabilities: [KILL, MKNOD, SETUID, SETGID]
fsGroup:
  type: MustRunAs
  ranges: [{min: 1, max: 65535}]
runAsUser:
  type: RunAsAny
seLinuxContext:
  type: MustRunAs
supplementalGroups:
  type: RunAsAny
volumes: [configMap, downwardAPI, emptyDir, persistentVolumeClaim, projected, secret]
users: []
groups: []
EOF

  info "Applying RBAC..."
  # ServiceAccounts
  oc apply -f - <<EOF
apiVersion: v1
kind: ServiceAccount
metadata:
  name: perf-platform
  namespace: $NAMESPACE
---
apiVersion: v1
kind: ServiceAccount
metadata:
  name: jmeter-orchestrator
  namespace: $NAMESPACE
EOF

  # Role for jmeter-orchestrator
  oc apply -f - <<EOF
apiVersion: rbac.authorization.k8s.io/v1
kind: Role
metadata:
  name: jmeter-orchestrator
  namespace: $NAMESPACE
rules:
  - apiGroups: ["batch"]
    resources: ["jobs"]
    verbs: ["create","get","list","watch","delete","patch"]
  - apiGroups: [""]
    resources: ["pods","pods/log","pods/exec"]
    verbs: ["get","list","watch","create","delete"]
  - apiGroups: [""]
    resources: ["services","configmaps"]
    verbs: ["get","list","watch"]
---
apiVersion: rbac.authorization.k8s.io/v1
kind: RoleBinding
metadata:
  name: jmeter-orchestrator
  namespace: $NAMESPACE
subjects:
  - kind: ServiceAccount
    name: jmeter-orchestrator
    namespace: $NAMESPACE
  - kind: ServiceAccount
    name: perf-platform
    namespace: $NAMESPACE
roleRef:
  kind: Role
  name: jmeter-orchestrator
  apiGroup: rbac.authorization.k8s.io
EOF

  # SCC binding
  oc adm policy add-scc-to-user anyuid-perf \
    -z perf-platform -n "$NAMESPACE" 2>/dev/null || true

  success "SCC + RBAC applied"
fi

# ══════════════════════════════════════════════════════════════════════════════
# STEP 2 — Secrets
# ══════════════════════════════════════════════════════════════════════════════
info "Applying secrets..."
oc apply -f "$OC_DIR/03-secrets.yaml"
success "Secrets applied"

# ══════════════════════════════════════════════════════════════════════════════
# STEP 3 — Storage  (only PVCs needed for minimal stack)
# ══════════════════════════════════════════════════════════════════════════════
info "Creating PVCs (storageClass: $STORAGE_CLASS)..."
oc apply -f - <<EOF
# postgres
apiVersion: v1
kind: PersistentVolumeClaim
metadata:
  name: postgres-pvc
  namespace: $NAMESPACE
  labels: {app: postgresql}
spec:
  accessModes: [ReadWriteOnce]
  storageClassName: $STORAGE_CLASS
  resources:
    requests:
      storage: 10Gi
---
# influxdb
apiVersion: v1
kind: PersistentVolumeClaim
metadata:
  name: influxdb-pvc
  namespace: $NAMESPACE
  labels: {app: influxdb}
spec:
  accessModes: [ReadWriteOnce]
  storageClassName: $STORAGE_CLASS
  resources:
    requests:
      storage: 20Gi
---
# grafana
apiVersion: v1
kind: PersistentVolumeClaim
metadata:
  name: grafana-pvc
  namespace: $NAMESPACE
  labels: {app: grafana}
spec:
  accessModes: [ReadWriteOnce]
  storageClassName: $STORAGE_CLASS
  resources:
    requests:
      storage: 2Gi
---
# prometheus
apiVersion: v1
kind: PersistentVolumeClaim
metadata:
  name: prometheus-pvc
  namespace: $NAMESPACE
  labels: {app: prometheus}
spec:
  accessModes: [ReadWriteOnce]
  storageClassName: $STORAGE_CLASS
  resources:
    requests:
      storage: 10Gi
---
# jmeter-results (RWX — shared between controller and worker jobs)
apiVersion: v1
kind: PersistentVolumeClaim
metadata:
  name: jmeter-results-pvc
  namespace: $NAMESPACE
  labels: {app: jmeter}
spec:
  accessModes: [ReadWriteMany]
  storageClassName: $STORAGE_CLASS
  resources:
    requests:
      storage: 10Gi
EOF
success "PVCs created"

# ══════════════════════════════════════════════════════════════════════════════
# STEP 4 — ConfigMaps (minimal — no Loki/Tempo/Pyroscope/Promtail)
# ══════════════════════════════════════════════════════════════════════════════
info "Applying Prometheus ConfigMap..."
oc apply -f - <<'EOF'
apiVersion: v1
kind: ConfigMap
metadata:
  name: prometheus-config
  namespace: perf-testing
  labels: {app: prometheus}
data:
  prometheus.yml: |
    global:
      scrape_interval: 15s
      evaluation_interval: 15s

    scrape_configs:
      - job_name: perf-platform-api
        static_configs:
          - targets: [backend:9090]

      - job_name: regression-engine
        metrics_path: /metrics
        static_configs:
          - targets: [regression-engine:8080]

      - job_name: kubernetes-pods
        kubernetes_sd_configs:
          - role: pod
            namespaces:
              names: [perf-testing]
        relabel_configs:
          - source_labels: [__meta_kubernetes_pod_annotation_prometheus_io_scrape]
            action: keep
            regex: "true"
          - source_labels: [__meta_kubernetes_pod_annotation_prometheus_io_path]
            action: replace
            target_label: __metrics_path__
            regex: (.+)
          - source_labels: [__address__, __meta_kubernetes_pod_annotation_prometheus_io_port]
            action: replace
            regex: ([^:]+)(?::\d+)?;(\d+)
            replacement: $1:$2
            target_label: __address__
          - source_labels: [__meta_kubernetes_pod_label_app]
            target_label: app
          - source_labels: [__meta_kubernetes_namespace]
            target_label: namespace
          - source_labels: [__meta_kubernetes_pod_name]
            target_label: pod
EOF

info "Applying Grafana datasources ConfigMap (minimal — InfluxDB + Prometheus + PostgreSQL)..."
oc apply -f - <<'EOF'
apiVersion: v1
kind: ConfigMap
metadata:
  name: grafana-datasources
  namespace: perf-testing
  labels: {app: grafana}
data:
  datasources.yml: |
    apiVersion: 1
    datasources:
      - name: InfluxDB-JMeter
        uid: influxdb-jmeter-ds
        type: influxdb
        access: proxy
        url: http://influxdb:8086
        jsonData:
          version: Flux
          organization: perf-testing
          defaultBucket: jmeter
          tlsSkipVerify: true
        secureJsonData:
          token: changeme123

      - name: Prometheus
        uid: prometheus-ds
        type: prometheus
        access: proxy
        url: http://prometheus:9090
        isDefault: true

      - name: PostgreSQL-PerfPlatform
        uid: postgres-ds
        type: postgres
        access: proxy
        url: postgresql:5432
        database: perfplatform
        user: perfplatform
        editable: true
        secureJsonData:
          password: changeme123
        jsonData:
          sslmode: disable
          maxOpenConns: 10
          maxIdleConns: 10
          connMaxLifetime: 14400
          postgresVersion: 1500
          timescaledb: false
EOF

info "Applying Grafana dashboard provider ConfigMap..."
oc apply -f - <<'EOF'
apiVersion: v1
kind: ConfigMap
metadata:
  name: grafana-dashboards-provider
  namespace: perf-testing
  labels: {app: grafana}
data:
  dashboard.yml: |
    apiVersion: 1
    providers:
      - name: perf-platform
        orgId: 1
        folder: JMeter
        type: file
        disableDeletion: false
        updateIntervalSeconds: 30
        allowUiUpdates: true
        options:
          path: /etc/grafana/provisioning/dashboards/json
          foldersFromFilesStructure: false
EOF

info "Applying Grafana alerting ConfigMap..."
oc apply -f - <<'EOF'
apiVersion: v1
kind: ConfigMap
metadata:
  name: grafana-alerting
  namespace: perf-testing
  labels: {app: grafana}
data:
  performance-alerts.yaml: |
    apiVersion: 1
    groups:
      - orgId: 1
        name: performance_degradation
        folder: Alerts
        interval: 1m
        rules:
          - uid: perf-error-rate-spike
            title: "Error Rate Spike"
            condition: C
            data:
              - refId: A
                relativeTimeRange: {from: 300, to: 0}
                datasourceUid: prometheus-ds
                model:
                  expr: |
                    100 * sum(rate(http_server_requests_seconds_count{status=~"5.."}[2m]))
                    / sum(rate(http_server_requests_seconds_count[2m]))
                  refId: A
              - refId: B
                relativeTimeRange: {from: 300, to: 0}
                datasourceUid: "__expr__"
                model: {type: reduce, refId: B, reducer: last, expression: A}
              - refId: C
                relativeTimeRange: {from: 300, to: 0}
                datasourceUid: "__expr__"
                model:
                  type: threshold
                  refId: C
                  expression: B
                  conditions:
                    - evaluator: {params: [1.0], type: gt}
                      operator: {type: and}
            noDataState: OK
            execErrState: OK
            for: 2m
            labels:
              severity: critical
          - uid: perf-regression-detected
            title: "Performance Regression Detected"
            condition: C
            data:
              - refId: A
                relativeTimeRange: {from: 900, to: 0}
                datasourceUid: postgres-ds
                model:
                  rawSql: |
                    SELECT NOW() AS time, COUNT(*) AS value
                    FROM regression_events
                    WHERE detected_at > NOW() - INTERVAL '15 minutes'
                      AND acknowledged = false AND false_positive = false
                      AND severity = 'critical'
                  format: time_series
                  refId: A
              - refId: B
                relativeTimeRange: {from: 900, to: 0}
                datasourceUid: "__expr__"
                model: {type: reduce, refId: B, reducer: last, expression: A}
              - refId: C
                relativeTimeRange: {from: 900, to: 0}
                datasourceUid: "__expr__"
                model:
                  type: threshold
                  refId: C
                  expression: B
                  conditions:
                    - evaluator: {params: [0], type: gt}
                      operator: {type: and}
            noDataState: OK
            execErrState: OK
            for: 0s
            labels:
              severity: warning
    contactPoints:
      - orgId: 1
        name: perf-platform-default
        receivers:
          - uid: perf-default-receiver
            type: email
            settings:
              addresses: perf-team@example.com
    policies:
      - orgId: 1
        receiver: perf-platform-default
        group_by: [alertname, service]
        group_wait: 30s
        group_interval: 5m
        repeat_interval: 4h
EOF

success "ConfigMaps applied"

# ══════════════════════════════════════════════════════════════════════════════
# STEP 5 — Dashboard ConfigMaps (all 9 JSONs — correlation panel will show
#           "datasource not found" for Loki/Tempo/Pyroscope panels; rest work)
# ══════════════════════════════════════════════════════════════════════════════
info "Applying dashboard JSON ConfigMaps..."
oc apply -f "$OC_DIR/18-grafana-dashboard-cms.yaml"
success "Dashboard ConfigMaps applied"

# ══════════════════════════════════════════════════════════════════════════════
# STEP 6 — PostgreSQL init scripts + StatefulSet
# ══════════════════════════════════════════════════════════════════════════════
info "Applying PostgreSQL init ConfigMap..."
oc apply -f "$OC_DIR/06b-postgres-init-cm.yaml"

info "Deploying PostgreSQL..."
oc apply -f "$OC_DIR/06-postgresql.yaml"
info "Waiting for PostgreSQL (up to 3m)..."
oc rollout status statefulset/postgresql -n "$NAMESPACE" --timeout=3m
success "PostgreSQL ready"

# ══════════════════════════════════════════════════════════════════════════════
# STEP 7 — InfluxDB
# ══════════════════════════════════════════════════════════════════════════════
info "Deploying InfluxDB..."
oc apply -f "$OC_DIR/07-influxdb.yaml"

# ══════════════════════════════════════════════════════════════════════════════
# STEP 8 — Build & push custom images
# ══════════════════════════════════════════════════════════════════════════════
if [[ "$SKIP_BUILD" == "false" ]]; then
  info "Logging in to OpenShift internal registry..."
  oc registry login --insecure=true 2>/dev/null || \
    docker login -u "$(oc whoami)" -p "$(oc whoami -t)" "$REGISTRY_ROUTE"

  build_and_push() {
    local name="$1" context="$2"
    local tag="$REGISTRY_ROUTE/$NAMESPACE/$name:latest"
    info "  Building $name..."
    docker build --platform linux/amd64 -t "$tag" "$context"
    info "  Pushing $name..."
    docker push "$tag"
    success "  $name → $tag"
  }

  build_and_push "perf-backend"           "$PROJECT_ROOT/backend"
  build_and_push "perf-frontend"          "$PROJECT_ROOT/frontend"
  build_and_push "perf-regression-engine" "$PROJECT_ROOT/regression-engine"
  build_and_push "perf-jmeter"            "$PROJECT_ROOT/jmeter"
else
  warn "Skipping image builds (--skip-build)"
fi

# ══════════════════════════════════════════════════════════════════════════════
# STEP 9 — Prometheus
# ══════════════════════════════════════════════════════════════════════════════
info "Deploying Prometheus..."
oc apply -f "$OC_DIR/12-prometheus.yaml"

# ══════════════════════════════════════════════════════════════════════════════
# STEP 10 — Grafana  (patch GF_SERVER_ROOT_URL with real domain)
# ══════════════════════════════════════════════════════════════════════════════
info "Deploying Grafana (domain: $APPS_DOMAIN)..."
sed "s/APPS_DOMAIN/$APPS_DOMAIN/g" "$OC_DIR/17-grafana.yaml" | oc apply -f -

# ══════════════════════════════════════════════════════════════════════════════
# STEP 11 — Application services
# ══════════════════════════════════════════════════════════════════════════════
info "Deploying Backend API..."
oc apply -f "$OC_DIR/08-backend.yaml"

info "Deploying Frontend UI (patching API URL)..."
sed "s/APPS_DOMAIN/$APPS_DOMAIN/g" "$OC_DIR/09-frontend.yaml" | oc apply -f -

info "Deploying Regression Engine..."
oc apply -f "$OC_DIR/11-regression-engine.yaml"

# ══════════════════════════════════════════════════════════════════════════════
# STEP 12 — Wait for all deployments
# ══════════════════════════════════════════════════════════════════════════════
info "Waiting for deployments to roll out (up to 5m each)..."
DEPLOYMENTS=(prometheus grafana backend frontend regression-engine)
for d in "${DEPLOYMENTS[@]}"; do
  info "  → $d"
  oc rollout status deployment/"$d" -n "$NAMESPACE" --timeout=5m \
    || warn "$d not fully ready — check: oc logs -l app=$d -n $NAMESPACE"
done

oc rollout status statefulset/influxdb -n "$NAMESPACE" --timeout=3m \
  || warn "InfluxDB not ready — check logs"

# ══════════════════════════════════════════════════════════════════════════════
# STEP 13 — Summary
# ══════════════════════════════════════════════════════════════════════════════
echo ""
echo -e "${GREEN}════════════════════════════════════════════════════════════${NC}"
echo -e "${GREEN}  🚀 Perf Platform (minimal) deployed on OpenShift!${NC}"
echo -e "${GREEN}════════════════════════════════════════════════════════════${NC}"
echo ""
echo -e "  ${YELLOW}Services deployed:${NC}"

print_route() {
  local label="$1" route="$2"
  local host
  host=$(oc get route "$route" -n "$NAMESPACE" \
    -o jsonpath='{.spec.host}' 2>/dev/null || echo "pending")
  printf "  %-22s ${CYAN}https://%s${NC}\n" "$label" "$host"
}

print_route "Frontend UI"       "perf-ui"
print_route "Backend API"       "perf-api"
print_route "Grafana"           "grafana"
print_route "Regression Engine" "perf-regression"

echo ""
echo -e "  ${YELLOW}Services NOT deployed (excluded):${NC}"
echo -e "  ✗ Loki (logs)       ✗ Tempo (traces)"
echo -e "  ✗ Pyroscope (profil) ✗ Sample App"
echo ""
echo -e "  Grafana login:  ${YELLOW}admin / changeme123${NC}"
echo -e "  Active dashboards: ${CYAN}JMeter Load Test, Run Comparison,"
echo -e "    SLO Tracker, Historical Trends, Regression Tracker, Executive Summary${NC}"
echo -e "  Note: Correlation View dashboard requires Loki/Tempo/Pyroscope."
echo ""
echo -e "  To add an app target for JMeter, deploy it separately and"
echo -e "  point JMeter jobs to its ClusterIP service."
echo ""
echo -e "  To tear down:  ${RED}./openshift/undeploy.sh${NC}"
echo -e "${GREEN}════════════════════════════════════════════════════════════${NC}"
