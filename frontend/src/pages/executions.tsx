/**
 * View Results Page — All test executions with filtering and live refresh
 */
import React, { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { format, parseISO } from 'date-fns';
import {
  RefreshCw, Square, ExternalLink, Filter, Clock,
  Activity, ChevronLeft, ChevronRight, BarChart2,
} from 'lucide-react';
import Layout from '../components/common/Layout';
import { executionApi } from '../services/api';
import type { ExecutionStatus } from '../types';

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
  return (
    <span className={map[status] || 'badge'}>
      {status === 'RUNNING' && <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />}
      {status}
    </span>
  );
}

function fmtDur(s: number) {
  if (s < 60) return `${s}s`;
  return `${Math.floor(s / 60)}m ${s % 60}s`;
}

const STATUS_FILTERS = ['ALL', 'RUNNING', 'COMPLETED', 'FAILED', 'PENDING', 'STOPPED'];
const PAGE_SIZE = 20;

export default function ExecutionsPage() {
  const qc = useQueryClient();
  const [statusFilter, setStatusFilter] = useState('ALL');
  const [page, setPage] = useState(1);

  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ['executions', statusFilter, page],
    queryFn: () =>
      executionApi.list({
        status: statusFilter === 'ALL' ? undefined : statusFilter,
        page,
        limit: PAGE_SIZE,
      }),
    refetchInterval: 10_000,
  });

  const stopMut = useMutation({
    mutationFn: (id: number) => executionApi.stop(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['executions'] }),
  });

  const execs     = data?.data ?? [];
  const total     = data?.total ?? 0;
  const totalPages = Math.ceil(total / PAGE_SIZE);

  return (
    <Layout>
      {/* ── Page header ─────────────────────────────────────── */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-xl font-bold text-slate-900">View Results</h1>
          <p className="text-sm text-slate-500 mt-0.5">
            {total} execution{total !== 1 ? 's' : ''} · auto-refresh every 10s
          </p>
        </div>
        <button className="btn-secondary btn-sm" onClick={() => refetch()}>
          <RefreshCw className="w-3.5 h-3.5" />
          Refresh
        </button>
      </div>

      {/* ── Filters ─────────────────────────────────────────── */}
      <div className="card mb-5">
        <div className="p-4 flex items-center gap-2 flex-wrap">
          <Filter className="w-4 h-4 text-slate-400 mr-1" />
          {STATUS_FILTERS.map(s => (
            <button
              key={s}
              onClick={() => { setStatusFilter(s); setPage(1); }}
              className={`px-3 py-1.5 text-xs font-medium transition-colors border ${
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

      {/* ── Table ────────────────────────────────────────────── */}
      <div className="card">
        {isLoading ? (
          <div className="flex items-center justify-center py-20 text-slate-400">
            <RefreshCw className="w-5 h-5 animate-spin mr-2" /> Loading executions…
          </div>
        ) : error ? (
          <div className="flex flex-col items-center justify-center py-20 text-red-500">
            <p className="font-medium">Failed to load executions</p>
            <p className="text-xs text-slate-400 mt-1">Is the backend API running?</p>
          </div>
        ) : execs.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-20 text-slate-400">
            <Activity className="w-12 h-12 mb-4 opacity-25" />
            <p className="text-sm font-medium">No executions found</p>
            <p className="text-xs mt-1">Run a workload from the Workloads page</p>
          </div>
        ) : (
          <>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="border-b border-slate-200 bg-slate-50">
                  <tr>
                    <th className="table-th">Run ID</th>
                    <th className="table-th">Test Plan / Workload</th>
                    <th className="table-th">Status</th>
                    <th className="table-th text-right">Workers</th>
                    <th className="table-th">Triggered By</th>
                    <th className="table-th">Start Time</th>
                    <th className="table-th">Duration</th>
                    <th className="table-th text-right">Avg RT</th>
                    <th className="table-th text-right">P95 RT</th>
                    <th className="table-th text-right">Throughput</th>
                    <th className="table-th text-right">Error %</th>
                    <th className="table-th">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {execs.map((ex, i) => {
                    const started  = ex.started_at  ? parseISO(ex.started_at)  : null;
                    const finished = ex.finished_at ? parseISO(ex.finished_at) : null;
                    const durSec   = started && finished
                      ? Math.round((finished.getTime() - started.getTime()) / 1000)
                      : started && ex.status === 'RUNNING'
                        ? Math.round((Date.now() - started.getTime()) / 1000)
                        : null;

                    return (
                      <tr
                        key={ex.id}
                        className={`${i % 2 === 0 ? 'bg-white' : 'bg-slate-50/40'} hover:bg-blue-50/30 transition-colors`}
                      >
                        <td className="table-td font-mono text-slate-400 text-xs">#{ex.id}</td>
                        <td className="table-td">
                          <span className="font-medium text-slate-900">{ex.test_plan_name}</span>
                          <p className="text-xs text-slate-400 font-mono mt-0.5">{ex.jmx_file_name}</p>
                        </td>
                        <td className="table-td">{statusBadge(ex.status as ExecutionStatus)}</td>
                        <td className="table-td text-right text-slate-600">{ex.worker_count}</td>
                        <td className="table-td text-slate-500 text-xs">{ex.triggered_by || 'system'}</td>
                        <td className="table-td text-slate-500 text-xs whitespace-nowrap">
                          {started ? (
                            <span className="flex items-center gap-1.5">
                              <Clock className="w-3.5 h-3.5 text-slate-400" />
                              {format(started, 'MMM d, HH:mm')}
                            </span>
                          ) : '—'}
                        </td>
                        <td className="table-td text-slate-500 text-xs">
                          {durSec != null ? (
                            <span className={ex.status === 'RUNNING' ? 'text-emerald-600 font-medium' : ''}>
                              {fmtDur(durSec)}
                              {ex.status === 'RUNNING' ? ' ↑' : ''}
                            </span>
                          ) : '—'}
                        </td>
                        <td className="table-td text-right text-slate-700">
                          {(() => {
                            // prefer summary.avgResponseTime (JTL parsed), fallback to p50_ms (dedicated column)
                            const rt = ex.summary?.avgResponseTime ?? ex.p50_ms;
                            return rt != null
                              ? <span className={rt > 1000 ? 'text-amber-600 font-medium' : ''}>{Number(rt).toFixed(0)} ms</span>
                              : <span className="text-slate-300">—</span>;
                          })()}
                        </td>
                        <td className="table-td text-right font-medium">
                          {ex.p95_ms != null
                            ? <span className={ex.p95_ms > 1000 ? 'text-amber-600' : 'text-slate-700'}>{ex.p95_ms} ms</span>
                            : ex.summary?.p95ResponseTime != null
                              ? <span className="text-slate-700">{ex.summary.p95ResponseTime.toFixed(0)} ms</span>
                              : <span className="text-slate-300">—</span>}
                        </td>
                        <td className="table-td text-right text-slate-600">
                          {ex.avg_rps != null
                            ? `${Number(ex.avg_rps).toFixed(1)} /s`
                            : ex.summary?.throughput != null
                              ? `${ex.summary.throughput.toFixed(1)} /s`
                              : <span className="text-slate-300">—</span>}
                        </td>
                        <td className="table-td text-right">
                          {(() => {
                            // prefer dedicated column, fallback to summary JSONB
                            const err = ex.error_rate_pct ?? ex.summary?.errorRate;
                            return err != null ? (
                              <span className={Number(err) > 1 ? 'text-red-600 font-semibold' : 'text-slate-600'}>
                                {Number(err).toFixed(2)}%
                              </span>
                            ) : <span className="text-slate-300">—</span>;
                          })()}
                        </td>
                        <td className="table-td">
                          <div className="flex items-center gap-1.5">
                            {ex.status === 'RUNNING' && (
                              <button
                                className="btn btn-sm bg-red-50 text-red-600 border border-red-200 hover:bg-red-100"
                                onClick={() => stopMut.mutate(ex.id)}
                                disabled={stopMut.isPending}
                              >
                                <Square className="w-3 h-3" /> Stop
                              </button>
                            )}
                            {ex.grafana_url && (
                              <a
                                href={ex.grafana_url}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="btn btn-sm"
                                title="Open live metrics in Grafana"
                                style={{
                                  background: '#fff8f0',
                                  color: '#e8590c',
                                  border: '1px solid #ffd8a8',
                                }}
                              >
                                <BarChart2 className="w-3 h-3" /> Grafana
                              </a>
                            )}
                            {ex.report_path && (
                              <a
                                href={`/api/v1/reports/${ex.id}/html`}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="btn btn-sm btn-secondary"
                              >
                                <ExternalLink className="w-3 h-3" /> Report
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

            {/* Pagination */}
            {totalPages > 1 && (
              <div className="flex items-center justify-between px-5 py-3 border-t border-slate-200">
                <p className="text-xs text-slate-500">
                  Showing {(page - 1) * PAGE_SIZE + 1}–{Math.min(page * PAGE_SIZE, total)} of {total}
                </p>
                <div className="flex items-center gap-1">
                  <button
                    className="btn-icon"
                    onClick={() => setPage(p => Math.max(1, p - 1))}
                    disabled={page === 1}
                  >
                    <ChevronLeft className="w-4 h-4" />
                  </button>
                  {Array.from({ length: Math.min(5, totalPages) }, (_, i) => (
                    <button
                      key={i + 1}
                      onClick={() => setPage(i + 1)}
                      className={`w-7 h-7 rounded text-xs font-medium transition-colors ${
                        i + 1 === page
                          ? 'bg-blue-600 text-white'
                          : 'text-slate-600 hover:bg-slate-100'
                      }`}
                    >
                      {i + 1}
                    </button>
                  ))}
                  <button
                    className="btn-icon"
                    onClick={() => setPage(p => Math.min(totalPages, p + 1))}
                    disabled={page === totalPages}
                  >
                    <ChevronRight className="w-4 h-4" />
                  </button>
                </div>
              </div>
            )}
          </>
        )}
      </div>
    </Layout>
  );
}
