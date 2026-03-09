/**
 * Workload Details Page — Displays full workload configuration and history
 */
import React, { useState } from 'react';
import { useRouter } from 'next/router';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  ArrowLeft, Play, CalendarClock, Clock,
  Server, Layers, FileCode, Building2, Smartphone,
  Users, Timer, Zap, RefreshCw, XCircle,
} from 'lucide-react';
import { format, parseISO } from 'date-fns';
import Layout from '../../components/common/Layout';
import { workloadApi, executionApi } from '../../services/api';
import type { ExecutionStatus } from '../../types';

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

function InfoField({
  label, value, icon: Icon, mono = false,
}: {
  label: string; value: React.ReactNode; icon?: React.ElementType; mono?: boolean;
}) {
  return (
    <div>
      <p className="text-xs font-semibold text-slate-500 uppercase tracking-wide mb-1">{label}</p>
      <div className="flex items-center gap-2">
        {Icon && <Icon className="w-4 h-4 text-slate-400 flex-shrink-0" />}
        <span className={`text-sm text-slate-900 ${mono ? 'font-mono' : 'font-medium'}`}>
          {value || '—'}
        </span>
      </div>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="card mb-5">
      <div className="card-header">
        <span className="card-title">{title}</span>
      </div>
      <div className="p-5">{children}</div>
    </div>
  );
}

function RunDialog({
  workloadId, defaultWorkers, open, onClose,
}: {
  workloadId: number; defaultWorkers: number; open: boolean; onClose: () => void;
}) {
  const qc = useQueryClient();
  const [workers, setWorkers] = useState(String(defaultWorkers));
  const runMut = useMutation({
    mutationFn: () => executionApi.start({ testPlanId: workloadId, workerCount: Number(workers) }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['executions'] }); onClose(); },
  });
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div className="absolute inset-0 bg-slate-900/50" onClick={onClose} />
      <div className="relative w-full max-w-sm mx-4 bg-white rounded-2xl shadow-2xl border border-slate-200 p-6">
        <h2 className="text-base font-bold text-slate-900 mb-4">Run Workload</h2>
        <label className="label">Worker Pods</label>
        <input type="number" min={1} max={20} className="input mb-4"
          value={workers} onChange={e => setWorkers(e.target.value)} />
        <div className="flex gap-3">
          <button className="btn-secondary flex-1" onClick={onClose}>Cancel</button>
          <button className="btn-primary flex-1" onClick={() => runMut.mutate()} disabled={runMut.isPending}>
            <Play className="w-4 h-4" />
            {runMut.isPending ? 'Starting…' : 'Run Now'}
          </button>
        </div>
      </div>
    </div>
  );
}

export default function WorkloadDetailPage() {
  const router = useRouter();
  const id = Number(router.query.id);
  const [runOpen, setRunOpen] = useState(false);

  const { data: workload, isLoading } = useQuery({
    queryKey: ['workload', id],
    queryFn: () => workloadApi.get(id),
    enabled: !!id,
  });

  const { data: execData } = useQuery({
    queryKey: ['executions', id],
    queryFn: () => executionApi.list({ testPlanId: id, limit: 10 }),
    enabled: !!id,
  });

  const executions = execData?.data ?? [];

  if (isLoading) {
    return (
      <Layout>
        <div className="flex items-center justify-center h-64 text-slate-400">
          <RefreshCw className="w-6 h-6 animate-spin mr-2" /> Loading workload…
        </div>
      </Layout>
    );
  }

  if (!workload) {
    return (
      <Layout>
        <div className="flex flex-col items-center justify-center h-64 text-slate-400">
          <XCircle className="w-12 h-12 mb-3 opacity-30" />
          <p>Workload not found</p>
          <button className="btn-secondary mt-4" onClick={() => router.push('/workloads')}>
            Back to Workloads
          </button>
        </div>
      </Layout>
    );
  }

  const cfg = workload.config;

  return (
    <Layout>
      <RunDialog
        workloadId={workload.id}
        defaultWorkers={cfg.injectors}
        open={runOpen}
        onClose={() => setRunOpen(false)}
      />

      <div className="flex items-center gap-2 mb-1 text-sm text-slate-500">
        <button className="hover:text-blue-600 flex items-center gap-1"
          onClick={() => router.push('/workloads')}>
          <ArrowLeft className="w-3.5 h-3.5" /> Workloads
        </button>
        <span>/</span>
        <span className="text-slate-800 font-medium">{workload.name}</span>
      </div>

      <div className="flex items-start justify-between mb-6">
        <div>
          <h1 className="text-xl font-bold text-slate-900">{workload.name}</h1>
          <p className="text-sm text-slate-500 mt-0.5">{workload.description || 'No description provided'}</p>
        </div>
        <div className="flex items-center gap-2 flex-shrink-0">
          <button className="btn-secondary" onClick={() => router.push('/schedules')}>
            <CalendarClock className="w-4 h-4" /> Schedule
          </button>
          <button className="btn-primary" onClick={() => setRunOpen(true)}>
            <Play className="w-4 h-4" /> Run Now
          </button>
        </div>
      </div>

      <Section title="Basic Information">
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-x-8 gap-y-5">
          <InfoField label="Workload Name"   value={workload.name}           icon={Layers} />
          <InfoField label="ID"              value={`#${workload.id}`}       icon={FileCode} mono />
          <InfoField label="Type"            value={workload.type}           icon={Zap} />
          <InfoField label="Business Unit"   value={workload.business}       icon={Building2} />
          <InfoField label="Channel"         value={workload.channel}        icon={Smartphone} />
          <InfoField label="Script Location" value={workload.scriptLocation} icon={FileCode} mono />
          <InfoField label="Created By"      value={workload.created_by}     icon={Users} />
          <InfoField label="Created"
            value={format(parseISO(workload.created_at), 'MMM d, yyyy')} icon={Clock} />
        </div>
        {workload.description && (
          <div className="mt-5 pt-5 border-t border-slate-100">
            <p className="text-xs font-semibold text-slate-500 uppercase tracking-wide mb-1">Description</p>
            <p className="text-sm text-slate-700">{workload.description}</p>
          </div>
        )}
      </Section>

      <Section title="Test Configuration">
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-4">
          {[
            { label: 'Duration',     value: `${cfg.duration}s`,    icon: Timer,  detail: `${Math.floor(cfg.duration/60)}m ${cfg.duration%60}s` },
            { label: 'Ramp Up',      value: `${cfg.rampUp}s`,      icon: Zap,    detail: 'Gradual thread start' },
            { label: 'Delay Offset', value: `${cfg.delayOffset}s`, icon: Clock,  detail: 'Startup delay' },
            { label: 'Think Time',   value: `${cfg.thinkTime}ms`,  icon: Timer,  detail: 'Between requests' },
            { label: 'Injectors',    value: cfg.injectors,         icon: Server, detail: 'Worker pods' },
          ].map(({ label, value, icon: Icon, detail }) => (
            <div key={label} className="bg-slate-50 rounded-xl p-4 border border-slate-200">
              <div className="flex items-center gap-2 mb-2">
                <div className="w-7 h-7 rounded-lg bg-blue-100 flex items-center justify-center">
                  <Icon className="w-3.5 h-3.5 text-blue-600" />
                </div>
                <span className="text-xs font-semibold text-slate-500 uppercase tracking-wide">{label}</span>
              </div>
              <p className="text-2xl font-bold text-slate-900">{value}</p>
              <p className="text-xs text-slate-400 mt-0.5">{detail}</p>
            </div>
          ))}
        </div>
      </Section>

      <Section title="Thread Distribution">
        {workload.threadGroups && workload.threadGroups.length > 0 ? (
          <div className="table-container">
            <table className="table">
              <thead>
                <tr>
                  <th className="table-th">User Group / Thread Group</th>
                  <th className="table-th text-right">Threads</th>
                  <th className="table-th text-right">Ramp Up (s)</th>
                  <th className="table-th text-right">Duration (s)</th>
                  <th className="table-th text-right">Target TPS</th>
                </tr>
              </thead>
              <tbody>
                {workload.threadGroups.map((tg, i) => (
                  <tr key={i} className={i % 2 === 0 ? 'bg-white' : 'bg-slate-50/50'}>
                    <td className="table-td font-medium text-slate-800">
                      <div className="flex items-center gap-2">
                        <div className="w-2 h-2 rounded-full bg-blue-400 flex-shrink-0" />
                        {tg.name}
                      </div>
                    </td>
                    <td className="table-td text-right font-semibold text-slate-900">{tg.threads}</td>
                    <td className="table-td text-right text-slate-600">{tg.rampUp}</td>
                    <td className="table-td text-right text-slate-600">{tg.duration}</td>
                    <td className="table-td text-right text-slate-500">{tg.targetThroughput ?? '—'}</td>
                  </tr>
                ))}
              </tbody>
              <tfoot className="bg-slate-50 border-t border-slate-200">
                <tr>
                  <td className="table-td font-bold text-slate-700">Total</td>
                  <td className="table-td text-right font-bold text-slate-900">
                    {workload.threadGroups.reduce((s, g) => s + g.threads, 0)}
                  </td>
                  <td className="table-td" colSpan={3} />
                </tr>
              </tfoot>
            </table>
          </div>
        ) : (
          <div className="flex flex-col items-center py-8 text-slate-400">
            <Users className="w-8 h-8 mb-2 opacity-30" />
            <p className="text-sm">No thread groups defined</p>
          </div>
        )}
      </Section>

      <Section title="Recent Executions">
        {executions.length === 0 ? (
          <div className="flex flex-col items-center py-8 text-slate-400">
            <Play className="w-8 h-8 mb-2 opacity-30" />
            <p className="text-sm">No executions yet</p>
            <button className="btn-primary btn-sm mt-3" onClick={() => setRunOpen(true)}>
              <Play className="w-3.5 h-3.5" /> Run Now
            </button>
          </div>
        ) : (
          <div className="table-container">
            <table className="table">
              <thead>
                <tr>
                  <th className="table-th">Run ID</th>
                  <th className="table-th">Started</th>
                  <th className="table-th">Duration</th>
                  <th className="table-th text-right">Workers</th>
                  <th className="table-th">Status</th>
                  <th className="table-th text-right">Avg RT</th>
                  <th className="table-th text-right">Error %</th>
                </tr>
              </thead>
              <tbody>
                {executions.map((ex, i) => {
                  const started  = ex.started_at  ? parseISO(ex.started_at)  : null;
                  const finished = ex.finished_at ? parseISO(ex.finished_at) : null;
                  const durSec   = started && finished
                    ? Math.round((finished.getTime() - started.getTime()) / 1000) : null;
                  return (
                    <tr key={ex.id} className={i % 2 === 0 ? 'bg-white' : 'bg-slate-50/40'}>
                      <td className="table-td font-mono text-slate-400 text-xs">#{ex.id}</td>
                      <td className="table-td text-slate-600 text-xs whitespace-nowrap">
                        {started ? format(started, 'MMM d, HH:mm') : '—'}
                      </td>
                      <td className="table-td text-slate-600 text-xs">
                        {durSec != null ? `${Math.floor(durSec/60)}m ${durSec%60}s` : '—'}
                      </td>
                      <td className="table-td text-right text-slate-600">{ex.worker_count}</td>
                      <td className="table-td">{statusBadge(ex.status)}</td>
                      <td className="table-td text-right text-slate-700">
                        {ex.summary?.avgResponseTime != null ? `${ex.summary.avgResponseTime.toFixed(0)} ms` : '—'}
                      </td>
                      <td className="table-td text-right">
                        {ex.summary?.errorRate != null ? (
                          <span className={ex.summary.errorRate > 1 ? 'text-red-600 font-semibold' : 'text-slate-700'}>
                            {ex.summary.errorRate.toFixed(2)}%
                          </span>
                        ) : '—'}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </Section>
    </Layout>
  );
}
