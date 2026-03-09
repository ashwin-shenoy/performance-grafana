# Performance Testing Platform — Complete Architecture

## Table of Contents
1. [High-Level Architecture](#1-high-level-architecture)
2. [Component Deep Dive](#2-component-deep-dive)
3. [Execution Flow](#3-execution-flow---start-test-button-click)
4. [REST API Reference](#4-rest-api-reference)
5. [Database Schema](#5-database-schema-er-diagram)
6. [Folder Structure](#6-folder-structure)
7. [OpenShift Deployment](#7-openshift-deployment)
8. [Monitoring & Observability](#8-monitoring--observability)
9. [Multi-Tenancy Design](#9-multi-tenancy-design)
10. [Best Practices](#10-best-practices-for-large-scale-testing)

---

## 1. High-Level Architecture

### System Diagram
```
                          Users / CI/CD Pipelines
                               |
                ┌──────────────┼──────────────┐
                |              |              |
                v              v              v
          Browser UI      Curl/REST      Jenkins/GitLab
             React          API            Webhook
                |              |              |
                └──────────────┼──────────────┘
                               |
                               v
    ┌─────────────────────────────────────────────────┐
    │         OpenShift Cluster (Kubernetes)           │
    │  namespace: perf-testing                          │
    │                                                   │
    │  ┌───────────────────────────────────────────┐   │
    │  │  Frontend Layer (Next.js + React)         │   │
    │  │  ┌─────────────────────────────────────┐  │   │
    │  │  │ perf-platform-ui (2 replicas)       │  │   │
    │  │  │ Route: https://perf-platform....    │  │   │
    │  │  │ Port: 3000                          │  │   │
    │  │  └─────────────────────────────────────┘  │   │
    │  └───────────────────────────────────────────┘   │
    │                    |                              │
    │  ┌─────────────────v───────────────────────────┐ │
    │  │  API Layer (Node.js + Express)              │ │
    │  │  ┌─────────────────────────────────────┐    │ │
    │  │  │ perf-platform-api (2 replicas)      │    │ │
    │  │  │ Route: https://perf-platform-api... │    │ │
    │  │  │ Port: 8080 (API), 9090 (Metrics)   │    │ │
    │  │  │                                     │    │ │
    │  │  │ Services:                           │    │ │
    │  │  │ - ExecutionService (orchestration)  │    │ │
    │  │  │ - KubernetesService (K8s API)       │    │ │
    │  │  │ - Cron Scheduler (test scheduling)  │    │ │
    │  │  └─────────────────────────────────────┘    │ │
    │  └─────────────────────────────────────────────┘ │
    │                    |                              │
    │  ┌─────────────────v───────────────────────────┐ │
    │  │  Data Layer (PostgreSQL)                    │ │
    │  │  ┌─────────────────────────────────────┐    │ │
    │  │  │ postgresql (1 replica, persistent)  │    │ │
    │  │  │ - test_plans                        │    │ │
    │  │  │ - test_executions                   │    │ │
    │  │  │ - test_schedules                    │    │ │
    │  │  │ - environments                      │    │ │
    │  │  │ PVC: postgresql-data-pvc (5Gi)      │    │ │
    │  │  └─────────────────────────────────────┘    │ │
    │  └─────────────────────────────────────────────┘ │
    │                                                   │
    │  ┌───────────────────────────────────────────┐   │
    │  │  Execution Layer (JMeter on Kubernetes)  │   │
    │  │  ┌─────────────────────────────────────┐ │   │
    │  │  │ Per Test:                           │ │   │
    │  │  │  Controller Job (1 pod)             │ │   │
    │  │  │  + Worker Job (N pods, scaled)      │ │   │
    │  │  │  + Results PVC (RWX)                │ │   │
    │  │  │  + ConfigMap (JMX content)          │ │   │
    │  │  └─────────────────────────────────────┘ │   │
    │  └───────────────────────────────────────────┘   │
    │                                                   │
    │  ┌───────────────────────────────────────────┐   │
    │  │  Monitoring & Observability              │   │
    │  │  ┌─────────────────────────────────────┐ │   │
    │  │  │ InfluxDB: JMeter live test data     │ │   │
    │  │  │ Grafana: 4 pre-built dashboards     │ │   │
    │  │  │ Prometheus: JVM + API + K8s metrics │ │   │
    │  │  │ PrometheusRules: Alerts             │ │   │
    │  │  │ Instana (optional): APM + tracing   │ │   │
    │  │  └─────────────────────────────────────┘ │   │
    │  └───────────────────────────────────────────┘   │
    │                                                   │
    └─────────────────────────────────────────────────┘
```

---

## 2. Component Deep Dive

### 2.1 Frontend (Next.js + React)
**Role**: User-facing dashboard for test management and reporting

| Feature | Endpoint | Component |
|---|---|---|
| **Upload JMX** | POST /api/v1/tests | TestUploadForm.tsx |
| **List Tests** | GET /api/v1/tests | Dashboard, TestList pages |
| **Start Test** | POST /api/v1/executions | StartTestDialog.tsx |
| **Stop Test** | POST /api/v1/executions/:id/stop | ExecutionReport.tsx |
| **View Status** | GET /api/v1/executions/:id | Dashboard + polling (5s) |
| **View Report** | GET /api/v1/reports/:id | ExecutionReport.tsx + charts |
| **Compare Tests** | GET /api/v1/executions/compare | CompareExecutions.tsx |
| **Schedule Tests** | POST /api/v1/schedules | ScheduleForm.tsx |

**Key Design Patterns**:
- **Polling**: Dashboard polls /executions every 10s for active test status
- **React Query**: TanStack React Query for data fetching + caching + polling
- **TypeScript**: Strict typing for API responses (types/index.ts)
- **Tailwind CSS**: Utility-first styling

### 2.2 Backend API (Node.js + Express)
**Role**: REST API orchestrating JMeter tests on Kubernetes

| Layer | Purpose |
|---|---|
| **Routes** | HTTP endpoints for CRUD operations |
| **Services** | Business logic: ExecutionService, KubernetesService |
| **Models** | Data access layer: TestPlan, TestExecution, Schedule |
| **Jobs** | Cron scheduler for recurring tests |
| **Config** | Database + Kubernetes client setup |

**Key Features**:
- **Async Execution**: POST returns 202 immediately, execution runs in background
- **Kubernetes Native**: Direct API calls via @kubernetes/client-node SDK
- **Structured Logging**: Winston logger with JSON output for centralized log aggregation
- **Prometheus Metrics**: `/metrics` endpoint exposes request rate, latency, errors

### 2.3 Execution Engine (Kubernetes Jobs)
**Responsibility**: Run distributed JMeter tests on OpenShift

**Per-Test Resources**:
```
ConfigMap (jmx-{exec-id})
  └── JMX content
  └── Test parameters (.env)

Job: jmeter-controller-{exec-id}
  └── Pod: runs distributed test coordinator
      └── Discovers worker IPs
      └── Launches test via RMI
      └── Generates HTML report
      └── Writes JTL to PVC

Job: jmeter-workers-{exec-id}
  ├── Pod 1: runs jmeter-server (port 1099)
  ├── Pod 2: runs jmeter-server
  └── ... (N pods, dynamically scaled)

PVC (RWX): jmeter-results-pvc
  └── /report/exec-{exec-id}/
      ├── results.jtl
      └── html-report/
          ├── index.html
          ├── css/
          └── js/
```

### 2.4 Database (PostgreSQL)

**Schema** (4 tables):

```sql
environments
  - id, name, description, base_url, namespace

test_plans
  - id, name, description, jmx_file_name, jmx_content (TEXT)
  - created_by, environment_id, config (JSONB)

test_executions
  - id, test_plan_id, status (ENUM-like), triggered_by
  - worker_count, parameters (JSONB), environment_id
  - controller_job_name, worker_job_name, kube_namespace
  - jtl_path, report_path, summary (JSONB), error_message
  - started_at, finished_at

test_schedules
  - id, test_plan_id, cron_expression, worker_count
  - parameters (JSONB), environment_id, enabled
  - created_by, last_run_at
```

---

## 3. Execution Flow - "Start Test" Button Click

```
┌─────────────────────────────────────────────────────────────────┐
│ User: Clicks "Start Test" in React UI                          │
└─────────────────────────────────────────────────────────────────┘
                          |
                          v
┌─────────────────────────────────────────────────────────────────┐
│ Frontend: POST /api/v1/executions                              │
│  payload: {                                                      │
│    testPlanId: 5,                                               │
│    workerCount: 10,                                             │
│    parameters: { threads: "100", duration: "600" }              │
│  }                                                               │
└─────────────────────────────────────────────────────────────────┘
                          |
                          v
┌─────────────────────────────────────────────────────────────────┐
│ API: Validates & Creates Execution Record                       │
│  1. Verify test_plans.id = 5 exists in PostgreSQL               │
│  2. INSERT INTO test_executions (status='PENDING')              │
│  3. Return 202 Accepted immediately                             │
└─────────────────────────────────────────────────────────────────┘
                          |
                          v
┌─────────────────────────────────────────────────────────────────┐
│ Frontend: Starts Polling GET /api/v1/executions/1               │
│  Every 5 seconds:                                                │
│  - Poll execution status                                         │
│  - Display pod list (if RUNNING)                                │
│  - Show Grafana link                                             │
│  - Update UI with live metrics                                   │
└─────────────────────────────────────────────────────────────────┘
                          |
                          v
┌─────────────────────────────────────────────────────────────────┐
│ Backend: Background Async Execution                             │
│                                                                  │
│ Step 1: Update Status -> PROVISIONING                           │
│ Step 2: Create K8s Worker Job (parallelism=10)                  │
│ Step 3: Wait for 10 worker pods to be Ready                     │
│         (TCP ready check, timeout 300s)                          │
│                                                                  │
│ Step 4: Create K8s ConfigMap with JMX content                   │
│ Step 5: Create K8s Controller Job with:                         │
│         - ConfigMap mount (JMX file)                             │
│         - PVC mount (results directory)                          │
│         - Test parameters as env vars                            │
│         - Startup script:                                        │
│           a. cd /opt/jmeter/apache-jmeter/bin                   │
│           b. Install plugins: PluginsManagerCMD.sh               │
│           c. Discover workers via DNS                            │
│           d. jmeter --remotestart <worker-IPs>                  │
│           e. Generate report + JTL                               │
│                                                                  │
│ Step 6: Update Status -> RUNNING                                │
│ Step 7: Poll K8s Job status every 10 seconds                    │
│         (timeout 2x test duration, e.g., 1200s)                 │
│                                                                  │
│ Step 8: On Completion:                                           │
│         - Store result paths in test_executions                 │
│         - Parse JTL summary (if available)                      │
│         - Update Status -> COMPLETED                             │
│                                                                  │
│ Step 9: After 5 minutes (delayed cleanup):                      │
│         - Delete K8s Jobs (cascade deletes pods)                │
│         - Delete ConfigMap                                       │
│                                                                  │
└─────────────────────────────────────────────────────────────────┘
                          |
                          v
┌─────────────────────────────────────────────────────────────────┐
│ Frontend: Display Results                                        │
│  - Status badge changes to COMPLETED (green)                    │
│  - Summary stats: throughput, response times, error rate        │
│  - Graphs: response time over time, active threads               │
│  - Link: "View HTML Report"                                      │
│  - Link: "Compare with other tests"                              │
└─────────────────────────────────────────────────────────────────┘
```

---

## 4. REST API Reference

### Health & Monitoring
```
GET /api/v1/health              → { status: "ok", timestamp: "..." }
GET /api/v1/health/ready        → { status: "ready", database: "connected" }
GET /metrics                    → Prometheus metrics
```

### Test Plans
```
POST   /api/v1/tests            Upload .jmx (multipart/form-data)
                                Form fields: jmxFile, name, description, config
                                Returns: 201 { data: TestPlan }

GET    /api/v1/tests?page=1&limit=20&search=api
                                Returns: 200 { data: [...], total, page, limit }

GET    /api/v1/tests/:id        Returns: 200 { data: TestPlan } | 404

PUT    /api/v1/tests/:id        Update: { name, description, config }
                                Returns: 200 { data: TestPlan }

DELETE /api/v1/tests/:id        Returns: 204 No Content
```

### Executions
```
POST   /api/v1/executions       Start a test
                                Body: {
                                  testPlanId: number,
                                  workerCount?: number,
                                  parameters?: Record<string, string>,
                                  environmentId?: number
                                }
                                Returns: 202 { data: TestExecution }

GET    /api/v1/executions?status=RUNNING&page=1
                                List executions (filtered, paginated)
                                Returns: 200 { data: [...], total, page, limit }

GET    /api/v1/executions/:id   Get execution + live pod status
                                Returns: 200 { data: TestExecution, pods: [...] }

POST   /api/v1/executions/:id/stop
                                Stop a running test
                                Returns: 200 { data: TestExecution }

GET    /api/v1/executions/compare?ids=1,2,3
                                Compare multiple executions
                                Returns: 200 { data: [Execution1, Execution2, ...] }
```

### Schedules
```
POST   /api/v1/schedules        Create schedule
                                Body: {
                                  testPlanId, cronExpression, workerCount,
                                  parameters, environmentId
                                }
                                Returns: 201 { data: Schedule }

GET    /api/v1/schedules        List all schedules
                                Returns: 200 { data: [...] }

GET    /api/v1/schedules/:id    Get schedule
                                Returns: 200 { data: Schedule }

PUT    /api/v1/schedules/:id    Update schedule
PUT    /api/v1/schedules/:id    Returns: 200 { data: Schedule }

DELETE /api/v1/schedules/:id    Returns: 204 No Content
```

### Reports
```
GET    /api/v1/reports/:executionId
                                Get report metadata
                                Returns: 200 {
                                  data: {
                                    executionId, testPlanName, status,
                                    jtlPath, reportPath, summary,
                                    startedAt, finishedAt
                                  }
                                }

GET    /api/v1/reports/:executionId/html
                                Redirect to HTML report
                                Returns: 302 (redirect to PVC mount)

GET    /api/v1/reports/:executionId/summary
                                Parsed test summary
                                Returns: 200 {
                                  data: {
                                    totalRequests, errorRate, avgResponseTime,
                                    p90ResponseTime, p95ResponseTime,
                                    p99ResponseTime, throughput
                                  }
                                }
```

### Environments
```
POST   /api/v1/environments     Create environment
GET    /api/v1/environments     List environments
GET    /api/v1/environments/:id Get environment
PUT    /api/v1/environments/:id Update environment
DELETE /api/v1/environments/:id Delete environment
```

---

## 5. Database Schema (ER Diagram)

```
┌──────────────────────┐
│  environments        │
├──────────────────────┤
│ id (PK)              │
│ name (UNIQUE)        │
│ description          │
│ base_url             │
│ namespace            │
│ created_at           │
│ updated_at           │
└──────────────────────┘
        ▲
        │ (1:N)
        │
┌──────────────────────────────────────┐
│  test_plans                          │
├──────────────────────────────────────┤
│ id (PK)                              │
│ name                                 │
│ description                          │
│ jmx_file_name                        │
│ jmx_content (TEXT)                   │
│ created_by                           │
│ environment_id (FK)                  │
│ config (JSONB)                       │
│ created_at                           │
│ updated_at                           │
└──────────────────────────────────────┘
        ▲
        │ (1:N)
        │
┌───────────────────────────────────────────────────┐
│  test_executions                                  │
├───────────────────────────────────────────────────┤
│ id (PK)                                           │
│ test_plan_id (FK)                                 │
│ status (PENDING|PROVISIONING|RUNNING|COMPLETED    │
│        |FAILED|STOPPED)                           │
│ triggered_by (user, schedule:id, api, ci)         │
│ worker_count                                      │
│ parameters (JSONB)                                │
│ environment_id (FK)                               │
│ controller_job_name                               │
│ worker_job_name                                   │
│ kube_namespace                                    │
│ jtl_path                                          │
│ report_path                                       │
│ summary (JSONB)                                   │
│ error_message                                     │
│ started_at                                        │
│ finished_at                                       │
│ created_at                                        │
│ updated_at                                        │
└───────────────────────────────────────────────────┘

┌──────────────────────────────────────┐
│  test_schedules                      │
├──────────────────────────────────────┤
│ id (PK)                              │
│ test_plan_id (FK)                    │
│ cron_expression (e.g., "0 2 * * *")  │
│ worker_count                         │
│ parameters (JSONB)                   │
│ environment_id (FK)                  │
│ enabled (BOOLEAN)                    │
│ created_by                           │
│ last_run_at                          │
│ created_at                           │
│ updated_at                           │
└──────────────────────────────────────┘
```

---

## 6. Folder Structure

See the `perf-platform/` directory tree in the root README.

---

## 7. OpenShift Deployment

### Deployment Order
```bash
# 1. Base infrastructure
oc create namespace perf-testing
oc apply -f manifests/base/

# 2. SCC assignment
oc adm policy add-scc-to-user jmeter-scc \
  system:serviceaccount:perf-testing:jmeter-orchestrator

# 3. Data layer
oc apply -f execution/manifests/platform/postgresql.yaml
sleep 30  # Wait for PostgreSQL to be ready

# 4. API service
oc apply -f execution/manifests/platform/api-deployment.yaml

# 5. Frontend
oc apply -f execution/manifests/platform/ui-deployment.yaml

# 6. Monitoring
oc apply -f manifests/monitoring/
oc apply -f execution/manifests/monitoring/

# 7. Execution infrastructure
oc apply -f manifests/jmeter/

# 8. Verify
oc get pods -n perf-testing
oc get routes -n perf-testing
```

### Resource Requirements
| Component | CPU Request | Memory Request | CPU Limit | Memory Limit | Storage |
|---|---|---|---|---|---|
| API | 250m | 512Mi | 500m | 1Gi | - |
| UI | 100m | 256Mi | 250m | 512Mi | - |
| PostgreSQL | 250m | 512Mi | 500m | 1Gi | 5Gi |
| InfluxDB | 500m | 1Gi | 1 | 2Gi | 10Gi |
| Grafana | 250m | 512Mi | 500m | 1Gi | 2Gi |
| JMeter Worker | 2 | 2Gi | 4 | 4Gi | - |
| JMeter Controller | 1 | 1Gi | 2 | 2Gi | - |

**Total for idle cluster**: ~2 CPUs, 6Gi memory, 17Gi storage
**Per test (10 workers, 10min)**: +20 CPUs, 20Gi memory (peak), cleaned up after

---

## 8. Monitoring & Observability

### Dashboards (Grafana)
1. **JMeter Results** → throughput, response times (avg/p90/p95/p99), active threads, error rate
2. **JVM Metrics** → heap usage, GC activity, thread count
3. **Kubernetes** → pod resource usage, node metrics
4. **Platform API** → request latency, error rate, queue depth

### Alerts (PrometheusRules)
- `JMeterWorkerOOM`: Worker pod memory > 90%
- `JMeterWorkerHighCPU`: Worker CPU > 85% for 5+ minutes
- `PerfPlatformAPIDown`: API not responding
- `TestExecutionStuck`: Controller job running > 2 hours

### Instana Integration (Optional)
```bash
helm repo add instana https://agents.instana.io/helm
helm install instana-agent instana/instana-agent \
  --set agent.key=YOUR_AGENT_KEY \
  --set agent.endpointHost=YOUR_HOST \
  --namespace instana-agent --create-namespace
```
Provides:
- Automatic JVM instrumentation (no code changes)
- Distributed tracing across microservices
- Anomaly detection + baseline learning
- Dependency mapping

---

## 9. Multi-Tenancy Design

### User Isolation
- `created_by`, `triggered_by` fields track ownership
- Integrate with OpenShift OAuth for authentication
- Future: RBAC with role-based access (admin, user, viewer)

### Environment Isolation
- `environments` table stores dev/staging/prod targets
- Each test plan can be scoped to an environment
- Different K8s namespaces per environment (configurable)

### Test Isolation
- Unique job names per execution: `jmeter-ctrl-{exec-id-suffix}`
- Unique ConfigMaps per execution
- All resources labeled with `execution-id`
- Results in separate PVC directories: `/report/exec-{id}/`
- Pod anti-affinity spreads workers across different nodes

---

## 10. Best Practices for Large-Scale Testing

### Sizing Guidelines
```
Light Load:         5 workers × 100 threads = 500 VUs
Normal Load:       10 workers × 100 threads = 1,000 VUs
Heavy Load:        20 workers × 200 threads = 4,000 VUs
Stress Test:       50 workers × 100 threads = 5,000 VUs
Very Heavy:       100 workers × 50 threads = 5,000 VUs
```

### Operational Excellence
- **Node Strategy**: Taint dedicated perf nodes with `purpose=performance-testing:NoSchedule`
- **Network**: Ensure workers can reach SUT without routing through proxies
- **Storage**: Use RWX (NFS/EFS) PVC; size for JTL files (~1-2 MB per 1000 requests)
- **Cleanup**: Jobs auto-cleanup via `ttlSecondsAfterFinished`; API delays cleanup 5 minutes for log retrieval
- **Secrets**: Use SealedSecrets or External Secrets in production

### Test Design Patterns
| Type | Workers | Threads/Worker | Duration | Purpose |
|---|---|---|---|---|
| **Smoke** | 1 | 10 | 1-2 min | Verify test works, no errors |
| **Load** | 5-10 | 50-100 | 30-60 min | Normal traffic pattern |
| **Stress** | 20-50 | 50-100 | 15-30 min | Find breaking point |
| **Spike** | 50 | 10 | 5 min | Sudden burst, auto-scaling test |
| **Endurance** | 5-10 | 50-100 | 4-24 hrs | Memory leaks, degradation |
| **Chaos** | 10 | 100 | 30 min | Introduce network/pod failures |

### Advanced Features (Optional)
- **Test Metadata**: Tag tests by team, service, SLA
- **Result Trending**: Compare across 10+ runs, detect regressions
- **Scenario Builder**: Parameterized templates for common patterns
- **Cost Analysis**: Track resource spend per test
- **SLA Dashboards**: Real-time pass/fail against SLOs
- **Webhook Notifications**: Slack, PagerDuty on completion
