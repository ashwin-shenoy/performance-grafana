# Performance Testing Platform — Production-Grade, OpenShift-Native

> **End-to-end distributed JMeter testing platform with full-stack web UI, REST API, scheduling, and observability**

---

## 📋 Overview

This is a **complete, production-ready** performance testing platform designed for OpenShift/Kubernetes. It enables teams to:

✅ **Upload and manage** JMeter test plans (.jmx files)
✅ **Launch distributed tests** with dynamically scaled worker pods
✅ **Monitor in real-time** with live dashboards (Grafana + Prometheus)
✅ **Schedule recurring tests** via cron expressions
✅ **View detailed reports** with HTML outputs and metrics charts
✅ **Compare test runs** side-by-side to track regressions
✅ **Support multi-tenancy** — multiple users, environments, concurrent tests
✅ **Integrate with CI/CD** — webhook triggers, REST API, Tekton pipelines

---

## 🏗️ Architecture at a Glance

```
┌──────────────────────────────────────────────────────┐
│                Frontend UI (React)                   │
│    Dashboard | Tests | Executions | Reports         │
└─────────────────────┬────────────────────────────────┘
                      │ HTTPS Route
                      │
┌─────────────────────v────────────────────────────────┐
│              Backend API (Node.js)                    │
│    REST endpoints for test lifecycle management      │
└─────────────────────┬────────────────────────────────┘
                      │
        ┌─────────────┼─────────────┐
        │             │             │
        v             v             v
    PostgreSQL   Kubernetes    Monitoring
    (metadata)   (Jobs/Pods)    (Prometheus,
                                Grafana)
```

---

## 📁 Project Structure

```
perf-platform/
├── backend/                          # Node.js API service
│   ├── src/
│   │   ├── server.js                 # Express.js entry
│   │   ├── routes/                   # API endpoints
│   │   ├── services/                 # Business logic
│   │   ├── models/                   # Data access (Knex.js)
│   │   ├── jobs/                     # Cron scheduler
│   │   └── config/                   # Database + K8s
│   ├── migrations/                   # Database migrations
│   └── Dockerfile                    # Multi-stage Node.js image
│
├── frontend/                         # Next.js React UI
│   ├── src/
│   │   ├── pages/                    # Next.js pages
│   │   ├── components/               # React components
│   │   ├── services/                 # API client (Axios)
│   │   └── types/                    # TypeScript interfaces
│   └── Dockerfile                    # Next.js Docker image
│
├── database/                         # PostgreSQL schema
│   └── 001_initial_schema.sql        # DDL for all tables
│
├── execution/
│   ├── docker/
│   │   └── jmeter-base/              # JMeter 5.6.3 + Jolokia
│   │       └── Dockerfile
│   └── manifests/
│       ├── platform/                 # API, UI, PostgreSQL deployments
│       └── monitoring/               # Prometheus, Grafana, ServiceMonitors
│
├── manifests/                        # Core JMeter infrastructure
│   ├── base/                         # Namespace, RBAC, SCC, PVC
│   ├── jmeter/                       # Controller/Worker Job templates
│   └── monitoring/                   # InfluxDB, Grafana
│
├── docs/
│   └── ARCHITECTURE.md               # Comprehensive architecture guide
│
└── README.md                         # This file
```

---

## 🚀 Quick Start (5 minutes)

### Prerequisites
- OpenShift 4.x cluster with `oc` CLI
- 4+ CPUs, 8+ GB RAM available
- Container registry (local or cloud)

### Deploy

```bash
# 1. Create namespace + base resources
oc create namespace perf-testing
oc apply -f manifests/base/

# 2. Add SCC
oc adm policy add-scc-to-user jmeter-scc \
  system:serviceaccount:perf-testing:jmeter-orchestrator

# 3. Deploy database
oc apply -f execution/manifests/platform/postgresql.yaml
sleep 30

# 4. Deploy API + UI
oc apply -f execution/manifests/platform/api-deployment.yaml
oc apply -f execution/manifests/platform/ui-deployment.yaml

# 5. Deploy JMeter infrastructure
oc apply -f manifests/jmeter/
oc apply -f manifests/monitoring/

# 6. Verify
oc get routes -n perf-testing
oc get pods -n perf-testing
```

### Access
```bash
# Get URL
oc get route perf-platform -n perf-testing -o jsonpath='{.spec.host}'

# Open in browser
https://perf-platform-perf-testing.apps.your-cluster.com
```

---

## 📊 Usage Example

### 1. Upload a Test Plan
```bash
curl -X POST https://perf-platform-api-perf-testing.apps.your-cluster.com/api/v1/tests \
  -F "jmxFile=@my-test.jmx" \
  -F "name=API Load Test" \
  -F 'config={"host":"api.example.com","threads":"50","duration":"300"}'
```

### 2. Start a Test
```bash
curl -X POST https://perf-platform-api-perf-testing.apps.your-cluster.com/api/v1/executions \
  -H "Content-Type: application/json" \
  -d '{
    "testPlanId": 1,
    "workerCount": 10,
    "parameters": { "threads": "100", "duration": "600" }
  }'
```

### 3. Check Status
```bash
curl https://perf-platform-api-perf-testing.apps.your-cluster.com/api/v1/executions/1
```

### 4. View Results
Open UI → Executions → Click execution → "View Report"

---

## 📈 Monitoring

### Grafana Dashboards (4 pre-built)
1. **JMeter Results** — Throughput, response times, error rate
2. **JVM Metrics** — Heap, GC, threads
3. **Kubernetes** — Pod resource usage
4. **Platform API** — Request latency, error rate

**Access**:
```bash
oc get route grafana -n perf-testing -o jsonpath='{.spec.host}'
```

### Alerts
- Worker OOM (>90% memory)
- Worker high CPU (>85% for 5+ min)
- API down
- Test stuck (>2 hours)

---

## 🏛️ Key Components

| Component | Language | Port | Role |
|---|---|---|---|
| **perf-platform-ui** | React/Next.js | 3000 | Web dashboard |
| **perf-platform-api** | Node.js | 8080 | REST API orchestrator |
| **postgresql** | SQL | 5432 | Test metadata store |
| **jmeter-controller** | Java | 1099 | Test coordinator |
| **jmeter-workers** | Java | 1099 | Load generators |
| **grafana** | Dashboard | 3000 | Visualization |
| **influxdb** | TSDB | 8086 | Live test metrics |
| **prometheus** | TSDB | 9090 | Infrastructure metrics |

---

## 🔌 REST API Endpoints

### Test Plans
```
POST   /api/v1/tests                Upload JMX
GET    /api/v1/tests                List test plans
GET    /api/v1/tests/:id            Get details
PUT    /api/v1/tests/:id            Update
DELETE /api/v1/tests/:id            Delete
```

### Executions
```
POST   /api/v1/executions           Start test
GET    /api/v1/executions           List executions
GET    /api/v1/executions/:id       Get status + pods
POST   /api/v1/executions/:id/stop  Stop test
GET    /api/v1/executions/compare   Compare runs
```

### Schedules
```
POST   /api/v1/schedules            Create schedule
GET    /api/v1/schedules            List schedules
PUT    /api/v1/schedules/:id        Update
DELETE /api/v1/schedules/:id        Delete
```

### Reports
```
GET    /api/v1/reports/:id          Get report metadata
GET    /api/v1/reports/:id/summary  Get parsed stats
GET    /api/v1/reports/:id/html     View HTML report
```

### Health
```
GET    /api/v1/health               Liveness
GET    /api/v1/health/ready         Readiness
GET    /metrics                     Prometheus metrics
```

---

## 📦 Database Schema

### Tables (PostgreSQL)

**environments**
- id, name, description, base_url, namespace

**test_plans**
- id, name, description, jmx_file_name, jmx_content (TEXT)
- created_by, environment_id, config (JSONB)

**test_executions**
- id, test_plan_id, status, triggered_by, worker_count
- parameters (JSONB), environment_id
- controller_job_name, worker_job_name, kube_namespace
- jtl_path, report_path, summary (JSONB), error_message
- started_at, finished_at

**test_schedules**
- id, test_plan_id, cron_expression, worker_count
- parameters (JSONB), environment_id, enabled, last_run_at

---

## 🎯 Features

### Test Management
- ✅ Upload .jmx files with metadata
- ✅ Parameterized test configuration
- ✅ Test plan versioning (via Git)
- ✅ Multi-environment support (dev/staging/prod)

### Execution
- ✅ One-click test launch
- ✅ Dynamic worker scaling (1-100+ workers)
- ✅ Live status monitoring
- ✅ Stop/pause running tests
- ✅ Automatic resource cleanup

### Scheduling
- ✅ Cron-based recurring tests
- ✅ Test parameter overrides per schedule
- ✅ Execution history tracking

### Reporting
- ✅ HTML reports (JMeter native)
- ✅ Response time percentiles (avg/p90/p95/p99)
- ✅ Throughput and error rate
- ✅ Test comparison (side-by-side metrics)
- ✅ Export results (JTL format)

### Monitoring
- ✅ Prometheus metrics
- ✅ Grafana dashboards (4 pre-built)
- ✅ Alerting rules (OOM, CPU, API health)
- ✅ Instana APM integration (optional)

### Multi-Tenancy
- ✅ User/team isolation
- ✅ Environment isolation (dev/staging/prod)
- ✅ Concurrent test support
- ✅ RBAC-ready (OpenShift OAuth)

---

## 🔒 Security

### Authentication (Ready for OpenShift OAuth)
- Current: Basic API access via headers
- Integrate with OpenShift OAuth2 Proxy:
  ```bash
  oc new-app oauth-proxy ...
  ```

### Authorization (RBAC)
- ServiceAccount: `jmeter-orchestrator`
- Role permissions: create/delete Jobs, read Pods, access PVC
- Future: User-based RBAC (admin, user, viewer roles)

### Data Protection
- Secrets stored in PostgreSQL (use External Secrets in prod)
- TLS routes for all HTTP endpoints
- No sensitive data in logs (structured JSON only)

---

## 📚 Documentation

- **Architecture**: See `docs/ARCHITECTURE.md` for detailed design
- **API Docs**: Inline comments in `backend/src/routes/*.js`
- **Database**: Schema in `database/001_initial_schema.sql`
- **Deployment**: Instructions in this README

---

## 🛠️ Development

### Build Images
```bash
# Backend API
docker build -t perf-platform-api:latest backend/

# Frontend UI
docker build -t perf-platform-ui:latest frontend/

# JMeter base
docker build -t jmeter-base:5.6.3 execution/docker/jmeter-base/

# Push to registry
docker push <registry>/perf-platform-api:latest
docker push <registry>/perf-platform-ui:latest
docker push <registry>/jmeter-base:5.6.3
```

### Local Testing
```bash
# Start backend
cd backend && npm install && npm run dev

# Start frontend (separate terminal)
cd frontend && npm install && npm run dev

# Access
http://localhost:3000 (UI)
http://localhost:8080 (API)
```

---

## 🔄 CI/CD Integration

### Tekton Pipeline
```bash
# Deploy pipeline
oc apply -f manifests/cicd/tekton-pipeline.yaml

# Trigger via PipelineRun
oc create -f - <<EOF
apiVersion: tekton.dev/v1beta1
kind: PipelineRun
metadata:
  generateName: perf-test-run-
  namespace: perf-testing
spec:
  pipelineRef:
    name: performance-test-pipeline
  params:
    - name: git-url
      value: "https://github.com/your-org/perf-scenarios"
    - name: jmx-file
      value: "example.jmx"
    - name: worker-count
      value: "5"
EOF
```

### Jenkins
- Jenkinsfile available in `ci/Jenkinsfile`
- Parameterized build for test selection
- Artifacts archived (JTL, HTML report)

### GitLab CI
- `.gitlab-ci.yml` in `ci/` directory
- Stages: validate, deploy, test, collect, cleanup

---

## 🎓 Learning Path

1. **Start here**: This README
2. **Understand architecture**: `docs/ARCHITECTURE.md`
3. **Deploy**: Follow "Quick Start" section
4. **Explore UI**: Upload a test plan, start a test
5. **Check monitoring**: View Grafana dashboards
6. **Advanced**: Schedule tests, compare runs, integrate with CI/CD

---

## 📞 Support

### Debugging
```bash
# Check API logs
oc logs -f deployment/perf-platform-api -n perf-testing

# Check UI logs
oc logs -f deployment/perf-platform-ui -n perf-testing

# Check JMeter controller logs
oc logs -f job/jmeter-ctrl-<id> -n perf-testing

# Describe pods for events
oc describe pod <pod-name> -n perf-testing
```

### Common Issues
- **API not responding**: Check PostgreSQL connectivity
- **Workers not starting**: Verify K8s resource requests
- **Test stuck**: Check Grafana for resource metrics
- **No results**: Check results PVC mount and permissions

---

## 📝 License & Attribution

Based on: [jmeter-k8s-starterkit](https://github.com/Rbillon59/jmeter-k8s-starterkit)

---

## 🤝 Contributing

Contributions welcome! Areas for enhancement:
- [ ] S3 result storage integration
- [ ] Test scenario builder UI
- [ ] SLA/threshold alerts
- [ ] Cost analytics
- [ ] Load profile templates
- [ ] Real-time streaming results (WebSocket)

---

## 📦 What's Included

- ✅ Full-stack web UI (React/Next.js)
- ✅ Production REST API (Node.js/Express)
- ✅ PostgreSQL database with migrations
- ✅ Kubernetes Job templates for JMeter
- ✅ Monitoring stack (Prometheus, Grafana, ServiceMonitors)
- ✅ OpenShift-compatible manifests
- ✅ Docker images (multi-stage, non-root)
- ✅ Helm chart (parameterized)
- ✅ CI/CD pipeline definitions
- ✅ Comprehensive documentation

---

**Ready to start performance testing at scale?** 🚀

Deploy now and start your first test!
