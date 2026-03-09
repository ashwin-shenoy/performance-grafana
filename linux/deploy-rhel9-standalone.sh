#!/usr/bin/env bash
# =============================================================================
# deploy-rhel9-standalone.sh
# Bare-metal (no Docker) installer for the Performance Testing Platform
# Target OS : Red Hat Enterprise Linux 9 / Rocky Linux 9 / AlmaLinux 9
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
#   sudo bash deploy-rhel9-standalone.sh [OPTIONS]
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
echo " Performance Platform — RHEL 9 Standalone Installer"
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
dnf update -y -q
dnf install -y -q \
  curl wget gnupg2 ca-certificates \
  tar gzip unzip git jq rsync \
  java-17-openjdk-headless \
  policycoreutils-python-utils \
  firewalld

# Enable and start firewalld (required for firewall-cmd below)
systemctl enable firewalld --now

# ── Step 2: Node.js 20 LTS ───────────────────────────────────────────────────
echo
echo "▶ Step 2/9 — Installing Node.js ${NODE_MAJOR} LTS…"
if ! command -v node &>/dev/null; then
  curl -fsSL "https://rpm.nodesource.com/setup_${NODE_MAJOR}.x" | bash -
  dnf install -y -q nodejs
fi
echo "  node $(node --version)  npm $(npm --version)"

# ── Step 3: PostgreSQL 15 ────────────────────────────────────────────────────
echo
echo "▶ Step 3/9 — Installing PostgreSQL 15…"
if ! rpm -q postgresql15-server &>/dev/null; then
  dnf install -y -q \
    "https://download.postgresql.org/pub/repos/yum/reporpms/EL-9-x86_64/pgdg-redhat-repo-latest.noarch.rpm" \
    2>/dev/null || true
  dnf -q module disable postgresql -y 2>/dev/null || true
  dnf install -y -q postgresql15-server postgresql15
fi

# Initialize cluster if not yet done
PGDATA=/var/lib/pgsql/15/data
if [[ ! -f "${PGDATA}/PG_VERSION" ]]; then
  /usr/pgsql-15/bin/postgresql-15-setup initdb
fi

# Allow md5 auth for local connections (needed for JDBC/pg driver)
HBA="${PGDATA}/pg_hba.conf"
if ! grep -q "^host.*${DB_NAME}" "$HBA"; then
  sed -i "s|^host.*all.*all.*127.0.0.1/32.*ident|host    all             all             127.0.0.1/32            md5|" "$HBA"
  sed -i "s|^host.*all.*all.*::1/128.*ident|host    all             all             ::1/128                 md5|" "$HBA"
fi

systemctl enable postgresql-15 --now
sleep 2

# Create database and user (idempotent)
sudo -u postgres /usr/pgsql-15/bin/psql -tc \
  "SELECT 1 FROM pg_database WHERE datname='${DB_NAME}'" \
  | grep -q 1 || \
  sudo -u postgres /usr/pgsql-15/bin/psql -c "CREATE DATABASE ${DB_NAME};"

sudo -u postgres /usr/pgsql-15/bin/psql -tc \
  "SELECT 1 FROM pg_roles WHERE rolname='${DB_USER}'" \
  | grep -q 1 || \
  sudo -u postgres /usr/pgsql-15/bin/psql \
    -c "CREATE USER ${DB_USER} WITH PASSWORD '${DB_PASS}';"

sudo -u postgres /usr/pgsql-15/bin/psql \
  -c "GRANT ALL PRIVILEGES ON DATABASE ${DB_NAME} TO ${DB_USER};"
sudo -u postgres /usr/pgsql-15/bin/psql -d "${DB_NAME}" \
  -c "GRANT ALL ON SCHEMA public TO ${DB_USER};" 2>/dev/null || true

echo "  PostgreSQL database '${DB_NAME}' ready"

# ── Step 4: InfluxDB 2.x ─────────────────────────────────────────────────────
echo
echo "▶ Step 4/9 — Installing InfluxDB 2.x…"
if ! command -v influx &>/dev/null; then
  cat > /etc/yum.repos.d/influxdata.repo <<'REPO'
[influxdata]
name = InfluxData Repository
baseurl = https://repos.influxdata.com/rhel/9/x86_64/stable/
enabled = 1
gpgcheck = 1
gpgkey = https://repos.influxdata.com/influxdata-archive_compat.key
REPO
  dnf install -y -q influxdb2 influxdb2-cli
fi

# SELinux: allow influxd to bind its ports
semanage port -a -t http_port_t -p tcp 8086 2>/dev/null || true

systemctl enable influxdb --now
sleep 3

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
if ! rpm -q grafana &>/dev/null; then
  cat > /etc/yum.repos.d/grafana.repo <<'REPO'
[grafana]
name=grafana
baseurl=https://rpm.grafana.com
repo_gpgcheck=1
enabled=1
gpgcheck=1
gpgkey=https://rpm.grafana.com/gpg.key
sslverify=1
sslcacert=/etc/pki/tls/certs/ca-bundle.crt
REPO
  dnf install -y -q grafana
fi

# Grafana config
GRAFANA_INI=/etc/grafana/grafana.ini
sed -i "s|;root_url.*|root_url = ${GRAFANA_URL}|" "$GRAFANA_INI"
sed -i "s|;http_port.*|http_port = 3001|"          "$GRAFANA_INI"

# SELinux: allow grafana-server to bind port 3001
semanage port -a -t http_port_t -p tcp 3001 2>/dev/null || \
  semanage port -m -t http_port_t -p tcp 3001 2>/dev/null || true

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
if grep -q 'Xms1g' "${JMETER_DIR}/bin/jmeter" 2>/dev/null; then
  sed -i 's|-Xms1g -Xmx1g -XX:MaxMetaspaceSize=256m|-Xms2g -Xmx4g -XX:MaxMetaspaceSize=512m|' \
    "${JMETER_DIR}/bin/jmeter" 2>/dev/null || true
fi

# SELinux: label JMeter binary so it can execute
restorecon -Rv "$JMETER_DIR" 2>/dev/null || true

# ── Step 7: Install platform application files ────────────────────────────────
echo
echo "▶ Step 7/9 — Installing platform application files…"
mkdir -p "$INSTALL_DIR" "$REPORT_DIR"

# Copy source
rsync -a --exclude='.git' --exclude='node_modules' --exclude='.next' \
  --exclude='report' --exclude='.env' \
  "${APP_SRC}/" "${INSTALL_DIR}/"

# Determine psql binary path
PSQL_BIN=$(command -v psql || echo /usr/pgsql-15/bin/psql)

# Create backend .env
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

# Create frontend .env
cat > "${INSTALL_DIR}/frontend/.env.production" <<EOF
NEXT_PUBLIC_API_URL=${API_URL}/api/v1
EOF

# Create sample-app .env
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
useradd --system --no-create-home --shell /sbin/nologin perf-platform 2>/dev/null || true
chown -R perf-platform:perf-platform "${INSTALL_DIR}" "${REPORT_DIR}"
chmod -R 755 "${INSTALL_DIR}"

# SELinux: allow the perf-platform processes to bind their ports
for port in 8080 3000 3002; do
  semanage port -a -t http_port_t -p tcp "$port" 2>/dev/null || \
  semanage port -m -t http_port_t -p tcp "$port" 2>/dev/null || true
done

# SELinux: allow Node.js to write to the results directory
semanage fcontext -a -t var_t "${REPORT_DIR}(/.*)?" 2>/dev/null || true
restorecon -Rv "${REPORT_DIR}" 2>/dev/null || true

# ── Step 8: systemd service units ─────────────────────────────────────────────
echo
echo "▶ Step 8/9 — Creating systemd service units…"

# ── perf-api ──────────────────────────────────────────────────────────────────
cat > /etc/systemd/system/perf-api.service <<SERVICE
[Unit]
Description=Performance Platform API (Node.js)
After=network.target postgresql-15.service influxdb.service

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

if command -v firewall-cmd &>/dev/null; then
  for port in 3000 8080 3001 3002; do
    firewall-cmd --permanent --add-port="${port}/tcp" 2>/dev/null || true
  done
  firewall-cmd --reload 2>/dev/null || true
  echo "  firewalld ports opened: 3000 8080 3001 3002"
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
echo "SELinux troubleshooting (if services fail to start):"
echo "  sudo ausearch -m avc -ts recent | audit2allow -a"
echo "  sudo setsebool -P httpd_can_network_connect 1"
echo
echo "To update the platform:"
echo "  cd ${APP_SRC} && git pull"
echo "  sudo bash linux/deploy-rhel9-standalone.sh --skip-build=false"
echo "  sudo systemctl restart perf-api perf-ui"
echo "============================================================"
