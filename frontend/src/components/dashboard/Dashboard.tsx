/**
 * Dashboard Component
 * Overview with stats cards, active tests, and recent history
 */
import React, { useEffect, useState } from 'react';
import { executionApi } from '../../services/api';
import type { TestExecution, PaginatedResponse } from '../../types';
import StatusBadge from '../common/StatusBadge';

export default function Dashboard() {
  const [activeTests, setActiveTests] = useState<TestExecution[]>([]);
  const [recentTests, setRecentTests] = useState<TestExecution[]>([]);
  const [stats, setStats] = useState({ total: 0, running: 0, completed: 0, failed: 0 });

  useEffect(() => {
    async function load() {
      const [active, recent] = await Promise.all([
        executionApi.list({ status: 'RUNNING',  }),
        executionApi.list({  }),
      ]);
      setActiveTests(active.data);
      setRecentTests(recent.data);
      setStats({
        total: recent.total,
        running: active.total,
        completed: recent.data.filter(e => e.status === 'COMPLETED').length,
        failed: recent.data.filter(e => e.status === 'FAILED').length,
      });
    }
    load();
    const interval = setInterval(load, 10000); // Poll every 10s
    return () => clearInterval(interval);
  }, []);

  return (
    <div className="space-y-8">
      {/* Stats Cards */}
      <div className="grid grid-cols-4 gap-6">
        <StatCard label="Total Executions" value={stats.total} color="blue" />
        <StatCard label="Running Now" value={stats.running} color="green" />
        <StatCard label="Completed" value={stats.completed} color="gray" />
        <StatCard label="Failed" value={stats.failed} color="red" />
      </div>

      {/* Active Tests */}
      {activeTests.length > 0 && (
        <section>
          <h2 className="text-lg font-semibold text-gray-900 mb-4">Active Tests</h2>
          <div className="bg-white rounded-lg border border-gray-200 overflow-hidden">
            <table className="w-full text-sm">
              <thead className="bg-gray-50">
                <tr>
                  <th className="px-4 py-3 text-left font-medium text-gray-600">ID</th>
                  <th className="px-4 py-3 text-left font-medium text-gray-600">Test Plan</th>
                  <th className="px-4 py-3 text-left font-medium text-gray-600">Workers</th>
                  <th className="px-4 py-3 text-left font-medium text-gray-600">Status</th>
                  <th className="px-4 py-3 text-left font-medium text-gray-600">Started</th>
                  <th className="px-4 py-3 text-left font-medium text-gray-600">Actions</th>
                </tr>
              </thead>
              <tbody>
                {activeTests.map(exec => (
                  <tr key={exec.id} className="border-t border-gray-100">
                    <td className="px-4 py-3 font-mono text-xs">{exec.id}</td>
                    <td className="px-4 py-3 font-medium">{exec.test_plan_name}</td>
                    <td className="px-4 py-3">{exec.worker_count}</td>
                    <td className="px-4 py-3"><StatusBadge status={exec.status} /></td>
                    <td className="px-4 py-3 text-gray-500">{exec.started_at ? new Date(exec.started_at).toLocaleString() : '-'}</td>
                    <td className="px-4 py-3">
                      <button
                        onClick={() => executionApi.stop(exec.id)}
                        className="text-red-600 hover:text-red-800 text-xs font-medium"
                      >
                        Stop
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}

      {/* Recent Executions */}
      <section>
        <h2 className="text-lg font-semibold text-gray-900 mb-4">Recent Executions</h2>
        <div className="bg-white rounded-lg border border-gray-200 overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-gray-50">
              <tr>
                <th className="px-4 py-3 text-left font-medium text-gray-600">ID</th>
                <th className="px-4 py-3 text-left font-medium text-gray-600">Test Plan</th>
                <th className="px-4 py-3 text-left font-medium text-gray-600">Status</th>
                <th className="px-4 py-3 text-left font-medium text-gray-600">Workers</th>
                <th className="px-4 py-3 text-left font-medium text-gray-600">Triggered By</th>
                <th className="px-4 py-3 text-left font-medium text-gray-600">Date</th>
              </tr>
            </thead>
            <tbody>
              {recentTests.map(exec => (
                <tr key={exec.id} className="border-t border-gray-100 hover:bg-gray-50 cursor-pointer">
                  <td className="px-4 py-3 font-mono text-xs">{exec.id}</td>
                  <td className="px-4 py-3 font-medium">{exec.test_plan_name}</td>
                  <td className="px-4 py-3"><StatusBadge status={exec.status} /></td>
                  <td className="px-4 py-3">{exec.worker_count}</td>
                  <td className="px-4 py-3 text-gray-500">{exec.triggered_by}</td>
                  <td className="px-4 py-3 text-gray-500">{new Date(exec.created_at).toLocaleString()}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}

function StatCard({ label, value, color }: { label: string; value: number; color: string }) {
  const colorClasses: Record<string, string> = {
    blue: 'bg-blue-50 text-blue-700 border-blue-200',
    green: 'bg-green-50 text-green-700 border-green-200',
    red: 'bg-red-50 text-red-700 border-red-200',
    gray: 'bg-gray-50 text-gray-700 border-gray-200',
  };
  return (
    <div className={`rounded-lg border p-6 ${colorClasses[color]}`}>
      <p className="text-sm font-medium opacity-75">{label}</p>
      <p className="text-3xl font-bold mt-1">{value}</p>
    </div>
  );
}
