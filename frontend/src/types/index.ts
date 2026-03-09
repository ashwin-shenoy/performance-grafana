/**
 * Core TypeScript types for the Performance Testing Platform UI
 */

export interface TestPlan {
  id: number;
  name: string;
  description: string;
  jmx_file_name: string;
  created_by: string;
  environment_id: number | null;
  config: Record<string, string>;
  created_at: string;
  updated_at: string;
}

export interface TestExecution {
  id: number;
  test_plan_id: number;
  test_plan_name: string;
  jmx_file_name: string;
  status: ExecutionStatus;
  triggered_by: string;
  worker_count: number;
  parameters: Record<string, string>;
  environment_id: number | null;
  controller_job_name: string | null;
  worker_job_name: string | null;
  kube_namespace: string | null;
  jtl_path: string | null;
  report_path: string | null;
  summary: TestSummary | null;
  error_message: string | null;
  started_at: string | null;
  finished_at: string | null;
  created_at: string;
  pods?: PodInfo[];
  // Grafana live-metrics link (set at execution creation time)
  grafana_url: string | null;
  dashboard_uid: string | null;
  // Dedicated metric columns (populated after JTL parsing)
  p50_ms: number | null;
  p95_ms: number | null;
  p99_ms: number | null;
  error_rate_pct: number | null;
  peak_rps: number | null;
  avg_rps: number | null;
  total_requests: number | null;
  total_errors: number | null;
  // camelCase metrics returned by the /compare endpoint
  p50Ms?: number | null;
  p95Ms?: number | null;
  p99Ms?: number | null;
  errorRatePct?: number | null;
  avgRps?: number | null;
  peakRps?: number | null;
}

export type ExecutionStatus =
  | 'PENDING'
  | 'PROVISIONING'
  | 'RUNNING'
  | 'COMPLETED'
  | 'FAILED'
  | 'STOPPED';

export interface TestSummary {
  totalRequests?: number;
  errorRate?: number;
  avgResponseTime?: number;
  p90ResponseTime?: number;
  p95ResponseTime?: number;
  p99ResponseTime?: number;
  throughput?: number;
}

export interface PodInfo {
  name: string;
  phase: string;
  nodeName: string;
  startTime: string;
  ready: boolean;
}

export interface Schedule {
  id: number;
  test_plan_id: number;
  test_plan_name: string;
  cron_expression: string;
  worker_count: number;
  parameters: Record<string, string>;
  environment_id: number | null;
  enabled: boolean;
  last_run_at: string | null;
  created_by: string;
  created_at: string;
}

export interface Environment {
  id: number;
  name: string;
  description: string;
  base_url: string;
  namespace: string;
  created_at: string;
}

// ── Workload (test plan with rich metadata) ────────────────────────────────

export type WorkloadType =
  | 'HTTP'
  | 'HTTPS'
  | 'REST'
  | 'SOAP'
  | 'DATABASE'
  | 'MESSAGE_QUEUE'
  | 'WEBSOCKET'
  | 'MIXED';

export interface ThreadGroup {
  name: string;
  threads: number;
  rampUp: number;        // seconds
  duration: number;      // seconds
  targetThroughput?: number; // requests/sec (if using Throughput Controller)
}

export interface WorkloadConfig {
  duration: number;        // total test duration in seconds
  rampUp: number;          // ramp-up period in seconds
  delayOffset: number;     // startup delay offset in seconds
  thinkTime: number;       // think time between requests in ms
  injectors: number;       // number of JMeter worker pods
  threads: number;         // total thread count
  targetThroughput?: number;
}

export interface Workload {
  id: number;
  name: string;
  description: string;
  type: WorkloadType;
  business: string;        // business unit / team
  channel: string;         // channel (web, mobile, api, batch…)
  scriptLocation: string;  // JMX script file path/name
  jmx_file_name: string;
  config: WorkloadConfig;
  threadGroups: ThreadGroup[];
  created_by: string;
  environment_id: number | null;
  created_at: string;
  updated_at: string;
  // Derived from executions
  lastRunAt?: string | null;
  lastRunStatus?: ExecutionStatus | null;
  totalRuns?: number;
}

// ── Charts / Comparison ────────────────────────────────────────────────────

export interface TrendDataPoint {
  date: string;
  running: number;
  completed: number;
  failed: number;
}

export interface ComparisonMetric {
  executionId: number;
  executionName: string;
  workloadName: string;
  avgResponseTime: number;
  p95ResponseTime: number;
  throughput: number;
  errorRate: number;
  totalRequests: number;
}

// ── Dashboard ──────────────────────────────────────────────────────────────

export interface DashboardStats {
  liveTests: number;
  scheduledTests: number;
  completedToday: number;
  failedToday: number;
  totalWorkloads: number;
  latestCompleted: Array<{
    id: number;
    status: string;
    started_at: string;
    finished_at: string | null;
    p95_ms: number | null;
    error_rate_pct: number | null;
    test_plan_name: string;
  }>;
}

export interface DashboardTrendPoint {
  date: string;
  running: number;
  completed: number;
  failed: number;
  stopped: number;
}

// ── Pagination ─────────────────────────────────────────────────────────────

export interface PaginatedResponse<T> {
  data: T[];
  total: number;
  page: number;
  limit: number;
}

export interface ApiResponse<T> {
  data: T;
  message?: string;
}
