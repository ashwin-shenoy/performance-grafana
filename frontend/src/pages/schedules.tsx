/**
 * Scheduling Page — Schedule tests or run immediately
 */
import React, { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  CalendarClock, Play, Clock, Trash2, ToggleLeft, ToggleRight,
  Plus, RefreshCw, CheckCircle2, XCircle, Calendar,
  ChevronDown, ChevronUp, Info,
} from 'lucide-react';
import { format, parseISO } from 'date-fns';
import Layout from '../components/common/Layout';
import { scheduleApi, executionApi, testPlanApi } from '../services/api';
import type { Schedule } from '../types';

// ── Cron presets ───────────────────────────────────────────────────────────
const CRON_PRESETS = [
  { label: 'Every hour',        value: '0 * * * *'     },
  { label: 'Every 6 hours',     value: '0 */6 * * *'   },
  { label: 'Daily at midnight', value: '0 0 * * *'     },
  { label: 'Daily at 6am',      value: '0 6 * * *'     },
  { label: 'Weekly (Mon 9am)',   value: '0 9 * * 1'     },
  { label: 'Custom…',           value: '__custom__'     },
];

// ── Schedule row ───────────────────────────────────────────────────────────
function ScheduleRow({
  schedule,
  onDelete,
  onToggle,
}: {
  schedule: Schedule;
  onDelete: (id: number) => void;
  onToggle: (id: number, enabled: boolean) => void;
}) {
  return (
    <tr className="hover:bg-slate-50/70 transition-colors">
      <td className="table-td">
        <span className="font-medium text-slate-900">{schedule.test_plan_name}</span>
      </td>
      <td className="table-td">
        <code className="text-xs bg-slate-100 px-2 py-0.5 rounded font-mono text-slate-700">
          {schedule.cron_expression}
        </code>
      </td>
      <td className="table-td text-right font-medium text-slate-700">{schedule.worker_count}</td>
      <td className="table-td text-slate-500 text-xs whitespace-nowrap">
        {schedule.last_run_at
          ? format(parseISO(schedule.last_run_at), 'MMM d, HH:mm')
          : <span className="text-slate-300">Never</span>}
      </td>
      <td className="table-td">
        <button
          className="flex items-center gap-1.5 text-xs font-medium transition-colors"
          onClick={() => onToggle(schedule.id, !schedule.enabled)}
        >
          {schedule.enabled ? (
            <>
              <ToggleRight className="w-5 h-5 text-emerald-500" />
              <span className="text-emerald-600">Active</span>
            </>
          ) : (
            <>
              <ToggleLeft className="w-5 h-5 text-slate-400" />
              <span className="text-slate-400">Paused</span>
            </>
          )}
        </button>
      </td>
      <td className="table-td">
        <button
          className="btn-icon text-red-500 hover:bg-red-50"
          title="Delete schedule"
          onClick={() => {
            if (confirm('Delete this schedule?')) onDelete(schedule.id);
          }}
        >
          <Trash2 className="w-4 h-4" />
        </button>
      </td>
    </tr>
  );
}

// ── Mode toggle ────────────────────────────────────────────────────────────
type Mode = 'schedule' | 'immediate';

function ModeTab({
  active, label, icon: Icon, onClick,
}: {
  active: boolean; label: string; icon: React.ElementType; onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className={`flex items-center gap-2.5 px-5 py-3.5 text-sm font-medium border-b-2 transition-all ${
        active
          ? 'border-blue-600 text-blue-600 bg-blue-50/50'
          : 'border-transparent text-slate-500 hover:text-slate-700 hover:bg-slate-50'
      }`}
    >
      <Icon className="w-4 h-4" />
      {label}
    </button>
  );
}

// ── Main Page ──────────────────────────────────────────────────────────────
export default function SchedulingPage() {
  const qc = useQueryClient();
  const [mode, setMode] = useState<Mode>('schedule');

  // ─ Form state ─
  const [planId, setPlanId]             = useState('');
  const [workers, setWorkers]           = useState('1');
  const [duration, setDuration]         = useState('300');
  const [cronPreset, setCronPreset]     = useState(CRON_PRESETS[2].value);
  const [customCron, setCustomCron]     = useState('');
  const [showCronHelp, setShowCronHelp] = useState(false);

  // ─ Queries ─
  const { data: plans } = useQuery({
    queryKey: ['test-plans'],
    queryFn: () => testPlanApi.list({ limit: 100 }),
  });

  const { data: schedules, isLoading, refetch } = useQuery({
    queryKey: ['schedules'],
    queryFn: scheduleApi.list,
    refetchInterval: 30_000,
  });

  // ─ Mutations ─
  const runMut = useMutation({
    mutationFn: () =>
      executionApi.start({
        testPlanId:  Number(planId),
        workerCount: Number(workers),
        parameters:  { duration },
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['executions'] });
      setPlanId(''); setWorkers('1');
    },
  });

  const createMut = useMutation({
    mutationFn: () => {
      const cron = cronPreset === '__custom__' ? customCron : cronPreset;
      return scheduleApi.create({
        testPlanId:     Number(planId),
        cronExpression: cron,
        workerCount:    Number(workers),
        parameters:     { duration },
      });
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['schedules'] });
      setPlanId(''); setWorkers('1');
    },
  });

  const deleteMut = useMutation({
    mutationFn: (id: number) => scheduleApi.delete(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['schedules'] }),
  });

  const toggleMut = useMutation({
    mutationFn: ({ id, enabled }: { id: number; enabled: boolean }) =>
      scheduleApi.update(id, { enabled }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['schedules'] }),
  });

  const effectiveCron = cronPreset === '__custom__' ? customCron : cronPreset;
  const canSubmit = !!planId && Number(workers) >= 1;

  const scheduleList = schedules ?? [];

  return (
    <Layout>
      {/* ── Page header ─────────────────────────────────────── */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-xl font-bold text-slate-900">Scheduling</h1>
          <p className="text-sm text-slate-500 mt-0.5">
            Run tests immediately or schedule them on a recurring basis
          </p>
        </div>
        <button className="btn-secondary btn-sm" onClick={() => refetch()}>
          <RefreshCw className="w-3.5 h-3.5" />
          Refresh
        </button>
      </div>

      {/* ── Mode tabs + form ─────────────────────────────────── */}
      <div className="card mb-6">
        {/* Tabs */}
        <div className="flex border-b border-slate-200">
          <ModeTab
            active={mode === 'schedule'}
            label="Schedule Recurring Test"
            icon={CalendarClock}
            onClick={() => setMode('schedule')}
          />
          <ModeTab
            active={mode === 'immediate'}
            label="Run Immediately"
            icon={Play}
            onClick={() => setMode('immediate')}
          />
        </div>

        {/* Form */}
        <div className="p-6">
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5">
            {/* Workload */}
            <div className="md:col-span-2 lg:col-span-1">
              <label className="label">Workload *</label>
              <select
                className="select"
                value={planId}
                onChange={e => setPlanId(e.target.value)}
              >
                <option value="">Select a workload…</option>
                {plans?.data.map(p => (
                  <option key={p.id} value={p.id}>{p.name}</option>
                ))}
              </select>
            </div>

            {/* Worker pods */}
            <div>
              <label className="label">Worker Pods</label>
              <input
                type="number" min={1} max={20}
                className="input"
                value={workers}
                onChange={e => setWorkers(e.target.value)}
                placeholder="1"
              />
              <p className="text-xs text-slate-400 mt-1">Number of JMeter worker pods</p>
            </div>

            {/* Duration */}
            <div>
              <label className="label">Duration (seconds)</label>
              <input
                type="number" min={30}
                className="input"
                value={duration}
                onChange={e => setDuration(e.target.value)}
                placeholder="300"
              />
              <p className="text-xs text-slate-400 mt-1">
                {Number(duration) >= 60
                  ? `${Math.floor(Number(duration) / 60)}m ${Number(duration) % 60}s`
                  : `${duration}s`}
              </p>
            </div>

            {/* Cron — only for schedule mode */}
            {mode === 'schedule' && (
              <>
                <div className="md:col-span-2">
                  <div className="flex items-center justify-between mb-1.5">
                    <label className="label mb-0">Schedule (Cron Expression)</label>
                    <button
                      className="text-xs text-blue-600 hover:text-blue-700 flex items-center gap-1"
                      onClick={() => setShowCronHelp(h => !h)}
                    >
                      <Info className="w-3 h-3" />
                      Cron help
                      {showCronHelp ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
                    </button>
                  </div>

                  <div className="flex gap-2">
                    <select
                      className="select flex-1"
                      value={cronPreset}
                      onChange={e => setCronPreset(e.target.value)}
                    >
                      {CRON_PRESETS.map(p => (
                        <option key={p.value} value={p.value}>{p.label}</option>
                      ))}
                    </select>
                    {cronPreset === '__custom__' && (
                      <input
                        className="input flex-1 font-mono"
                        placeholder="0 * * * *"
                        value={customCron}
                        onChange={e => setCustomCron(e.target.value)}
                      />
                    )}
                  </div>

                  {showCronHelp && (
                    <div className="mt-3 p-4 bg-slate-50 border border-slate-200 text-xs text-slate-600">
                      <p className="font-semibold text-slate-700 mb-2">Cron Expression Format</p>
                      <p className="font-mono mb-2 text-slate-500">
                        <span className="text-blue-600">MIN</span>{' '}
                        <span className="text-emerald-600">HOUR</span>{' '}
                        <span className="text-amber-600">DOM</span>{' '}
                        <span className="text-violet-600">MON</span>{' '}
                        <span className="text-red-500">DOW</span>
                      </p>
                      <div className="space-y-1">
                        <p><code className="bg-slate-200 px-1 rounded">0 * * * *</code> — Every hour</p>
                        <p><code className="bg-slate-200 px-1 rounded">0 9 * * 1-5</code> — Weekdays at 9am</p>
                        <p><code className="bg-slate-200 px-1 rounded">0 */4 * * *</code> — Every 4 hours</p>
                      </div>
                    </div>
                  )}

                  {cronPreset !== '__custom__' && (
                    <p className="text-xs text-slate-400 mt-1 font-mono">{effectiveCron}</p>
                  )}
                </div>
              </>
            )}
          </div>

          {/* Summary & submit */}
          {planId && (
            <div className="mt-5 p-4 bg-[#edf5ff] border border-[#a6c8ff] flex items-start justify-between gap-4">
              <div className="text-sm text-blue-800">
                <p className="font-semibold mb-0.5">
                  {mode === 'schedule' ? '📅 Scheduling' : '🚀 Running now'}:{' '}
                  {plans?.data.find(p => String(p.id) === planId)?.name}
                </p>
                <p className="text-blue-600 text-xs">
                  {Number(workers)} worker{Number(workers) > 1 ? 's' : ''} ·{' '}
                  {Number(duration) >= 60
                    ? `${Math.floor(Number(duration) / 60)}m ${Number(duration) % 60}s`
                    : `${duration}s`} duration
                  {mode === 'schedule' && ` · ${effectiveCron}`}
                </p>
              </div>
              <button
                className="btn-primary flex-shrink-0"
                disabled={!canSubmit || runMut.isPending || createMut.isPending}
                onClick={() => mode === 'immediate' ? runMut.mutate() : createMut.mutate()}
              >
                {mode === 'immediate' ? (
                  <><Play className="w-4 h-4" />
                    {runMut.isPending ? 'Starting…' : 'Run Now'}
                  </>
                ) : (
                  <><CalendarClock className="w-4 h-4" />
                    {createMut.isPending ? 'Scheduling…' : 'Create Schedule'}
                  </>
                )}
              </button>
            </div>
          )}

          {runMut.isSuccess && (
            <div className="mt-3 flex items-center gap-2 text-sm text-emerald-700 font-medium">
              <CheckCircle2 className="w-4 h-4" /> Test started successfully!
            </div>
          )}
          {createMut.isSuccess && (
            <div className="mt-3 flex items-center gap-2 text-sm text-emerald-700 font-medium">
              <CheckCircle2 className="w-4 h-4" /> Schedule created successfully!
            </div>
          )}
          {(runMut.isError || createMut.isError) && (
            <div className="mt-3 flex items-center gap-2 text-sm text-red-600 font-medium">
              <XCircle className="w-4 h-4" /> An error occurred. Please try again.
            </div>
          )}
        </div>
      </div>

      {/* ── Schedules list ───────────────────────────────────── */}
      <div className="card">
        <div className="card-header">
          <span className="card-title">Active Schedules</span>
          <span className="text-xs text-slate-400">{scheduleList.length} schedule{scheduleList.length !== 1 ? 's' : ''}</span>
        </div>

        {isLoading ? (
          <div className="flex items-center justify-center py-16 text-slate-400">
            <RefreshCw className="w-5 h-5 animate-spin mr-2" /> Loading schedules…
          </div>
        ) : scheduleList.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-16 text-slate-400">
            <Calendar className="w-12 h-12 mb-4 opacity-25" />
            <p className="text-sm font-medium text-slate-600">No schedules configured</p>
            <p className="text-xs text-slate-400 mt-1">Use the form above to create your first recurring test</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="border-b border-slate-200 bg-slate-50">
                <tr>
                  <th className="table-th">Workload</th>
                  <th className="table-th">Cron Expression</th>
                  <th className="table-th text-right">Workers</th>
                  <th className="table-th">Last Run</th>
                  <th className="table-th">Status</th>
                  <th className="table-th w-12" />
                </tr>
              </thead>
              <tbody>
                {scheduleList.map(s => (
                  <ScheduleRow
                    key={s.id}
                    schedule={s}
                    onDelete={id => deleteMut.mutate(id)}
                    onToggle={(id, enabled) => toggleMut.mutate({ id, enabled })}
                  />
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </Layout>
  );
}
