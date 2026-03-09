/**
 * API Client — Axios-based HTTP client for backend communication
 */
import axios from 'axios';
import type {
  TestPlan, TestExecution, Schedule, Environment,
  Workload, PaginatedResponse, ApiResponse,
  DashboardStats, DashboardTrendPoint,
} from '../types';

const api = axios.create({
  baseURL: process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8080/api/v1',
  headers: { 'Content-Type': 'application/json' },
});

// ── Test Plans (alias: Workloads) ──────────────────────────────────────────
export const testPlanApi = {
  list: (params?: { page?: number; limit?: number; search?: string }) =>
    api.get<PaginatedResponse<TestPlan>>('/tests', { params }).then(r => r.data),

  get: (id: number) =>
    api.get<ApiResponse<TestPlan>>(`/tests/${id}`).then(r => r.data.data),

  upload: (formData: FormData) =>
    api.post<ApiResponse<TestPlan>>('/tests', formData, {
      headers: { 'Content-Type': 'multipart/form-data' },
    }).then(r => r.data.data),

  update: (id: number, data: Partial<TestPlan>) =>
    api.put<ApiResponse<TestPlan>>(`/tests/${id}`, data).then(r => r.data.data),

  delete: (id: number) =>
    api.delete(`/tests/${id}`),
};

// ── Workloads (richer view of test plans) ─────────────────────────────────
export const workloadApi = {
  /**
   * List workloads with optional search / pagination.
   * Falls back to /tests endpoint; transforms TestPlan → Workload shape.
   */
  list: async (params?: {
    page?: number;
    limit?: number;
    search?: string;
  }): Promise<PaginatedResponse<Workload>> => {
    const res = await api.get<PaginatedResponse<TestPlan>>('/tests', { params });
    return {
      ...res.data,
      data: res.data.data.map(planToWorkload),
    };
  },

  get: async (id: number): Promise<Workload> => {
    const plan = await api.get<ApiResponse<TestPlan>>(`/tests/${id}`).then(r => r.data.data);
    return planToWorkload(plan);
  },

  upload: (formData: FormData) =>
    api.post<ApiResponse<TestPlan>>('/tests', formData, {
      headers: { 'Content-Type': 'multipart/form-data' },
    }).then(r => planToWorkload(r.data.data)),

  update: (id: number, data: Partial<TestPlan>) =>
    api.put<ApiResponse<TestPlan>>(`/tests/${id}`, data).then(r => planToWorkload(r.data.data)),

  delete: (id: number) =>
    api.delete(`/tests/${id}`),
};

// Helper: map TestPlan → Workload
function planToWorkload(plan: TestPlan): Workload {
  const cfg = plan.config || {};
  return {
    id:            plan.id,
    name:          plan.name,
    description:   plan.description,
    type:          (cfg.type as any) || 'HTTP',
    capability:    cfg.capability || '—',
    channel:       cfg.channel  || '—',
    scriptLocation:plan.jmx_file_name,
    jmx_file_name: plan.jmx_file_name,
    config: {
      duration:    Number(cfg.duration    ?? 300),
      rampUp:      Number(cfg.rampUp      ?? 60),
      delayOffset: Number(cfg.delayOffset ?? 0),
      thinkTime:   Number(cfg.thinkTime   ?? 500),
      injectors:   Number(cfg.injectors   ?? 1),
      threads:     Number(cfg.threads     ?? 10),
    },
    threadGroups: parseThreadGroups(cfg),
    created_by:    plan.created_by,
    environment_id:plan.environment_id,
    created_at:    plan.created_at,
    updated_at:    plan.updated_at,
  };
}

function parseThreadGroups(cfg: Record<string, string>) {
  try {
    if (cfg.threadGroups) return JSON.parse(cfg.threadGroups);
  } catch { /* noop */ }
  // Fallback for legacy JMX files without explicit thread group config.
  // The 'virtual_users' slug maps to the global -Jthreads / -JrampUp /
  // -Jduration JMeter properties that single-group JMX files read.
  return [
    {
      name:      'Virtual Users',
      slug:      'virtual_users',
      threads:   Number(cfg.threads  ?? 10),
      rampUp:    Number(cfg.rampUp   ?? 60),
      duration:  Number(cfg.duration ?? 300),
      thinkTime: 500,
    },
  ];
}

// ── Executions ─────────────────────────────────────────────────────────────
export const executionApi = {
  list: (params?: { page?: number; status?: string; testPlanId?: number; limit?: number }) =>
    api.get<PaginatedResponse<TestExecution>>('/executions', { params }).then(r => r.data),

  get: (id: number) =>
    api.get<ApiResponse<TestExecution>>(`/executions/${id}`).then(r => r.data.data),

  start: (data: { testPlanId: number; workerCount: number; parameters?: Record<string, string> }) =>
    api.post<ApiResponse<TestExecution>>('/executions', data).then(r => r.data.data),

  stop: (id: number) =>
    api.post<ApiResponse<TestExecution>>(`/executions/${id}/stop`).then(r => r.data.data),

  compare: (ids: number[]) =>
    api.get<ApiResponse<TestExecution[]>>('/executions/compare', {
      params: { ids: ids.join(',') },
    }).then(r => r.data.data),
};

// ── Schedules ──────────────────────────────────────────────────────────────
export const scheduleApi = {
  list: () =>
    api.get<ApiResponse<Schedule[]>>('/schedules').then(r => r.data.data),

  create: (data: {
    testPlanId: number;
    cronExpression: string;
    workerCount: number;
    parameters?: Record<string, string>;
  }) =>
    api.post<ApiResponse<Schedule>>('/schedules', data).then(r => r.data.data),

  update: (id: number, data: Partial<Schedule>) =>
    api.put<ApiResponse<Schedule>>(`/schedules/${id}`, data).then(r => r.data.data),

  delete: (id: number) =>
    api.delete(`/schedules/${id}`),

  toggle: (id: number, enabled: boolean) =>
    api.patch<ApiResponse<Schedule>>(`/schedules/${id}`, { enabled }).then(r => r.data.data),
};

// ── Environments ───────────────────────────────────────────────────────────
export const environmentApi = {
  list: () =>
    api.get<ApiResponse<Environment[]>>('/environments').then(r => r.data.data),

  create: (data: Partial<Environment>) =>
    api.post<ApiResponse<Environment>>('/environments', data).then(r => r.data.data),
};

// ── Dashboard ──────────────────────────────────────────────────────────────
export const dashboardApi = {
  stats: () =>
    api.get<ApiResponse<DashboardStats>>('/dashboard/stats').then(r => r.data.data),

  trends: (days = 7) =>
    api.get<ApiResponse<DashboardTrendPoint[]>>('/dashboard/trends', { params: { days } }).then(r => r.data.data),

  recent: (limit = 10) =>
    api.get<ApiResponse<TestExecution[]>>('/dashboard/recent', { params: { limit } }).then(r => r.data.data),
};

// ── Reports ────────────────────────────────────────────────────────────────
export const reportApi = {
  get: (executionId: number) =>
    api.get(`/reports/${executionId}`).then(r => r.data.data),

  getHtmlUrl: (executionId: number) =>
    `${api.defaults.baseURL}/reports/${executionId}/html`,

  getSummary: (executionId: number) =>
    api.get(`/reports/${executionId}/summary`).then(r => r.data.data),
};

export default api;
