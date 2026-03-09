/**
 * Workloads Page — Browse, search, and manage JMeter test workloads
 */
import React, { useState, useRef } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  Search, Upload, Plus, Eye, Pencil, CalendarClock,
  Play, Trash2, ChevronLeft, ChevronRight, Layers,
  RefreshCw, Filter, MoreHorizontal, BarChart2, ExternalLink, CheckCircle2,
} from 'lucide-react';
import { format, parseISO } from 'date-fns';
import { useRouter } from 'next/router';
import Layout from '../components/common/Layout';
import { workloadApi, executionApi, testPlanApi } from '../services/api';
import type { Workload, WorkloadType } from '../types';

// ── Workload type badge ────────────────────────────────────────────────────
const TYPE_COLORS: Record<string, string> = {
  HTTP:          'bg-sky-50 text-sky-700 border-sky-200',
  HTTPS:         'bg-sky-50 text-sky-700 border-sky-200',
  REST:          'bg-violet-50 text-violet-700 border-violet-200',
  SOAP:          'bg-orange-50 text-orange-700 border-orange-200',
  DATABASE:      'bg-amber-50 text-amber-700 border-amber-200',
  MESSAGE_QUEUE: 'bg-pink-50 text-pink-700 border-pink-200',
  WEBSOCKET:     'bg-teal-50 text-teal-700 border-teal-200',
  MIXED:         'bg-slate-100 text-slate-700 border-slate-200',
};

function TypeBadge({ type }: { type: string }) {
  const cls = TYPE_COLORS[type] || TYPE_COLORS.MIXED;
  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-semibold border ${cls}`}>
      {type}
    </span>
  );
}

// ── Upload JMX Modal ───────────────────────────────────────────────────────
function UploadModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const qc = useQueryClient();
  const fileRef = useRef<HTMLInputElement>(null);
  const [name, setName]           = useState('');
  const [desc, setDesc]           = useState('');
  const [type, setType]           = useState<WorkloadType>('HTTP');
  const [business, setBusiness]   = useState('');
  const [channel, setChannel]     = useState('Web');
  const [fileName, setFileName]   = useState('');

  const [uploadError, setUploadError] = useState('');

  const uploadMut = useMutation({
    mutationFn: () => {
      setUploadError('');
      const fd = new FormData();
      fd.append('name', name);
      fd.append('description', desc);
      fd.append('createdBy', 'admin');
      // Field name must match backend Multer config: upload.single('jmxFile')
      if (fileRef.current?.files?.[0]) fd.append('jmxFile', fileRef.current.files[0]);
      fd.append('config', JSON.stringify({ type, business, channel }));
      return testPlanApi.upload(fd);
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['workloads'] });
      onClose();
    },
    onError: (err: any) => {
      const msg = err?.response?.data?.error?.message
        ?? err?.response?.data?.message
        ?? err?.message
        ?? 'Upload failed';
      setUploadError(msg);
    },
  });

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div className="absolute inset-0 bg-slate-900/50" onClick={() => { setUploadError(''); onClose(); }} />
      <div className="relative w-full max-w-lg mx-4 bg-white border border-slate-200 p-6" style={{ boxShadow: '0 4px 16px rgba(0,0,0,0.25)' }}>
        <h2 className="text-lg font-bold text-slate-900 mb-1">Upload Workload</h2>
        <p className="text-sm text-slate-500 mb-5">Upload a JMX test plan to register a new workload.</p>

        <div className="space-y-4">
          {/* JMX file */}
          <div>
            <label className="label">JMX Script File *</label>
            <div
              className="border-2 border-dashed border-slate-300 p-6 text-center cursor-pointer hover:border-[#0f62fe] hover:bg-[#edf5ff] transition-colors"
              onClick={() => fileRef.current?.click()}
            >
              <Upload className="w-6 h-6 text-slate-400 mx-auto mb-2" />
              {fileName
                ? <p className="text-sm font-medium text-slate-700">{fileName}</p>
                : <p className="text-sm text-slate-500">Click to select .jmx file</p>
              }
              <input
                ref={fileRef}
                type="file"
                accept=".jmx"
                className="hidden"
                onChange={e => setFileName(e.target.files?.[0]?.name || '')}
              />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div className="col-span-2">
              <label className="label">Workload Name *</label>
              <input className="input" value={name} onChange={e => setName(e.target.value)} placeholder="e.g. Checkout Flow" />
            </div>
            <div>
              <label className="label">Type</label>
              <select className="select" value={type} onChange={e => setType(e.target.value as WorkloadType)}>
                {['HTTP','HTTPS','REST','SOAP','DATABASE','MESSAGE_QUEUE','WEBSOCKET','MIXED'].map(t => (
                  <option key={t}>{t}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="label">Channel</label>
              <select className="select" value={channel} onChange={e => setChannel(e.target.value)}>
                {['Web','Mobile','API','Batch','Internal'].map(c => (
                  <option key={c}>{c}</option>
                ))}
              </select>
            </div>
            <div className="col-span-2">
              <label className="label">Business Unit</label>
              <input className="input" value={business} onChange={e => setBusiness(e.target.value)} placeholder="e.g. E-Commerce" />
            </div>
            <div className="col-span-2">
              <label className="label">Description</label>
              <textarea
                className="input resize-none"
                rows={2}
                value={desc}
                onChange={e => setDesc(e.target.value)}
                placeholder="Brief description of what this workload tests…"
              />
            </div>
          </div>
        </div>

        {uploadError && (
          <div className="mt-4 px-4 py-3 text-sm" style={{ background: '#fff1f1', border: '1px solid #ff8389', color: '#a2191f' }}>
            {uploadError}
          </div>
        )}

        <div className="flex gap-3 mt-4">
          <button className="btn-secondary flex-1" onClick={onClose}>Cancel</button>
          <button
            className="btn-primary flex-1"
            onClick={() => uploadMut.mutate()}
            disabled={!name || !fileName || uploadMut.isPending}
          >
            <Upload className="w-4 h-4" />
            {uploadMut.isPending ? 'Uploading…' : 'Upload Workload'}
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Run Workload Dialog ────────────────────────────────────────────────────
function RunDialog({
  workload,
  onClose,
}: {
  workload: Workload | null;
  onClose: () => void;
}) {
  const qc = useQueryClient();
  const [workers, setWorkers]           = useState(String(workload?.config.injectors ?? 1));
  const [startedExec, setStartedExec]   = useState<any>(null);

  const runMut = useMutation({
    mutationFn: () =>
      executionApi.start({
        testPlanId:  workload!.id,
        workerCount: Number(workers),
      }),
    onSuccess: (exec) => {
      qc.invalidateQueries({ queryKey: ['executions'] });
      setStartedExec(exec);   // keep dialog open — show Grafana link
    },
  });

  if (!workload) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div className="absolute inset-0 bg-slate-900/50" onClick={onClose} />
      <div className="relative w-full max-w-sm mx-4 bg-white border border-slate-200 p-6" style={{ boxShadow: '0 4px 16px rgba(0,0,0,0.25)' }}>

        {startedExec ? (
          /* ── Success state: show run ID + Grafana link ── */
          <>
            <div className="flex items-center gap-2 mb-4">
              <CheckCircle2 className="w-5 h-5 flex-shrink-0" style={{ color: '#24a148' }} />
              <div>
                <p className="text-sm font-semibold text-slate-900">Test started — Run #{startedExec.id}</p>
                <p className="text-xs text-slate-500 mt-0.5">{workload.name}</p>
              </div>
            </div>

            {startedExec.grafana_url && (
              <a
                href={startedExec.grafana_url}
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-center justify-center gap-2 w-full px-4 py-3 mb-4 text-sm font-semibold"
                style={{
                  background: '#fff3e8',
                  border: '1px solid #e8590c',
                  color: '#e8590c',
                }}
              >
                <BarChart2 className="w-4 h-4" />
                View Live Metrics in Grafana
                <ExternalLink className="w-3.5 h-3.5 ml-auto" />
              </a>
            )}

            <p className="text-xs text-slate-400 mb-4">
              Metrics are pushed live to Grafana via InfluxDB. The dashboard opens
              scoped to this run's time window.
            </p>

            <button className="btn-secondary w-full" onClick={onClose}>Close</button>
          </>
        ) : (
          /* ── Default state: configure + launch ── */
          <>
            <h2 className="text-base font-bold text-slate-900 mb-1">Run Workload</h2>
            <p className="text-sm text-slate-500 mb-4">
              <span className="font-medium text-slate-700">{workload.name}</span>
            </p>
            <label className="label">Worker Pods</label>
            <input
              type="number" min={1} max={20}
              className="input mb-4"
              value={workers}
              onChange={e => setWorkers(e.target.value)}
            />
            <div className="flex gap-3">
              <button className="btn-secondary flex-1" onClick={onClose}>Cancel</button>
              <button
                className="btn-primary flex-1"
                onClick={() => runMut.mutate()}
                disabled={runMut.isPending}
              >
                <Play className="w-4 h-4" />
                {runMut.isPending ? 'Starting…' : 'Run Now'}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

// ── Main Workloads Page ────────────────────────────────────────────────────
const PAGE_SIZE = 10;

export default function WorkloadsPage() {
  const router = useRouter();
  const qc = useQueryClient();
  const [search, setSearch]     = useState('');
  const [page, setPage]         = useState(1);
  const [uploadOpen, setUploadOpen] = useState(false);
  const [runTarget, setRunTarget]   = useState<Workload | null>(null);

  const { data, isLoading, refetch } = useQuery({
    queryKey: ['workloads', page, search],
    queryFn:  () => workloadApi.list({ page, limit: PAGE_SIZE, search }),
    placeholderData: (prev) => prev,
  });

  const deleteMut = useMutation({
    mutationFn: (id: number) => workloadApi.delete(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['workloads'] }),
  });

  const workloads = data?.data ?? [];
  const total     = data?.total ?? 0;
  const totalPages = Math.ceil(total / PAGE_SIZE);

  return (
    <Layout>
      <UploadModal open={uploadOpen} onClose={() => setUploadOpen(false)} />
      <RunDialog workload={runTarget} onClose={() => setRunTarget(null)} />

      {/* ── Page header ─────────────────────────────────────── */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-xl font-bold text-slate-900">Workloads</h1>
          <p className="text-sm text-slate-500 mt-0.5">
            {total} workload{total !== 1 ? 's' : ''} registered
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button className="btn-secondary btn-sm" onClick={() => refetch()}>
            <RefreshCw className="w-3.5 h-3.5" />
            Refresh
          </button>
          <button className="btn-primary" onClick={() => setUploadOpen(true)}>
            <Upload className="w-4 h-4" />
            Upload JMX
          </button>
        </div>
      </div>

      {/* ── Search + filters ─────────────────────────────────── */}
      <div className="card mb-5">
        <div className="p-4 flex items-center gap-3">
          <div className="relative flex-1 max-w-sm">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400 pointer-events-none" />
            <input
              type="search"
              placeholder="Search by name, type, or business unit…"
              className="input pl-9"
              value={search}
              onChange={e => { setSearch(e.target.value); setPage(1); }}
            />
          </div>
          <button className="btn-secondary btn-sm gap-1.5">
            <Filter className="w-3.5 h-3.5" />
            Filter
          </button>
        </div>
      </div>

      {/* ── Table ────────────────────────────────────────────── */}
      <div className="card">
        {isLoading ? (
          <div className="flex items-center justify-center py-20 text-slate-400">
            <RefreshCw className="w-5 h-5 animate-spin mr-2" />
            Loading workloads…
          </div>
        ) : workloads.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-20 text-slate-400">
            <Layers className="w-12 h-12 mb-4 opacity-25" />
            <p className="text-sm font-medium text-slate-600">No workloads found</p>
            <p className="text-xs text-slate-400 mt-1 mb-4">Upload a JMX file to register your first workload</p>
            <button className="btn-primary btn-sm" onClick={() => setUploadOpen(true)}>
              <Upload className="w-3.5 h-3.5" />
              Upload JMX
            </button>
          </div>
        ) : (
          <>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="border-b border-slate-200 bg-slate-50">
                  <tr>
                    <th className="table-th">ID</th>
                    <th className="table-th">Name</th>
                    <th className="table-th">Type</th>
                    <th className="table-th">Business Unit</th>
                    <th className="table-th">Channel</th>
                    <th className="table-th">Script</th>
                    <th className="table-th">Created</th>
                    <th className="table-th text-right">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {workloads.map((wl, idx) => (
                    <tr
                      key={wl.id}
                      className={`${idx % 2 === 0 ? 'bg-white' : 'bg-slate-50/40'} hover:bg-blue-50/30 transition-colors`}
                    >
                      <td className="table-td font-mono text-slate-400 text-xs">#{wl.id}</td>
                      <td className="table-td">
                        <button
                          className="font-semibold text-slate-900 hover:text-blue-600 transition-colors text-left"
                          onClick={() => router.push(`/workloads/${wl.id}`)}
                        >
                          {wl.name}
                        </button>
                        {wl.description && (
                          <p className="text-xs text-slate-400 mt-0.5 max-w-[220px] truncate">{wl.description}</p>
                        )}
                      </td>
                      <td className="table-td"><TypeBadge type={wl.type} /></td>
                      <td className="table-td text-slate-600">{wl.business || '—'}</td>
                      <td className="table-td text-slate-600">{wl.channel || '—'}</td>
                      <td className="table-td font-mono text-xs text-slate-500 max-w-[140px] truncate">
                        {wl.jmx_file_name}
                      </td>
                      <td className="table-td text-slate-500 text-xs whitespace-nowrap">
                        {format(parseISO(wl.created_at), 'MMM d, yyyy')}
                      </td>
                      <td className="table-td">
                        <div className="flex items-center justify-end gap-1">
                          <button
                            title="View details"
                            className="btn-icon"
                            onClick={() => router.push(`/workloads/${wl.id}`)}
                          >
                            <Eye className="w-4 h-4" />
                          </button>
                          <button
                            title="Run now"
                            className="btn-icon text-emerald-600 hover:bg-emerald-50"
                            onClick={() => setRunTarget(wl)}
                          >
                            <Play className="w-4 h-4" />
                          </button>
                          <button
                            title="Schedule"
                            className="btn-icon text-amber-600 hover:bg-amber-50"
                            onClick={() => router.push('/schedules')}
                          >
                            <CalendarClock className="w-4 h-4" />
                          </button>
                          <button
                            title="Delete"
                            className="btn-icon text-red-500 hover:bg-red-50"
                            onClick={() => {
                              if (confirm(`Delete workload "${wl.name}"?`)) {
                                deleteMut.mutate(wl.id);
                              }
                            }}
                          >
                            <Trash2 className="w-4 h-4" />
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {/* Pagination */}
            {totalPages > 1 && (
              <div className="flex items-center justify-between px-5 py-3 border-t border-slate-200">
                <p className="text-xs text-slate-500">
                  Showing {(page - 1) * PAGE_SIZE + 1}–{Math.min(page * PAGE_SIZE, total)} of {total} workloads
                </p>
                <div className="flex items-center gap-1">
                  <button
                    className="btn-icon"
                    onClick={() => setPage(p => Math.max(1, p - 1))}
                    disabled={page === 1}
                  >
                    <ChevronLeft className="w-4 h-4" />
                  </button>
                  {Array.from({ length: Math.min(5, totalPages) }, (_, i) => {
                    const p = i + 1;
                    return (
                      <button
                        key={p}
                        onClick={() => setPage(p)}
                        className={`w-7 h-7 rounded text-xs font-medium transition-colors ${
                          p === page
                            ? 'bg-blue-600 text-white'
                            : 'text-slate-600 hover:bg-slate-100'
                        }`}
                      >
                        {p}
                      </button>
                    );
                  })}
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
