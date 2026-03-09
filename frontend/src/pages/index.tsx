/**
 * Dashboard Page — Live overview of performance testing activity
 */
import React, { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  AreaChart, Area, PieChart, Pie, Cell, Tooltip,
  XAxis, YAxis, CartesianGrid, ResponsiveContainer, Legend,
} from 'recharts';
import {
  Activity, CalendarClock, CheckCircle2, XCircle,
  Plus, ArrowUpRight, RefreshCw, Play, Square,
  Clock, ChevronRight, Layers,
} from 'lucide-react';
import { format, parseISO } from 'date-fns';
import Layout from '../components/common/Layout';
import { executionApi, testPlanApi, dashboardApi } from '../services/api';
import type { ExecutionStatus } from '../types';

// ── Helpers ────────────────────────────────────────────────────────────────

function statusBadge(status: ExecutionStatus) {
  const map: Record<ExecutionStatus, string> = {
    RUNNING:      'badge-running',
    COMPLETED:    'badge-completed',
    FAILED:       'badge-failed',
    PENDING:      'badge-pending',
    PROVISIONING: 'badge-pending',
    STOPPED:      'badge-stopped',
  };
  return (
    <span className={map[status] || 'badge'}>
      {status === 'RUNNING' && <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />}
      {status}
    </span>
  );
}

const DONUT_COLORS = {
  Running:   '#10b981',
  Completed: '#3b82f6',
  Failed:    '#ef4444',
  Stopped:   '#94a3b8',
};

// ── Start Test Dialog ──────────────────────────────────────────────────────
function StartTestDialog({
  open,
  onClose,
}: {
  open: boolean;
  onClose: () => void;
}) {
  const qc = useQueryClient();
  const [planId, setPlanId] = useState('');
  const [workers, setWorkers] = useState('1');

  const { data: plans } = useQuery({
    queryKey: ['test-plans'],
    queryFn: () => testPlanApi.list({ limit: 100 }),
    enabled: open,
  });

  const startMut = useMutation({
    mutationFn: () =>
      executionApi.start({
        testPlanId:  Number(planId),
        workerCount: Number(workers),
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['dashboard-stats'] });
      qc.invalidateQueries({ queryKey: ['dashboard-recent'] });
      onClose();
    },
  });

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div className="absolute inset-0 bg-slate-900/50" onClick={onClose} />
      <div className="relative w-full max-w-md mx-4 bg-white border border-slate-200 p-6" style={{ boxShadow: '0 4px 16px rgba(0,0,0,0.25)' }}>
        <h2 className="text-lg font-bold text-slate-900 mb-1">Start New Test</h2>
        <p className="text-sm text-slate-500 mb-5">Select a workload and configure workers to launch.</p>

        <div className="space-y-4">
          <div>
            <label className="label">Workload / Test Plan</label>
            <select
              className="select"
              value={planId}
              onChange={e => setPlanId(e.target.value)}
            >
              <option value="">Select workload…</option>
              {plans?.data.map(p => (
                <option key={p.id} value={p.id}>{p.name}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="label">Worker Pods</label>
            <input
              type="number"
              min={1}
              max={20}
              className="input"
              value={workers}
              onChange={e => setWorkers(e.target.value)}
            />
          </div>
        </div>

        <div className="flex gap-3 mt-6">
          <button className="btn-secondary flex-1" onClick={onClose}>Cancel</button>
          <button
            className="btn-primary flex-1"
            onClick={() => startMut.mutate()}
            disabled={!planId || startMut.isPending}
          >
            <Play className="w-4 h-4" />
            {startMut.isPending ? 'Starting…' : 'Start Test'}
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Stat Card ──────────────────────────────────────────────────────────────
interface StatCardProps {
  label: string;
  value: number | string;
  icon: React.ElementType;
  iconBg: string;
  iconColor: string;
  trend?: string;
  trendUp?: boolean;
  loading?: boolean;
}

function StatCard({ label, value, icon: Icon, iconBg, iconColor, trend, trendUp, loading }: StatCardProps) {
  return (
    <div className="card p-5">
      <div className="flex items-start justify-between">
        <div>
          <p className="text-xs font-semibold text-slate-500 uppercase tracking-wide">{label}</p>
          {loading ? (
            <div className="mt-1.5 h-9 w-16 bg-slate-100 rounded animate-pulse" />
          ) : (
            <p className="mt-1.5 text-3xl font-bold text-slate-900">{value}</p>
          )}
          {trend && !loading && (
            <p className={`mt-1 text-xs font-medium flex items-center gap-1 ${trendUp ? 'text-emerald-600' : 'text-slate-400'}`}>
              <ArrowUpRight className={`w-3 h-3 ${!trendUp ? 'rotate-90' : ''}`} />
              {trend}
            </p>
          )}
        </div>
        <div className={`w-11 h-11 ${iconBg} flex items-center justify-center flex-shrink-0`}>
          <Icon className={`w-5 h-5 ${iconColor}`} />
        </div>
      </div>
    </div>
  );
}

// ── Custom Donut Tooltip ───────────────────────────────────────────────────
const DonutTooltip = ({ active, payload }: any) => {
  if (!active || !payload?.length) return null;
  return (
    <div className="bg-white border border-slate-200 px-3 py-2 text-xs" style={{ boxShadow: '0 2px 6px rgba(0,0,0,0.15)' }}>
      <p className="font-semibold text-slate-800">{payload[0].name}</p>
      <p className="text-slate-600">{payload[0].value} executions</p>
    </div>
  );
};

// ── Area Tooltip ───────────────────────────────────────────────────────────
const AreaTooltip = ({ active, payload, label }: any) => {
  if (!active || !payload?.length) return null;
  return (
    <div className="bg-white border border-slate-200 px-3 py-2 text-xs space-y-1" style={{ boxShadow: '0 2px 6px rgba(0,0,0,0.15)' }}>
      <p className="font-semibold text-slate-700 mb-1">{label}</p>
      {payload.map((p: any) => (
        <div key={p.name} className="flex items-center gap-2">
          <span className="w-2 h-2 rounded-full" style={{ background: p.color }} />
          <span className="text-slate-600">{p.name}:</span>
          <span className="font-semibold text-slate-900">{p.value}</span>
        </div>
      ))}
    </div>
  );
};

// ── Main Dashboard ─────────────────────────────────────────────────────────
export default function DashboardPage() {
  const [startOpen, setStartOpen] = useState(false);
  const qc = useQueryClient();

  // ── Real API queries ──────────────────────────────────────────────────────
  const { data: stats, isLoading: statsLoading, refetch: refetchStats } = useQuery({
    queryKey: ['dashboard-stats'],
    queryFn: () => dashboardApi.stats(),
    refetchInterval: 15_000,
  });

  const { data: trends, isLoading: trendsLoading, refetch: refetchTrends } = useQuery({
    queryKey: ['dashboard-trends'],
    queryFn: () => dashboardApi.trends(7),
    refetchInterval: 60_000,
  });

  const { data: recent, isLoading: recentLoading, refetch: refetchRecent } = useQuery({
    queryKey: ['dashboard-recent'],
    queryFn: () => dashboardApi.recent(10),
    refetchInterval: 15_000,
  });

  const stopMut = useMutation({
    mutationFn: (id: number) => executionApi.stop(id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['dashboard-stats'] });
      qc.invalidateQueries({ queryKey: ['dashboard-recent'] });
    },
  });

  const handleRefresh = () => {
    refetchStats();
    refetchTrends();
    refetchRecent();
  };

  // ── Derived data ──────────────────────────────────────────────────────────

  // Trend chart: map API data to Recharts-friendly keys
  const trendData = (trends ?? []).map(pt => ({
    date: pt.date.slice(5), // "MM-DD" format for compact x-axis
    Completed: pt.completed,
    Failed:    pt.failed,
    Running:   pt.running,
    Stopped:   pt.stopped,
  }));

  // Donut: live status distribution from today's stats
  const donutData = [
    { name: 'Running',   value: stats?.liveTests       ?? 0 },
    { name: 'Completed', value: stats?.completedToday  ?? 0 },
    { name: 'Failed',    value: stats?.failedToday     ?? 0 },
  ].filter(d => d.value > 0);

  const donutColors = Object.values(DONUT_COLORS);
  const recentList = recent ?? [];

  return (
    <Layout>
      <StartTestDialog open={startOpen} onClose={() => setStartOpen(false)} />

      {/* ── Page header ────────────────────────────────────── */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-xl font-bold text-slate-900">Performance Dashboard</h1>
          <p className="text-sm text-slate-500 mt-0.5">Real-time view of all JMeter test activity</p>
        </div>
        <div className="flex items-center gap-2">
          <button
            className="btn-secondary btn-sm"
            onClick={handleRefresh}
          >
            <RefreshCw className="w-3.5 h-3.5" />
            Refresh
          </button>
          <button
            className="btn-primary"
            onClick={() => setStartOpen(true)}
          >
            <Plus className="w-4 h-4" />
            Start New Test
          </button>
        </div>
      </div>

      {/* ── Stat cards ─────────────────────────────────────── */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
        <StatCard
          label="Live Tests"
          value={stats?.liveTests ?? 0}
          icon={Activity}
          iconBg="bg-emerald-50"
          iconColor="text-emerald-600"
          trend={stats?.liveTests ? `${stats.liveTests} active now` : 'None running'}
          trendUp={(stats?.liveTests ?? 0) > 0}
          loading={statsLoading}
        />
        <StatCard
          label="Scheduled Tests"
          value={stats?.scheduledTests ?? 0}
          icon={CalendarClock}
          iconBg="bg-amber-50"
          iconColor="text-amber-600"
          trend={`${stats?.scheduledTests ?? 0} active schedule${(stats?.scheduledTests ?? 0) !== 1 ? 's' : ''}`}
          trendUp={(stats?.scheduledTests ?? 0) > 0}
          loading={statsLoading}
        />
        <StatCard
          label="Completed Today"
          value={stats?.completedToday ?? 0}
          icon={CheckCircle2}
          iconBg="bg-blue-50"
          iconColor="text-blue-600"
          trend={`${stats?.totalWorkloads ?? 0} workloads total`}
          trendUp
          loading={statsLoading}
        />
        <StatCard
          label="Failed Today"
          value={stats?.failedToday ?? 0}
          icon={XCircle}
          iconBg="bg-red-50"
          iconColor="text-red-600"
          trend={stats?.failedToday ? 'Needs attention' : 'All good'}
          trendUp={!(stats?.failedToday)}
          loading={statsLoading}
        />
      </div>

      {/* ── Charts row ─────────────────────────────────────── */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-5 mb-6">
        {/* Area chart — 7-day trends from API */}
        <div className="card lg:col-span-2">
          <div className="card-header">
            <span className="card-title">Test Execution Trends</span>
            <span className="text-xs text-slate-400">Last 7 days</span>
          </div>
          <div className="p-5">
            {trendsLoading ? (
              <div className="flex items-center justify-center h-[220px] text-slate-400">
                <RefreshCw className="w-5 h-5 animate-spin mr-2" />
                Loading trends…
              </div>
            ) : trendData.length === 0 ? (
              <div className="flex items-center justify-center h-[220px] text-slate-400">
                <p className="text-sm">No execution history yet</p>
              </div>
            ) : (
              <ResponsiveContainer width="100%" height={220}>
                <AreaChart data={trendData} margin={{ top: 4, right: 8, bottom: 0, left: -10 }}>
                  <defs>
                    <linearGradient id="gCompleted" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%"  stopColor="#3b82f6" stopOpacity={0.2} />
                      <stop offset="95%" stopColor="#3b82f6" stopOpacity={0}   />
                    </linearGradient>
                    <linearGradient id="gFailed" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%"  stopColor="#ef4444" stopOpacity={0.2} />
                      <stop offset="95%" stopColor="#ef4444" stopOpacity={0}   />
                    </linearGradient>
                    <linearGradient id="gRunning" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%"  stopColor="#10b981" stopOpacity={0.2} />
                      <stop offset="95%" stopColor="#10b981" stopOpacity={0}   />
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
                  <XAxis dataKey="date" tick={{ fontSize: 11, fill: '#94a3b8' }} axisLine={false} tickLine={false} />
                  <YAxis tick={{ fontSize: 11, fill: '#94a3b8' }} axisLine={false} tickLine={false} allowDecimals={false} />
                  <Tooltip content={<AreaTooltip />} />
                  <Legend iconSize={8} iconType="circle" wrapperStyle={{ fontSize: 11 }} />
                  <Area type="monotone" dataKey="Completed" stroke="#3b82f6" fill="url(#gCompleted)" strokeWidth={2} dot={false} />
                  <Area type="monotone" dataKey="Failed"    stroke="#ef4444" fill="url(#gFailed)"    strokeWidth={2} dot={false} />
                  <Area type="monotone" dataKey="Running"   stroke="#10b981" fill="url(#gRunning)"   strokeWidth={2} dot={false} />
                </AreaChart>
              </ResponsiveContainer>
            )}
          </div>
        </div>

        {/* Donut — today's status distribution */}
        <div className="card">
          <div className="card-header">
            <span className="card-title">Today's Activity</span>
            <span className="text-xs text-slate-400">Since midnight</span>
          </div>
          <div className="p-5 flex flex-col items-center">
            {statsLoading ? (
              <div className="flex items-center justify-center h-[220px] text-slate-400">
                <RefreshCw className="w-5 h-5 animate-spin" />
              </div>
            ) : donutData.length === 0 ? (
              <div className="flex flex-col items-center justify-center h-[220px] text-slate-400">
                <Activity className="w-10 h-10 mb-2 opacity-30" />
                <p className="text-sm">No activity today</p>
                {(stats?.totalWorkloads ?? 0) > 0 && (
                  <p className="text-xs mt-1 text-slate-400">
                    {stats?.totalWorkloads} workload{stats?.totalWorkloads !== 1 ? 's' : ''} ready
                  </p>
                )}
              </div>
            ) : (
              <>
                <ResponsiveContainer width="100%" height={170}>
                  <PieChart>
                    <Pie
                      data={donutData}
                      cx="50%"
                      cy="50%"
                      innerRadius={50}
                      outerRadius={75}
                      paddingAngle={3}
                      dataKey="value"
                    >
                      {donutData.map((d, i) => (
                        <Cell key={i} fill={DONUT_COLORS[d.name as keyof typeof DONUT_COLORS] ?? donutColors[i]} />
                      ))}
                    </Pie>
                    <Tooltip content={<DonutTooltip />} />
                  </PieChart>
                </ResponsiveContainer>
                <div className="mt-3 w-full space-y-1.5">
                  {donutData.map(d => (
                    <div key={d.name} className="flex items-center justify-between text-xs">
                      <div className="flex items-center gap-2">
                        <span
                          className="w-2.5 h-2.5 rounded-full flex-shrink-0"
                          style={{ background: DONUT_COLORS[d.name as keyof typeof DONUT_COLORS] }}
                        />
                        <span className="text-slate-600">{d.name}</span>
                      </div>
                      <span className="font-semibold text-slate-800">{d.value}</span>
                    </div>
                  ))}
                  <div className="pt-2 border-t border-slate-100 flex items-center justify-between text-xs text-slate-500">
                    <div className="flex items-center gap-1.5">
                      <Layers className="w-3 h-3" />
                      <span>Total workloads</span>
                    </div>
                    <span className="font-semibold text-slate-700">{stats?.totalWorkloads ?? 0}</span>
                  </div>
                </div>
              </>
            )}
          </div>
        </div>
      </div>

      {/* ── Recent Test Executions table ───────────────────── */}
      <div className="card">
        <div className="card-header">
          <span className="card-title">Recent Test Executions</span>
          <a href="/executions" className="text-xs text-blue-600 hover:text-blue-700 flex items-center gap-1 font-medium">
            View all <ChevronRight className="w-3 h-3" />
          </a>
        </div>

        {recentLoading ? (
          <div className="flex items-center justify-center py-16 text-slate-400">
            <RefreshCw className="w-5 h-5 animate-spin mr-2" />
            Loading executions…
          </div>
        ) : recentList.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-16 text-slate-400">
            <Activity className="w-10 h-10 mb-3 opacity-30" />
            <p className="text-sm font-medium">No test executions yet</p>
            <p className="text-xs mt-1">Click "Start New Test" to run your first test</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="border-b border-slate-200 bg-slate-50">
                <tr>
                  <th className="table-th">Run ID</th>
                  <th className="table-th">Workload</th>
                  <th className="table-th">Start Time</th>
                  <th className="table-th">Duration</th>
                  <th className="table-th text-right">Workers</th>
                  <th className="table-th text-right">P95 RT</th>
                  <th className="table-th text-right">Error %</th>
                  <th className="table-th">Status</th>
                  <th className="table-th">Actions</th>
                </tr>
              </thead>
              <tbody>
                {recentList.map((ex, idx) => {
                  const started  = ex.started_at  ? parseISO(ex.started_at)  : null;
                  const finished = ex.finished_at ? parseISO(ex.finished_at) : null;
                  const durationSec = started && finished
                    ? Math.round((finished.getTime() - started.getTime()) / 1000)
                    : started && ex.status === 'RUNNING'
                      ? Math.round((Date.now() - started.getTime()) / 1000)
                      : null;

                  return (
                    <tr key={ex.id} className={`${idx % 2 === 0 ? 'bg-white' : 'bg-slate-50/40'} hover:bg-blue-50/30 transition-colors`}>
                      <td className="table-td font-mono text-slate-500">#{ex.id}</td>
                      <td className="table-td font-medium text-slate-900 max-w-[200px] truncate">
                        {ex.test_plan_name}
                      </td>
                      <td className="table-td text-slate-500 whitespace-nowrap">
                        {started ? (
                          <span className="flex items-center gap-1.5">
                            <Clock className="w-3.5 h-3.5 text-slate-400" />
                            {format(started, 'MMM d, HH:mm')}
                          </span>
                        ) : '—'}
                      </td>
                      <td className="table-td text-slate-500">
                        {durationSec != null
                          ? durationSec >= 60
                            ? `${Math.floor(durationSec / 60)}m ${durationSec % 60}s`
                            : `${durationSec}s`
                          : ex.status === 'RUNNING' ? (
                            <span className="text-emerald-600 font-medium">Live</span>
                          ) : '—'}
                      </td>
                      <td className="table-td text-right text-slate-600">{ex.worker_count}</td>
                      <td className="table-td text-right font-medium">
                        {ex.p95_ms != null
                          ? <span className={ex.p95_ms > 1000 ? 'text-amber-600' : 'text-slate-700'}>{ex.p95_ms} ms</span>
                          : <span className="text-slate-300">—</span>}
                      </td>
                      <td className="table-td text-right">
                        {ex.error_rate_pct != null ? (
                          <span className={ex.error_rate_pct > 1 ? 'text-red-600 font-semibold' : 'text-slate-600'}>
                            {Number(ex.error_rate_pct).toFixed(2)}%
                          </span>
                        ) : <span className="text-slate-300">—</span>}
                      </td>
                      <td className="table-td">{statusBadge(ex.status as ExecutionStatus)}</td>
                      <td className="table-td">
                        <div className="flex items-center gap-1.5">
                          {ex.status === 'RUNNING' ? (
                            <button
                              className="btn btn-sm bg-red-50 text-red-600 border border-red-200 hover:bg-red-100"
                              onClick={() => stopMut.mutate(ex.id)}
                              title="Stop test"
                            >
                              <Square className="w-3.5 h-3.5" />
                              Stop
                            </button>
                          ) : (
                            <a
                              href={`/executions`}
                              className="btn btn-sm btn-secondary"
                            >
                              Details
                            </a>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </Layout>
  );
}
