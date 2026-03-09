# Local Verification Guide — Performance Testing Platform

> **Complete guide to verify all components locally using Docker before deploying to OpenShift**

---

## 🚀 Quick Start (10 minutes)

### Prerequisites
```bash
# Install Docker & Docker Compose
docker --version      # 20.10+
docker-compose --version  # 2.0+

# Verify you can run containers
docker run hello-world
```

### 1. Build & Start Everything

```bash
# From perf-platform directory
cd perf-platform

# Build images (first time only, ~3-5 minutes)
docker-compose build

# Start all services
docker-compose up -d

# Wait for services to be healthy
docker-compose ps  # Check STATUS column
```

### 2. Access Services

```bash
# Frontend UI
http://localhost:3000

# Backend API
http://localhost:8080/api/v1/health

# Grafana Dashboard
http://localhost:3001  (user: admin, pass: changeme123)

# InfluxDB
http://localhost:8086

# Prometheus
http://localhost:9091
```

### 3. Verify Each Component

See sections below for detailed verification steps.

---

## 🗄️ PostgreSQL Verification

### Check Database Connectivity
```bash
# Connect to database
docker-compose exec postgresql psql -U perfplatform -d perfplatform -c "\dt"

# Expected output:
# List of relations
#         Schema |           Name           | Type  |     Owner
# --------+---------------------------+-------+---------------
#  public | environments              | table | perfplatform
#  public | knex_migrations           | table | perfplatform
#  public | knex_migrations_lock      | table | perfplatform
#  public | test_executions           | table | perfplatform
#  public | test_plans                | table | perfplatform
#  public | test_schedules            | table | perfplatform
```

### Check Data
```bash
# List environments
docker-compose exec postgresql psql -U perfplatform -d perfplatform -c "SELECT * FROM environments;"

# Expected output:
#  id |     name      |      description       |        base_url        | namespace  | created_at | updated_at
# ----+---------------+------------------------+------------------------+------------+------------+------------
#   1 | development   | Development environment| https://dev.example.com| perf-dev   | ...        | ...
#   2 | staging       | Staging / Pre-production| https://staging...    | perf-staging| ...        | ...
#   3 | production    | Production environment | https://example.com    | perf-prod  | ...        | ...
```

### Check Logs
```bash
# View PostgreSQL logs
docker-compose logs postgresql
```

### Test Connection from API
```bash
# API health check should return database: "connected"
curl http://localhost:8080/api/v1/health/ready

# Expected response:
# {"status":"ready","database":"connected"}
```

---

## 🖥️ Backend API Verification

### Check API is Running
```bash
# Liveness check
curl http://localhost:8080/api/v1/health
# Expected: {"status":"ok","timestamp":"..."}

# Readiness check
curl http://localhost:8080/api/v1/health/ready
# Expected: {"status":"ready","database":"connected"}
```

### Check Prometheus Metrics
```bash
# API metrics
curl http://localhost:8080/metrics | head -20

# Expected output (sample metrics):
# # HELP http_request_duration_seconds HTTP request latency in seconds
# # TYPE http_request_duration_seconds histogram
# http_request_duration_seconds_bucket{...} 0
# ...
```

### Test API Endpoints

#### 1. Create Environment
```bash
curl -X POST http://localhost:8080/api/v1/environments \
  -H "Content-Type: application/json" \
  -d '{
    "name": "test-env-1",
    "description": "Test environment",
    "base_url": "http://localhost:9000",
    "namespace": "perf-testing"
  }'

# Expected: 201 Created
# Response: {"data":{"id":4,"name":"test-env-1",...}}
```

#### 2. List Environments
```bash
curl http://localhost:8080/api/v1/environments

# Expected: 200 OK
# Response: {"data":[...]}
```

#### 3. Upload Test Plan
```bash
# First, create a simple JMX file
cat > /tmp/test.jmx <<'EOF'
<?xml version="1.0" encoding="UTF-8"?>
<jmeterTestPlan version="1.2">
  <hashTree>
    <TestPlan guiclass="TestPlanGui" testclass="TestPlan" testname="Simple Test">
      <ThreadGroup guiclass="ThreadGroupGui" testclass="ThreadGroup" testname="Thread Group">
        <stringProp name="ThreadGroup.num_threads">10</stringProp>
        <stringProp name="ThreadGroup.ramp_time">60</stringProp>
      </ThreadGroup>
    </TestPlan>
  </hashTree>
</jmeterTestPlan>
EOF

# Upload test plan
curl -X POST http://localhost:8080/api/v1/tests \
  -F "jmxFile=@/tmp/test.jmx" \
  -F "name=Local Test" \
  -F 'config={"host":"localhost","port":"9000","threads":"10","duration":"60"}'

# Expected: 201 Created
# Response: {"data":{"id":1,"name":"Local Test",...}}
```

#### 4. List Test Plans
```bash
curl http://localhost:8080/api/v1/tests

# Expected: 200 OK
# Response: {"data":[{"id":1,"name":"Local Test",...}],"total":1,"page":1,"limit":20}
```

#### 5. Create Execution
```bash
curl -X POST http://localhost:8080/api/v1/executions \
  -H "Content-Type: application/json" \
  -d '{
    "testPlanId": 1,
    "workerCount": 3,
    "parameters": {
      "host": "localhost",
      "port": "9000",
      "threads": "5",
      "duration": "30"
    }
  }'

# Expected: 202 Accepted
# Response: {"data":{"id":1,"status":"PENDING",...},"message":"..."}
```

#### 6. Get Execution Status
```bash
curl http://localhost:8080/api/v1/executions/1

# Expected: 200 OK
# Response: {"data":{"id":1,"status":"PENDING",...}}
```

### View API Logs
```bash
docker-compose logs -f api
```

---

## 🎨 Frontend UI Verification

### Access Dashboard
```bash
# Open browser
http://localhost:3000

# You should see:
# - Sidebar with navigation (Dashboard, Tests, Executions, etc.)
# - Dashboard page with stat cards
# - Buttons to upload tests, start tests
```

### Test Upload Flow
1. Go to **Test Plans** page (if available, or via API)
2. Create via API as shown above
3. Go back to Dashboard
4. Should see the test plan in "Recent Executions"

### Test Execution Flow
1. In Dashboard, look for "Active Tests" section
2. It should be empty initially
3. After creating execution via API, refresh page (or wait for auto-refresh)
4. Should see execution with status badge

### Verify Components Load
```bash
# Check if UI loads without errors
curl -s http://localhost:3000 | grep -c "script"
# Expected: >0 (JavaScript loaded)

# Check API connectivity
curl http://localhost:3000/_next/data/*/index.json
# Expected: 200 OK (Next.js data endpoint)
```

### View UI Logs
```bash
docker-compose logs -f ui
```

### Browser Console (Dev Tools)
1. Open http://localhost:3000 in Chrome/Firefox
2. Press F12 to open Developer Tools
3. Go to **Console** tab
4. Should NOT see any red errors (warnings are OK)
5. Go to **Network** tab
6. Try uploading a test plan
7. Should see XHR requests to /api/v1/tests with 201 response

---

## 📊 InfluxDB Verification

### Check InfluxDB is Running
```bash
# Ping endpoint
curl http://localhost:8086/ping

# Expected: 204 No Content
```

### Access InfluxDB CLI
```bash
# Connect to InfluxDB
docker-compose exec influxdb influx -username admin -password changeme123

# Inside InfluxDB shell:
> show databases
# Expected:
# name: databases
# name
# ----
# _internal
# jmeter

> use jmeter
> show measurements
# Expected: (empty initially, will populate when JMeter sends data)

> exit
```

### Check InfluxDB Logs
```bash
docker-compose logs influxdb
```

### Send Test Data to InfluxDB
```bash
# Simulate JMeter Backend Listener data
curl -X POST "http://localhost:8086/write?db=jmeter" \
  --data-binary "jmeter,test=example avg=100,min=50,max=200,p90=150,p99=190 $(date +%s)000000000"

# Verify data was written
docker-compose exec influxdb influx -username admin -password changeme123 -database jmeter -execute "SELECT * FROM jmeter"

# Expected:
# name: jmeter
# time                avg max min p90 p99 test
# ----                --- --- --- --- --- ----
# 1705... 100 200 50  150 190 example
```

---

## 📈 Grafana Verification

### Access Grafana
```bash
# Open browser
http://localhost:3001

# Login
# User: admin
# Password: changeme123

# Change password if prompted
```

### Verify Datasources
1. Go to **Configuration** (gear icon) → **Data Sources**
2. Should see: **InfluxDB-JMeter**
3. Click on it, should show: "Data source is working"
4. If not, check InfluxDB connectivity

### Create a Test Dashboard
1. Go to **Dashboards** → **+ New Dashboard**
2. Click **+ Add new panel**
3. Select datasource: **InfluxDB-JMeter**
4. In query, write: `SELECT * FROM jmeter`
5. Should show your test data from InfluxDB
6. Click **Save**

### Check Grafana Logs
```bash
docker-compose logs grafana
```

---

## 🔄 End-to-End Workflow Test

### Complete Flow (Local, without K8s)
Since we don't have Kubernetes locally, simulate a test execution:

#### Step 1: Create a Test Plan
```bash
curl -X POST http://localhost:8080/api/v1/tests \
  -F "jmxFile=@perf-platform/scenarios/example/example.jmx" \
  -F "name=E2E Test" \
  -F 'config={"host":"example.com","threads":"50","duration":"300"}'
```

#### Step 2: Simulate Test Execution
```bash
# In the database, manually create an execution record
docker-compose exec postgresql psql -U perfplatform -d perfplatform <<'EOF'
INSERT INTO test_executions
  (test_plan_id, status, triggered_by, worker_count, parameters, environment_id, started_at)
VALUES
  (1, 'COMPLETED', 'manual-test', 5, '{"threads":"50","duration":"300"}', 1, NOW() - INTERVAL '10 minutes');
EOF

# Verify
curl http://localhost:8080/api/v1/executions
```

#### Step 3: Send Test Metrics to InfluxDB
```bash
# Simulate JMeter Backend Listener sending live test data
for i in {1..10}; do
  TIMESTAMP=$(($(date +%s) - (10-i)*60))
  curl -X POST "http://localhost:8086/write?db=jmeter" \
    --data-binary "jmeter,test=E2E_Test count=$((1000+i*100)),avg=$((100+i*5)),p90=$((150+i*5)),p99=$((200+i*5)) ${TIMESTAMP}000000000"
done
```

#### Step 4: View in Grafana
1. Go to http://localhost:3001
2. Create a panel with query: `SELECT * FROM jmeter WHERE test='E2E_Test'`
3. Should see metrics chart with your test data

#### Step 5: View in UI
1. Go to http://localhost:3000
2. Should see execution in list with "COMPLETED" status
3. Click on execution → "View Report" should show summary

---

## 🐛 Troubleshooting

### Service Won't Start

```bash
# Check specific service logs
docker-compose logs postgresql  # PostgreSQL
docker-compose logs api          # API
docker-compose logs ui           # UI
docker-compose logs influxdb     # InfluxDB
docker-compose logs grafana      # Grafana

# Check resource usage
docker stats

# Restart service
docker-compose restart api
```

### API Can't Connect to Database
```bash
# Check database health
docker-compose ps postgresql

# Check network connectivity
docker-compose exec api ping postgresql

# Check database logs
docker-compose logs postgresql
```

### Port Already in Use
```bash
# Check what's using the port (macOS/Linux)
lsof -i :8080  # API
lsof -i :3000  # UI
lsof -i :5432  # PostgreSQL

# Kill process or change port in docker-compose.yml
```

### Persistent Data Issues
```bash
# Clear all data and start fresh
docker-compose down -v  # -v removes volumes
docker-compose up -d
```

---

## ✅ Verification Checklist

- [ ] PostgreSQL running and accessible
- [ ] Database has all 4 tables (test_plans, test_executions, test_schedules, environments)
- [ ] API responding to health checks
- [ ] API can connect to PostgreSQL
- [ ] Frontend UI loads without JavaScript errors
- [ ] Can upload test plan via API
- [ ] Can list test plans via API
- [ ] Can create execution via API
- [ ] InfluxDB running and accepting data writes
- [ ] Can query data from InfluxDB CLI
- [ ] Grafana dashboard loads
- [ ] Grafana can connect to InfluxDB datasource
- [ ] Prometheus scraping metrics

---

## 📊 Monitor All Logs Live

```bash
# Watch all services simultaneously
docker-compose logs -f

# Follow specific service
docker-compose logs -f api

# Last 100 lines
docker-compose logs --tail=100 api
```

---

## 🧹 Cleanup

```bash
# Stop all services (keep volumes)
docker-compose stop

# Stop and remove containers (keep volumes)
docker-compose down

# Stop and remove everything (delete all data)
docker-compose down -v

# Remove images
docker-compose down --rmi all
```

---

## 🎯 Next Steps After Local Verification

1. ✅ All services healthy → **Ready to deploy to OpenShift**
2. ✅ Can upload and list tests → **API working correctly**
3. ✅ UI shows data from API → **Frontend correctly configured**
4. ✅ Metrics visible in Grafana → **Monitoring stack working**

When all checks pass, deploy to OpenShift using the manifests in `manifests/` and `execution/manifests/platform/`

---

## 📞 Common API Test Commands

```bash
# Create environment
curl -X POST http://localhost:8080/api/v1/environments \
  -H "Content-Type: application/json" \
  -d '{"name":"local-env","base_url":"http://localhost:9000"}'

# List environments
curl http://localhost:8080/api/v1/environments

# Upload test plan
curl -X POST http://localhost:8080/api/v1/tests \
  -F "jmxFile=@/path/to/test.jmx" \
  -F "name=Test Name"

# List test plans
curl http://localhost:8080/api/v1/tests

# Create execution
curl -X POST http://localhost:8080/api/v1/executions \
  -H "Content-Type: application/json" \
  -d '{"testPlanId":1,"workerCount":3,"parameters":{}}'

# List executions
curl http://localhost:8080/api/v1/executions

# Get execution status
curl http://localhost:8080/api/v1/executions/1

# Create schedule
curl -X POST http://localhost:8080/api/v1/schedules \
  -H "Content-Type: application/json" \
  -d '{"testPlanId":1,"cronExpression":"0 2 * * *","workerCount":5}'

# Health check
curl http://localhost:8080/api/v1/health
curl http://localhost:8080/api/v1/health/ready

# Metrics
curl http://localhost:8080/metrics
```

---

**All verified locally? Ready to deploy to OpenShift!** 🚀
