/**
 * CompareExecutions — Side-by-side comparison of multiple test runs
 */
import React, { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { executionApi } from '../../services/api';
import StatusBadge from '../common/StatusBadge';
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer,
} from 'recharts';

export default function CompareExecutions() {
  const [selectedIds, setSelectedIds] = useState<number[]>([]);

  const { data: executions } = useQuery({
    queryKey: ['executions-list'],
    queryFn: () => executionApi.list({ status: 'COMPLETED', page: 1 }),
  });

  const { data: comparison } = useQuery({
    queryKey: ['comparison', selectedIds],
    queryFn: () => executionApi.compare(selectedIds),
    enabled: selectedIds.length >= 2,
  });

  const toggleSelection = (id: number) => {
    setSelectedIds((prev) =>
      prev.includes(id) ? prev.filter((i) => i !== id) : [...prev, id]
    );
  };

  const chartData = comparison?.map((exec: any) => ({
    name: `#${exec.id}`,
    avgResponseTime: exec.summary?.avgResponseTime || 0,
    p95ResponseTime: exec.summary?.p95ResponseTime || 0,
    throughput: exec.summary?.throughput || 0,
    errorRate: exec.summary?.errorRate || 0,
  })) || [];

  return (
    <div className="space-y-6">
      {/* Selection */}
      <div className="bg-white rounded-lg shadow p-6">
        <h3 className="text-lg font-semibold mb-4">Select Executions to Compare</h3>
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
          {(executions?.data || []).slice(0, 20).map((exec) => (
            <label
              key={exec.id}
              className={`flex items-center p-3 rounded-lg border-2 cursor-pointer transition-colors ${
                selectedIds.includes(exec.id)
                  ? 'border-blue-500 bg-blue-50'
                  : 'border-gray-200 hover:border-gray-300'
              }`}
            >
              <input
                type="checkbox"
                checked={selectedIds.includes(exec.id)}
                onChange={() => toggleSelection(exec.id)}
                className="mr-3"
              />
              <div>
                <p className="text-sm font-medium">{exec.test_plan_name}</p>
                <p className="text-xs text-gray-500">
                  #{exec.id} | {exec.worker_count}w | {new Date(exec.created_at).toLocaleDateString()}
                </p>
              </div>
            </label>
          ))}
        </div>
      </div>

      {/* Comparison Chart */}
      {chartData.length >= 2 && (
        <div className="bg-white rounded-lg shadow p-6">
          <h3 className="text-lg font-semibold mb-4">Comparison</h3>
          <ResponsiveContainer width="100%" height={300}>
            <BarChart data={chartData}>
              <CartesianGrid strokeDasharray="3 3" />
              <XAxis dataKey="name" />
              <YAxis />
              <Tooltip />
              <Legend />
              <Bar dataKey="avgResponseTime" fill="#3B82F6" name="Avg Response (ms)" />
              <Bar dataKey="p95ResponseTime" fill="#F59E0B" name="P95 Response (ms)" />
              <Bar dataKey="throughput" fill="#10B981" name="Throughput (req/s)" />
            </BarChart>
          </ResponsiveContainer>

          {/* Table Comparison */}
          <table className="w-full mt-6 text-sm">
            <thead className="bg-gray-50">
              <tr>
                <th className="px-4 py-2 text-left">Metric</th>
                {comparison?.map((exec: any) => (
                  <th key={exec.id} className="px-4 py-2 text-center">#{exec.id}</th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y">
              {['avgResponseTime', 'p95ResponseTime', 'p99ResponseTime', 'throughput', 'errorRate'].map((metric) => (
                <tr key={metric}>
                  <td className="px-4 py-2 font-medium">{metric}</td>
                  {comparison?.map((exec: any) => (
                    <td key={exec.id} className="px-4 py-2 text-center">
                      {exec.summary?.[metric] ?? '--'}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
