#!/usr/bin/env bash
# =============================================================================
# deploy-ubuntu22-standalone.sh
# Bare-metal (no Docker) installer for the Performance Testing Platform
# Target OS : Ubuntu 22.04 LTS
#
# Services installed and managed by systemd:
#   postgresql-15   – metadata store
#   influxdb        – JMeter time-series store
#   grafana-server  – dashboards
#   perf-api        – Node.js backend  (port 8080)
#   perf-ui         – Next.js frontend  (port 3000)
#   perf-sample-app – sample target app (port 3002)
#
# JMeter is installed to /opt/jmeter and invoked at runtime by perf-api.
#
# Usage:
#   sudo bash deploy-ubuntu22-standalone.sh [OPTIONS]
#
# Options:
#   --app-dir DIR       Source directory (default: parent of this script)
#   --install-dir DIR   Install root      (default: /opt/perf-platform)
#   --domain DOMAIN     Public hostname or IP for Grafana/API external URLs
#   --influx-token TOK  InfluxDB admin token (default: changeme123 – change in prod!)
#   --db-pass PASS      PostgreSQL perf user password (default: perf123)
#   --skip-build        Skip npm install / Next.js build
#   --skip-services     Install files only, do not enable/start systemd services
# =============================================================================
set -euo pipefail

# ── Defaults ──────────────────────────────────────────────────────────────────
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
APP_SRC="${APP_SRC:-$(dirname "$SCRIPT_DIR")}"
INSTALL_DIR="${INSTALL_DIR:-/opt/perf-platform}"
DOMAIN="${DOMAIN:-}"
INFLUX_ORG="perf-testing"
INFLUX_BUCKET="jmeter"
INFLUX_TOKEN="${INFLUX_TOKEN:-changeme123}"
DB_NAME="perf_platform"
DB_USER="perf"
DB_PASS="${DB_PASS:-perf123}"
JMETER_VERSION="5.6.3"
JMETER_DIR="/opt/jmeter"
NODE_MAJOR=20
SKIP_BUILD=false
SKIP_SERVICES=false

# ── Argument parsing ───────────────────────────────────────────────────────────
while [[ $# -gt 0 ]]; do
  case "$1" in
    --app-dir)      APP_SRC="$2";      shift 2 ;;
    --install-dir)  INSTALL_DIR="$2";  shift 2 ;;
    --domain)       DOMAIN="$2";       shift 2 ;;
    --influx-token) INFLUX_TOKEN="$2"; shift 2 ;;
    --db-pass)      DB_PASS="$2";      shift 2 ;;
    --skip-build)   SKIP_BUILD=true;   shift   ;;
    --skip-services) SKIP_SERVICES=true; shift  ;;
    *) echo "Unknown option: $1"; exit 1 ;;
  esac
done

# Auto-detect public IP/hostname if --domain not given
if [[ -z "$DOMAIN" ]]; then
  DOMAIN=$(ip -4 route get 1.1.1.1 2>/dev/null | awk '{print $7; exit}')
  [[ -z "$DOMAIN" ]] && DOMAIN="localhost"
fi

GRAFANA_URL="http://${DOMAIN}:3001"
API_URL="http://${DOMAIN}:8080"
REPORT_DIR="${INSTALL_DIR}/report"

echo "============================================================"
echo " Performance Platform — Ubuntu 22 Standalone Installer"
echo "============================================================"
echo "  Source      : $APP_SRC"
echo "  Install dir : $INSTALL_DIR"
echo "  Public addr : $DOMAIN"
echo "  Grafana URL : $GRAFANA_URL"
echo "  API URL     : $API_URL"
echo "============================================================"

# Must run as root
[[ $EUID -ne 0 ]] && { echo "ERROR: Run this script as root (sudo)"; exit 1; }

# ── Step 1: System prerequisites ─────────────────────────────────────────────
echo
echo "▶ Step 1/9 — Updating system and installing prerequisites…"
export DEBIAN_FRONTEND=noninteractive
apt-get update -qq
apt-get install -y --no-install-recommends \
  curl wget gnupg lsb-release ca-certificates \
  apt-transport-https software-properties-common \
  build-essential git unzip tar jq \
  openjdk-17-jre-headless

# ── Step 2: Node.js 20 LTS ───────────────────────────────────────────────────
echo
echo "▶ Step 2/9 — Installing Node.js ${NODE_MAJOR} LTS…"
if ! command -v node &>/dev/null || [[ "$(node -e 'process.exit(process.version.split(".")[0].slice(1))')" -lt "$NODE_MAJOR" ]]; then
  curl -fsSL "https://deb.nodesource.com/setup_${NODE_MAJOR}.x" | bash -
  apt-get install -y nodejs
fi
echo "  node $(node --version)  npm $(npm --version)"

# ── Step 3: PostgreSQL 15 ────────────────────────────────────────────────────
echo
echo "▶ Step 3/9 — Installing PostgreSQL 15…"
if ! dpkg -l postgresql-15 &>/dev/null; then
  curl -fsSL https://www.postgresql.org/media/keys/ACCC4CF8.asc \
    | gpg --dearmor -o /usr/share/keyrings/postgresql.gpg
  echo "deb [signed-by=/usr/share/keyrings/postgresql.gpg] \
https://apt.postgresql.org/pub/repos/apt $(lsb_release -cs)-pgdg main" \
    > /etc/apt/sources.list.d/pgdg.list
  apt-get update -qq
  apt-get install -y postgresql-15
fi
systemctl enable postgresql --now

# Create database and user (idempotent)
sudo -u postgres psql -tc "SELECT 1 FROM pg_database WHERE datname='${DB_NAME}'" \
  | grep -q 1 || sudo -u postgres psql -c "CREATE DATABASE ${DB_NAME};"
sudo -u postgres psql -tc "SELECT 1 FROM pg_roles WHERE rolname='${DB_USER}'" \
  | grep -q 1 || sudo -u postgres psql -c "CREATE USER ${DB_USER} WITH PASSWORD '${DB_PASS}';"
sudo -u postgres psql -c "GRANT ALL PRIVILEGES ON DATABASE ${DB_NAME} TO ${DB_USER};"
# Required for schema-creation in PG 15+
sudo -u postgres psql -d "${DB_NAME}" \
  -c "GRANT ALL ON SCHEMA public TO ${DB_USER};" 2>/dev/null || true
echo "  PostgreSQL database '${DB_NAME}' ready"

# ── Step 4: InfluxDB 2.x ─────────────────────────────────────────────────────
echo
echo "▶ Step 4/9 — Installing InfluxDB 2.x…"
if ! command -v influx &>/dev/null; then
  curl -fsSL https://repos.influxdata.com/influxdata-archive_compat.key \
    | gpg --dearmor -o /usr/share/keyrings/influxdata.gpg
  echo "deb [signed-by=/usr/share/keyrings/influxdata.gpg] \
https://repos.influxdata.com/ubuntu stable main" \
    > /etc/apt/sources.list.d/influxdata.list
  apt-get update -qq
  apt-get install -y influxdb2 influxdb2-cli
fi
systemctl enable influxdb --now
sleep 3   # allow influxd to start

# Bootstrap InfluxDB (idempotent — only runs if not yet configured)
if influx bucket list --token "${INFLUX_TOKEN}" --org "${INFLUX_ORG}" &>/dev/null; then
  echo "  InfluxDB already configured — skipping setup"
else
  influx setup \
    --username admin \
    --password "admin1234!" \
    --org "${INFLUX_ORG}" \
    --bucket "${INFLUX_BUCKET}" \
    --token "${INFLUX_TOKEN}" \
    --retention 30d \
    --force || true
fi
echo "  InfluxDB org=${INFLUX_ORG} bucket=${INFLUX_BUCKET} ready"

# ── Step 5: Grafana ───────────────────────────────────────────────────────────
echo
echo "▶ Step 5/9 — Installing Grafana…"
if ! dpkg -l grafana &>/dev/null; then
  curl -fsSL https://apt.grafana.com/gpg.key \
    | gpg --dearmor -o /usr/share/keyrings/grafana.gpg
  echo "deb [signed-by=/usr/share/keyrings/grafana.gpg] \
https://apt.grafana.com stable main" \
    > /etc/apt/sources.list.d/grafana.list
  apt-get update -qq
  apt-get install -y grafana
fi

# Grafana config: set root_url so deep-links work with external IP
GRAFANA_INI=/etc/grafana/grafana.ini
sed -i "s|;root_url.*|root_url = ${GRAFANA_URL}|" "$GRAFANA_INI"
sed -i "s|;http_port.*|http_port = 3001|"          "$GRAFANA_INI"

# Provision InfluxDB datasource
mkdir -p /etc/grafana/provisioning/datasources
cat > /etc/grafana/provisioning/datasources/influxdb-jmeter.yaml <<YAML
apiVersion: 1
datasources:
  - name: InfluxDB-JMeter
    uid: influxdb-jmeter-ds
    type: influxdb
    access: proxy
    url: http://localhost:8086
    isDefault: true
    jsonData:
      version: Flux
      organization: ${INFLUX_ORG}
      defaultBucket: ${INFLUX_BUCKET}
    secureJsonData:
      token: ${INFLUX_TOKEN}
YAML

# Provision JMeter dashboard
mkdir -p /etc/grafana/provisioning/dashboards
mkdir -p /var/lib/grafana/dashboards

cat > /etc/grafana/provisioning/dashboards/provider.yaml <<YAML
apiVersion: 1
providers:
  - name: jmeter-perf
    type: file
    options:
      path: /var/lib/grafana/dashboards
YAML

if [[ -f "${APP_SRC}/grafana/provisioning/dashboards/jmeter-perf.json" ]]; then
  cp "${APP_SRC}/grafana/provisioning/dashboards/jmeter-perf.json" \
     /var/lib/grafana/dashboards/jmeter-perf.json
  chown grafana:grafana /var/lib/grafana/dashboards/jmeter-perf.json
  echo "  Grafana dashboard provisioned from source"
else
  echo "  WARNING: jmeter-perf.json not found at ${APP_SRC}/grafana/provisioning/dashboards/"
fi

systemctl enable grafana-server --now
echo "  Grafana listening on :3001"

# ── Step 6: Apache JMeter ─────────────────────────────────────────────────────
echo
echo "▶ Step 6/9 — Installing Apache JMeter ${JMETER_VERSION}…"
if [[ ! -f "${JMETER_DIR}/bin/jmeter" ]]; then
  TMP_TGZ="/tmp/apache-jmeter-${JMETER_VERSION}.tgz"
  [[ ! -f "$TMP_TGZ" ]] && \
    wget -q -O "$TMP_TGZ" \
      "https://archive.apache.org/dist/jmeter/binaries/apache-jmeter-${JMETER_VERSION}.tgz"
  mkdir -p "$JMETER_DIR"
  tar -xzf "$TMP_TGZ" -C /opt --strip-components=1 \
    "apache-jmeter-${JMETER_VERSION}/"
  chmod +x "${JMETER_DIR}/bin/jmeter"
  echo "  JMeter installed at ${JMETER_DIR}"
else
  echo "  JMeter already installed at ${JMETER_DIR}"
fi

# Increase JMeter heap for real load tests
JMETER_PROPS="${JMETER_DIR}/bin/jmeter"
if ! grep -q 'Xms1g' "${JMETER_DIR}/bin/jmeter"; then
  sed -i 's|: "${HEAP:="-Xms1g -Xmx1g -XX:MaxMetaspaceSize=256m"}"|: "${HEAP:="-Xms2g -Xmx4g -XX:MaxMetaspaceSize=512m"}"|' \
    "${JMETER_DIR}/bin/jmeter" 2>/dev/null || true
fi

# ── Step 7: Install platform application files ────────────────────────────────
echo
echo "▶ Step 7/9 — Installing platform application files…"
mkdir -p "$INSTALL_DIR" "$REPORT_DIR"

# Copy source files
rsync -a --exclude='.git' --exclude='node_modules' --exclude='.next' \
  --exclude='report' --exclude='.env' \
  "${APP_SRC}/" "${INSTALL_DIR}/"

# Create .env for backend
cat > "${INSTALL_DIR}/backend/.env" <<EOF
NODE_ENV=production
PORT=8080

# Execution mode
STANDALONE_MODE=true
JMETER_BIN=${JMETER_DIR}/bin/jmeter
RESULTS_PATH=${REPORT_DIR}

# PostgreSQL
DATABASE_URL=postgresql://${DB_USER}:${DB_PASS}@localhost:5432/${DB_NAME}

# InfluxDB
INFLUXDB_URL=http://localhost:8086/api/v2/write?org=${INFLUX_ORG}&bucket=${INFLUX_BUCKET}&precision=ms
INFLUXDB_TOKEN=${INFLUX_TOKEN}

# Grafana
GRAFANA_EXTERNAL_URL=${GRAFANA_URL}
EOF

# Create .env for frontend
cat > "${INSTALL_DIR}/frontend/.env.production" <<EOF
NEXT_PUBLIC_API_URL=${API_URL}/api/v1
EOF

# Create .env for sample-app
cat > "${INSTALL_DIR}/sample-app/.env" <<EOF
NODE_ENV=production
PORT=3002
EOF

if [[ "$SKIP_BUILD" == "false" ]]; then
  echo "  Installing backend dependencies…"
  npm install --omit=dev --prefix "${INSTALL_DIR}/backend" --silent

  echo "  Running DB migrations…"
  cd "${INSTALL_DIR}/backend"
  node -e "require('./src/database/migrate').runMigrations().then(() => process.exit(0)).catch(e => { console.error(e); process.exit(1); })"
  cd -

  echo "  Installing frontend dependencies and building…"
  npm install --prefix "${INSTALL_DIR}/frontend" --silent
  npm run build --prefix "${INSTALL_DIR}/frontend" 2>&1 | tail -5

  echo "  Installing sample-app dependencies…"
  npm install --omit=dev --prefix "${INSTALL_DIR}/sample-app" --silent
fi

# Fix permissions
useradd --system --no-create-home --shell /usr/sbin/nologin perf-platform 2>/dev/null || true
chown -R perf-platform:perf-platform "${INSTALL_DIR}" "${REPORT_DIR}"
chmod -R 755 "${INSTALL_DIR}"

# ── Step 8: systemd service units ─────────────────────────────────────────────
echo
echo "▶ Step 8/9 — Creating systemd service units…"

# ── perf-api ──────────────────────────────────────────────────────────────────
cat > /etc/systemd/system/perf-api.service <<SERVICE
[Unit]
Description=Performance Platform API (Node.js)
After=network.target postgresql.service influxdb.service

[Service]
Type=simple
User=perf-platform
WorkingDirectory=${INSTALL_DIR}/backend
EnvironmentFile=${INSTALL_DIR}/backend/.env
ExecStart=$(which node) src/index.js
Restart=on-failure
RestartSec=10
StandardOutput=journal
StandardError=journal
SyslogIdentifier=perf-api

[Install]
WantedBy=multi-user.target
SERVICE

# ── perf-ui ───────────────────────────────────────────────────────────────────
cat > /etc/systemd/system/perf-ui.service <<SERVICE
[Unit]
Description=Performance Platform UI (Next.js)
After=network.target perf-api.service

[Service]
Type=simple
User=perf-platform
WorkingDirectory=${INSTALL_DIR}/frontend
Environment=NODE_ENV=production
Environment=PORT=3000
EnvironmentFile=${INSTALL_DIR}/frontend/.env.production
ExecStart=$(which node) node_modules/.bin/next start -p 3000
Restart=on-failure
RestartSec=10
StandardOutput=journal
StandardError=journal
SyslogIdentifier=perf-ui

[Install]
WantedBy=multi-user.target
SERVICE

# ── perf-sample-app ───────────────────────────────────────────────────────────
cat > /etc/systemd/system/perf-sample-app.service <<SERVICE
[Unit]
Description=Performance Platform Sample Target App
After=network.target

[Service]
Type=simple
User=perf-platform
WorkingDirectory=${INSTALL_DIR}/sample-app
EnvironmentFile=${INSTALL_DIR}/sample-app/.env
ExecStart=$(which node) src/index.js
Restart=on-failure
RestartSec=10
StandardOutput=journal
StandardError=journal
SyslogIdentifier=perf-sample-app

[Install]
WantedBy=multi-user.target
SERVICE

systemctl daemon-reload

# ── Step 9: Firewall and service startup ─────────────────────────────────────
echo
echo "▶ Step 9/9 — Configuring firewall and starting services…"

if command -v ufw &>/dev/null; then
  ufw allow 3000/tcp comment "perf-ui"      2>/dev/null || true
  ufw allow 8080/tcp comment "perf-api"     2>/dev/null || true
  ufw allow 3001/tcp comment "grafana"      2>/dev/null || true
  ufw allow 3002/tcp comment "perf-sample"  2>/dev/null || true
  echo "  ufw rules added"
fi

if [[ "$SKIP_SERVICES" == "false" ]]; then
  for svc in perf-api perf-ui perf-sample-app; do
    systemctl enable "$svc" --now
    echo "  Started $svc"
  done

  # Wait for API to respond
  echo "  Waiting for API health check…"
  for i in $(seq 1 30); do
    if curl -sf "http://localhost:8080/api/v1/health" &>/dev/null; then
      echo "  API is healthy ✓"
      break
    fi
    sleep 2
    [[ $i -eq 30 ]] && echo "  WARNING: API did not respond in 60s — check: journalctl -u perf-api -f"
  done
fi

# ── Summary ───────────────────────────────────────────────────────────────────
echo
echo "============================================================"
echo " Installation complete!"
echo "============================================================"
echo
echo "  UI         →  http://${DOMAIN}:3000"
echo "  API        →  http://${DOMAIN}:8080/api/v1/health"
echo "  Grafana    →  ${GRAFANA_URL}    (admin / admin)"
echo "  Sample App →  http://${DOMAIN}:3002"
echo
echo "Service management:"
echo "  sudo systemctl status perf-api perf-ui perf-sample-app"
echo "  sudo journalctl -u perf-api -f"
echo "  sudo journalctl -u perf-ui  -f"
echo
echo "InfluxDB:"
echo "  URL   : http://${DOMAIN}:8086"
echo "  Org   : ${INFLUX_ORG}"
echo "  Bucket: ${INFLUX_BUCKET}"
echo "  Token : ${INFLUX_TOKEN}"
echo
echo "JMeter binary: ${JMETER_DIR}/bin/jmeter"
echo "Reports dir  : ${REPORT_DIR}"
echo
echo "To update the platform:"
echo "  cd ${APP_SRC} && git pull"
echo "  sudo bash linux/deploy-ubuntu22-standalone.sh --skip-build=false"
echo "  sudo systemctl restart perf-api perf-ui"
echo "============================================================"
