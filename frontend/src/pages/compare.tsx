/**
 * Compare Tests Page — Multi-select executions and compare metrics side-by-side
 */
import React, { useState, useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  BarChart, Bar, LineChart, Line, XAxis, YAxis, CartesianGrid,
  Tooltip, Legend, ResponsiveContainer, Cell,
} from 'recharts';
import {
  GitCompare, RefreshCw, CheckSquare, Square, BarChart3,
  TrendingUp, AlertTriangle, Clock, ChevronRight,
} from 'lucide-react';
import { format, parseISO } from 'date-fns';
import Layout from '../components/common/Layout';
import { executionApi } from '../services/api';
import type { TestExecution, ExecutionStatus } from '../types';

// ── Colour palette for runs ────────────────────────────────────────────────
const RUN_COLORS = ['#3b82f6', '#10b981', '#f59e0b', '#ef4444', '#8b5cf6', '#06b6d4'];

// ── Status badge ───────────────────────────────────────────────────────────
function statusBadge(status: ExecutionStatus) {
  const map: Record<ExecutionStatus, string> = {
    RUNNING:      'badge-running',
    COMPLETED:    'badge-completed',
    FAILED:       'badge-failed',
    PENDING:      'badge-pending',
    PROVISIONING: 'badge-pending',
    STOPPED:      'badge-stopped',
  };
  return <span className={map[status] || 'badge'}>{status}</span>;
}

// ── Custom tooltip ─────────────────────────────────────────────────────────
const ChartTooltip = ({ active, payload, label }: any) => {
  if (!active || !payload?.length) return null;
  return (
    <div className="bg-white border border-slate-200 px-3 py-2.5 text-xs space-y-1" style={{ boxShadow: '0 2px 6px rgba(0,0,0,0.15)' }}>
      <p className="font-semibold text-slate-700 mb-1">{label}</p>
      {payload.map((p: any) => (
        <div key={p.name} className="flex items-center gap-2">
          <span className="w-2 h-2 rounded-full flex-shrink-0" style={{ background: p.color || p.fill }} />
          <span className="text-slate-600 truncate max-w-[120px]">{p.name}:</span>
          <span className="font-semibold text-slate-900 ml-auto pl-2">
            {typeof p.value === 'number' ? p.value.toFixed(1) : p.value}
          </span>
        </div>
      ))}
    </div>
  );
};

// ── Metric card ────────────────────────────────────────────────────────────
function MetricCard({
  label, icon: Icon, iconBg, iconColor, children,
}: {
  label: string; icon: React.ElementType; iconBg: string; iconColor: string; children: React.ReactNode;
}) {
  return (
    <div className="card">
      <div className="card-header">
        <div className="flex items-center gap-2">
          <div className={`w-7 h-7 ${iconBg} flex items-center justify-center`}>
            <Icon className={`w-3.5 h-3.5 ${iconColor}`} />
          </div>
          <span className="card-title">{label}</span>
        </div>
      </div>
      <div className="p-4">{children}</div>
    </div>
  );
}

// ── Main page ──────────────────────────────────────────────────────────────
export default function CompareTestsPage() {
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [compared, setCompared] = useState<number[]>([]);
  const [statusFilter, setStatusFilter] = useState<string>('ALL');
  const [page, setPage] = useState(1);
  const PAGE_SIZE = 15;

  const { data, isLoading, refetch } = useQuery({
    queryKey: ['executions-compare-list', page],
    queryFn: () => executionApi.list({ limit: 100 }),
    refetchInterval: 30_000,
  });

  // Load comparison data
  const { data: compareExecs } = useQuery({
    queryKey: ['compare', compared],
    queryFn: () => executionApi.compare(compared),
    enabled: compared.length >= 2,
  });

  const allExecs = data?.data ?? [];

  const filtered = useMemo(() => {
    let list = allExecs;
    if (statusFilter !== 'ALL') list = list.filter(e => e.status === statusFilter);
    return list.sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());
  }, [allExecs, statusFilter]);

  const toggle = (id: number) => {
    setSelected(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else if (next.size < 6) next.add(id);
      return next;
    });
  };

  const handleCompare = () => {
    setCompared(Array.from(selected));
  };

  // Build chart data from compared executions
  const comparedList = useMemo<TestExecution[]>(() => {
    if (compareExecs && Array.isArray(compareExecs)) return compareExecs;
    // fallback: find from allExecs
    return compared.map(id => allExecs.find(e => e.id === id)!).filter(Boolean);
  }, [compareExecs, compared, allExecs]);

  // Helper to get metric value with camelCase (compare endpoint) → snake_case (list) → summary fallback
  const getP95   = (ex: TestExecution) => ex.p95Ms   ?? ex.p95_ms                       ?? ex.summary?.p95ResponseTime  ?? 0;
  const getP99   = (ex: TestExecution) => ex.p99Ms   ?? ex.p99_ms                       ?? ex.summary?.p99ResponseTime  ?? 0;
  const getAvgRt = (ex: TestExecution) => ex.p50Ms   ?? ex.p50_ms                       ?? ex.summary?.avgResponseTime  ?? 0;
  const getRps   = (ex: TestExecution) => ex.avgRps  ?? ex.avg_rps                      ?? ex.summary?.throughput       ?? 0;
  const getErr   = (ex: TestExecution) => ex.errorRatePct ?? ex.error_rate_pct          ?? ex.summary?.errorRate        ?? 0;
  const getReqs  = (ex: TestExecution) => {
    // compare endpoint returns camelCase totalRequests; list returns snake_case total_requests
    const v = (ex as any).totalRequests ?? ex.total_requests;
    return v != null ? Number(v) : 0;
  };

  const responseTimeData = comparedList.map((ex, i) => ({
    name: `Run #${ex.id}`,
    'Avg RT':  Number(getAvgRt(ex).toFixed(1)),
    'P95 RT':  Number(getP95(ex).toFixed(1)),
    'P99 RT':  Number(getP99(ex).toFixed(1)),
    color: RUN_COLORS[i % RUN_COLORS.length],
  }));

  const throughputData = comparedList.map((ex, i) => ({
    name: `Run #${ex.id}`,
    'Throughput (req/s)': Number(getRps(ex).toFixed(2)),
    color: RUN_COLORS[i % RUN_COLORS.length],
  }));

  const errorData = comparedList.map((ex, i) => ({
    name: `Run #${ex.id}`,
    'Error Rate (%)': Number(getErr(ex).toFixed(2)),
    color: RUN_COLORS[i % RUN_COLORS.length],
  }));

  const hasComparison = compared.length >= 2;

  return (
    <Layout>
      {/* ── Page header ─────────────────────────────────────── */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-xl font-bold text-slate-900">Compare Tests</h1>
          <p className="text-sm text-slate-500 mt-0.5">
            Select 2–6 executions to compare their metrics side-by-side
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button className="btn-secondary btn-sm" onClick={() => refetch()}>
            <RefreshCw className="w-3.5 h-3.5" />
            Refresh
          </button>
          {selected.size >= 2 && (
            <button className="btn-primary" onClick={handleCompare}>
              <GitCompare className="w-4 h-4" />
              Compare {selected.size} Runs
            </button>
          )}
        </div>
      </div>

      {/* ── Selection table ──────────────────────────────────── */}
      <div className="card mb-6">
        <div className="card-header">
          <div className="flex items-center gap-3">
            <span className="card-title">Test Executions</span>
            {selected.size > 0 && (
              <span className="badge badge-scheduled">{selected.size} selected</span>
            )}
          </div>
          <div className="flex items-center gap-2">
            <span className="text-xs text-slate-500">Filter:</span>
            {['ALL', 'COMPLETED', 'FAILED', 'RUNNING'].map(s => (
              <button
                key={s}
                onClick={() => setStatusFilter(s)}
                className={`px-3 py-1 text-xs font-medium transition-colors border ${
                  statusFilter === s
                    ? 'bg-[#0f62fe] text-white border-[#0f62fe]'
                    : 'bg-[#e0e0e0] text-[#525252] border-[#e0e0e0] hover:bg-[#c6c6c6] hover:border-[#c6c6c6]'
                }`}
              >
                {s}
              </button>
            ))}
          </div>
        </div>

        {isLoading ? (
          <div className="flex items-center justify-center py-16 text-slate-400">
            <RefreshCw className="w-5 h-5 animate-spin mr-2" /> Loading executions…
          </div>
        ) : filtered.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-16 text-slate-400">
            <BarChart3 className="w-10 h-10 mb-3 opacity-25" />
            <p className="text-sm font-medium">No executions found</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="border-b border-slate-200 bg-slate-50">
                <tr>
                  <th className="table-th w-10">
                    <span className="sr-only">Select</span>
                  </th>
                  <th className="table-th">Run ID</th>
                  <th className="table-th">Execution Name</th>
                  <th className="table-th">Workload</th>
                  <th className="table-th">Start Time</th>
                  <th className="table-th text-right">Workers</th>
                  <th className="table-th text-right">Avg RT</th>
                  <th className="table-th text-right">Error %</th>
                  <th className="table-th">Status</th>
                </tr>
              </thead>
              <tbody>
                {filtered.slice(0, PAGE_SIZE).map((ex, i) => {
                  const isSelected = selected.has(ex.id);
                  const isCompared = compared.includes(ex.id);
                  const compIdx = compared.indexOf(ex.id);

                  return (
                    <tr
                      key={ex.id}
                      onClick={() => toggle(ex.id)}
                      className={`cursor-pointer transition-colors ${
                        isSelected
                          ? 'bg-blue-50 hover:bg-blue-100/70'
                          : i % 2 === 0
                            ? 'bg-white hover:bg-slate-50'
                            : 'bg-slate-50/40 hover:bg-slate-100/60'
                      }`}
                    >
                      <td className="table-td pl-4">
                        {isSelected ? (
                          <CheckSquare className="w-4 h-4 text-blue-600" />
                        ) : (
                          <Square className="w-4 h-4 text-slate-300" />
                        )}
                      </td>
                      <td className="table-td">
                        <div className="flex items-center gap-2">
                          {isCompared && (
                            <span
                              className="w-3 h-3 rounded-full flex-shrink-0"
                              style={{ background: RUN_COLORS[compIdx % RUN_COLORS.length] }}
                            />
                          )}
                          <span className="font-mono text-slate-500 text-xs">#{ex.id}</span>
                        </div>
                      </td>
                      <td className="table-td font-medium text-slate-900">Exec-{ex.id}</td>
                      <td className="table-td text-slate-700">{ex.test_plan_name}</td>
                      <td className="table-td text-slate-500 text-xs whitespace-nowrap">
                        {ex.started_at
                          ? format(parseISO(ex.started_at), 'MMM d, HH:mm')
                          : '—'}
                      </td>
                      <td className="table-td text-right text-slate-600">{ex.worker_count}</td>
                      <td className="table-td text-right font-medium text-slate-700">
                        {(() => {
                          const rt = ex.p50_ms ?? ex.summary?.avgResponseTime;
                          return rt != null ? `${Number(rt).toFixed(0)} ms` : '—';
                        })()}
                      </td>
                      <td className="table-td text-right">
                        {(() => {
                          const err = ex.error_rate_pct ?? ex.summary?.errorRate;
                          return err != null ? (
                            <span className={Number(err) > 1 ? 'text-red-600 font-semibold' : 'text-slate-600'}>
                              {Number(err).toFixed(2)}%
                            </span>
                          ) : '—';
                        })()}
                      </td>
                      <td className="table-td">{statusBadge(ex.status)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}

        {selected.size > 0 && selected.size < 2 && (
          <div className="px-5 py-3 border-t border-slate-200 bg-amber-50">
            <p className="text-xs text-amber-700 font-medium">
              Select at least 2 executions to compare (max 6)
            </p>
          </div>
        )}
      </div>

      {/* ── Comparison charts ─────────────────────────────────── */}
      {hasComparison && comparedList.length >= 2 ? (
        <>
          <div className="flex items-center gap-3 mb-4">
            <h2 className="text-base font-bold text-slate-900">Comparison Results</h2>
            <div className="flex items-center gap-2">
              {comparedList.map((ex, i) => (
                <span
                  key={ex.id}
                  className="inline-flex items-center gap-1.5 px-2.5 py-1 text-xs font-semibold border bg-white"
                  style={{ borderColor: RUN_COLORS[i % RUN_COLORS.length], color: RUN_COLORS[i % RUN_COLORS.length] }}
                >
                  <span className="w-2 h-2 rounded-full" style={{ background: RUN_COLORS[i % RUN_COLORS.length] }} />
                  Run #{ex.id} — {ex.test_plan_name}
                </span>
              ))}
            </div>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-5 mb-5">
            {/* Response Time comparison */}
            <MetricCard label="Response Time (ms)" icon={Clock} iconBg="bg-blue-50" iconColor="text-blue-600">
              <ResponsiveContainer width="100%" height={220}>
                <BarChart data={responseTimeData} margin={{ top: 4, right: 8, bottom: 0, left: -10 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
                  <XAxis dataKey="name" tick={{ fontSize: 11, fill: '#94a3b8' }} axisLine={false} tickLine={false} />
                  <YAxis tick={{ fontSize: 11, fill: '#94a3b8' }} axisLine={false} tickLine={false} />
                  <Tooltip content={<ChartTooltip />} />
                  <Legend iconSize={8} iconType="circle" wrapperStyle={{ fontSize: 11 }} />
                  <Bar dataKey="Avg RT"  radius={[4,4,0,0]} fill="#3b82f6" />
                  <Bar dataKey="P95 RT"  radius={[4,4,0,0]} fill="#93c5fd" />
                  <Bar dataKey="P99 RT"  radius={[4,4,0,0]} fill="#dbeafe" />
                </BarChart>
              </ResponsiveContainer>
            </MetricCard>

            {/* Throughput */}
            <MetricCard label="Throughput (req/s)" icon={TrendingUp} iconBg="bg-emerald-50" iconColor="text-emerald-600">
              <ResponsiveContainer width="100%" height={220}>
                <BarChart data={throughputData} margin={{ top: 4, right: 8, bottom: 0, left: -10 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
                  <XAxis dataKey="name" tick={{ fontSize: 11, fill: '#94a3b8' }} axisLine={false} tickLine={false} />
                  <YAxis tick={{ fontSize: 11, fill: '#94a3b8' }} axisLine={false} tickLine={false} />
                  <Tooltip content={<ChartTooltip />} />
                  <Bar dataKey="Throughput (req/s)" radius={[4,4,0,0]}>
                    {throughputData.map((d, i) => (
                      <Cell key={i} fill={RUN_COLORS[i % RUN_COLORS.length]} />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </MetricCard>

            {/* Error Rate */}
            <MetricCard label="Error Rate (%)" icon={AlertTriangle} iconBg="bg-red-50" iconColor="text-red-500">
              <ResponsiveContainer width="100%" height={220}>
                <BarChart data={errorData} margin={{ top: 4, right: 8, bottom: 0, left: -10 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
                  <XAxis dataKey="name" tick={{ fontSize: 11, fill: '#94a3b8' }} axisLine={false} tickLine={false} />
                  <YAxis tick={{ fontSize: 11, fill: '#94a3b8' }} axisLine={false} tickLine={false} />
                  <Tooltip content={<ChartTooltip />} />
                  <Bar dataKey="Error Rate (%)" radius={[4,4,0,0]}>
                    {errorData.map((d, i) => (
                      <Cell key={i} fill={d['Error Rate (%)'] > 1 ? '#ef4444' : '#10b981'} />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </MetricCard>

            {/* Summary table */}
            <div className="card">
              <div className="card-header">
                <span className="card-title">Summary Comparison</span>
              </div>
              <div className="overflow-x-auto">
                <table className="table">
                  <thead>
                    <tr>
                      <th className="table-th">Metric</th>
                      {comparedList.map((ex, i) => (
                        <th key={ex.id} className="table-th">
                          <span className="flex items-center gap-1.5">
                            <span className="w-2 h-2 rounded-full" style={{ background: RUN_COLORS[i] }} />
                            Run #{ex.id}
                          </span>
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {[
                      { label: 'Avg RT (ms)',        key: (e: TestExecution) => { const v = getAvgRt(e); return v > 0 ? v.toFixed(1) : '—'; } },
                      { label: 'P95 RT (ms)',         key: (e: TestExecution) => { const v = getP95(e);   return v > 0 ? v.toFixed(1) : '—'; } },
                      { label: 'P99 RT (ms)',         key: (e: TestExecution) => { const v = getP99(e);   return v > 0 ? v.toFixed(1) : '—'; } },
                      { label: 'Throughput (req/s)',  key: (e: TestExecution) => { const v = getRps(e);   return v > 0 ? v.toFixed(2) : '—'; } },
                      { label: 'Error Rate (%)',      key: (e: TestExecution) => { const v = getErr(e);   return v >= 0 ? v.toFixed(2) : '—'; } },
                      { label: 'Total Requests',      key: (e: TestExecution) => { const v = getReqs(e);  return v > 0 ? v.toLocaleString() : '—'; } },
                      { label: 'Workers',             key: (e: TestExecution) => String((e as any).workerCount ?? e.worker_count ?? '—') },
                    ].map(({ label, key }, ri) => (
                      <tr key={label} className={ri % 2 === 0 ? 'bg-white' : 'bg-slate-50/50'}>
                        <td className="table-td font-medium text-slate-700">{label}</td>
                        {comparedList.map(ex => (
                          <td key={ex.id} className="table-td text-slate-700">{key(ex)}</td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        </>
      ) : hasComparison ? (
        <div className="card flex flex-col items-center justify-center py-16 text-slate-400">
          <RefreshCw className="w-8 h-8 animate-spin mb-3 opacity-40" />
          <p className="text-sm">Loading comparison data…</p>
        </div>
      ) : (
        <div className="card flex flex-col items-center justify-center py-16 text-slate-400">
          <GitCompare className="w-12 h-12 mb-4 opacity-25" />
          <p className="text-sm font-medium text-slate-600">Select executions above to compare</p>
          <p className="text-xs text-slate-400 mt-1">Choose 2–6 completed test runs, then click Compare</p>
        </div>
      )}
    </Layout>
  );
}
