/**
 * Reports Page — View and compare test execution reports
 */
import React, { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import Layout from '../components/common/Layout';
import StatusBadge from '../components/common/StatusBadge';
import { executionApi, reportApi } from '../services/api';
import type { ExecutionStatus } from '../types';

export default function ReportsPage() {
  const [selectedIds, setSelectedIds] = useState<number[]>([]);

  const { data, isLoading } = useQuery({
    queryKey: ['executions-completed'],
    queryFn: () => executionApi.list({ status: 'COMPLETED' }),
  });

  const toggleSelect = (id: number) => {
    setSelectedIds(prev =>
      prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id]
    );
  };

  return (
    <Layout>
      <div className="space-y-6">
        <div className="flex items-center justify-between">
          <h1 className="text-2xl font-bold text-gray-900">Reports</h1>
          {selectedIds.length >= 2 && (
            <a
              href={`/api/v1/executions/compare?ids=${selectedIds.join(',')}`}
              target="_blank"
              rel="noopener noreferrer"
              className="px-4 py-2 bg-indigo-600 text-white text-sm font-medium rounded-md hover:bg-indigo-700"
            >
              Compare {selectedIds.length} Executions
            </a>
          )}
        </div>

        {selectedIds.length > 0 && selectedIds.length < 2 && (
          <p className="text-sm text-gray-500">
            Select at least 2 completed executions to compare.
          </p>
        )}

        <div className="bg-white rounded-lg border border-gray-200 overflow-hidden">
          {isLoading ? (
            <div className="p-8 text-center text-gray-500">Loading reports...</div>
          ) : !data?.data?.length ? (
            <div className="p-8 text-center text-gray-500">
              No completed executions yet. Run a test to generate reports.
            </div>
          ) : (
            <table className="w-full text-sm">
              <thead className="bg-gray-50 border-b border-gray-200">
                <tr>
                  <th className="px-4 py-3 w-8">
                    <span className="sr-only">Select</span>
                  </th>
                  <th className="px-4 py-3 text-left font-semibold text-gray-600 uppercase text-xs tracking-wider">ID</th>
                  <th className="px-4 py-3 text-left font-semibold text-gray-600 uppercase text-xs tracking-wider">Test Plan</th>
                  <th className="px-4 py-3 text-left font-semibold text-gray-600 uppercase text-xs tracking-wider">Status</th>
                  <th className="px-4 py-3 text-left font-semibold text-gray-600 uppercase text-xs tracking-wider">Workers</th>
                  <th className="px-4 py-3 text-left font-semibold text-gray-600 uppercase text-xs tracking-wider">Finished</th>
                  <th className="px-4 py-3 text-left font-semibold text-gray-600 uppercase text-xs tracking-wider">Avg RT (ms)</th>
                  <th className="px-4 py-3 text-left font-semibold text-gray-600 uppercase text-xs tracking-wider">Error %</th>
                  <th className="px-4 py-3 text-left font-semibold text-gray-600 uppercase text-xs tracking-wider">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {data.data.map((exec) => (
                  <tr
                    key={exec.id}
                    className={`hover:bg-gray-50 ${selectedIds.includes(exec.id) ? 'bg-indigo-50' : ''}`}
                  >
                    <td className="px-4 py-3">
                      <input
                        type="checkbox"
                        checked={selectedIds.includes(exec.id)}
                        onChange={() => toggleSelect(exec.id)}
                        className="rounded border-gray-300 text-indigo-600 focus:ring-indigo-500"
                      />
                    </td>
                    <td className="px-4 py-3 font-mono text-xs text-gray-500">#{exec.id}</td>
                    <td className="px-4 py-3 font-medium text-gray-900">{exec.test_plan_name}</td>
                    <td className="px-4 py-3">
                      <StatusBadge status={exec.status as ExecutionStatus} />
                    </td>
                    <td className="px-4 py-3 text-gray-600">{exec.worker_count}</td>
                    <td className="px-4 py-3 text-gray-500">
                      {exec.finished_at ? new Date(exec.finished_at).toLocaleString() : '-'}
                    </td>
                    <td className="px-4 py-3 text-gray-600">
                      {exec.summary?.avgResponseTime?.toFixed(0) ?? '-'}
                    </td>
                    <td className="px-4 py-3">
                      {exec.summary?.errorRate !== undefined ? (
                        <span className={exec.summary.errorRate > 1 ? 'text-red-600 font-medium' : 'text-gray-600'}>
                          {(exec.summary.errorRate * 100).toFixed(2)}%
                        </span>
                      ) : '-'}
                    </td>
                    <td className="px-4 py-3">
                      {exec.report_path ? (
                        <a
                          href={reportApi.getHtmlUrl(exec.id)}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-blue-600 hover:text-blue-800 text-xs font-medium"
                        >
                          View HTML Report →
                        </a>
                      ) : (
                        <span className="text-gray-400 text-xs">No report</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>
    </Layout>
  );
}
