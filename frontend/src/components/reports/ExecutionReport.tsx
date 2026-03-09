/**
 * ExecutionReport — Detailed view of a test execution with results
 */
import React from 'react';
import { useQuery } from '@tanstack/react-query';
import { executionApi, reportApi } from '../../services/api';
import StatusBadge from '../common/StatusBadge';
import ResponseTimeChart from './ResponseTimeChart';
import type { TestExecution } from '../../types';

interface ExecutionReportProps {
  executionId: number;
}

export default function ExecutionReport({ executionId }: ExecutionReportProps) {
  const { data: execution, isLoading } = useQuery({
    queryKey: ['execution', executionId],
    queryFn: () => executionApi.get(executionId),
    refetchInterval: (query) => {
      const status = query.state.data?.status;
      return ['RUNNING', 'PROVISIONING', 'PENDING'].includes(status || '') ? 5000 : false;
    },
  });

  if (isLoading || !execution) return <p className="text-gray-500">Loading...</p>;

  const summary = typeof execution.summary === 'string'
    ? JSON.parse(execution.summary)
    : execution.summary;

  const duration = execution.started_at && execution.finished_at
    ? Math.round((new Date(execution.finished_at).getTime() - new Date(execution.started_at).getTime()) / 1000)
    : null;

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="bg-white rounded-lg shadow p-6">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-xl font-bold text-gray-900">
              {execution.test_plan_name || `Execution #${execution.id}`}
            </h2>
            <p className="text-sm text-gray-500 mt-1">
              Triggered by {execution.triggered_by} | {execution.worker_count} workers
              {duration ? ` | ${duration}s duration` : ''}
            </p>
          </div>
          <StatusBadge status={execution.status} />
        </div>

        {/* Pod Status (live) */}
        {execution.pods && execution.pods.length > 0 && (
          <div className="mt-4">
            <h4 className="text-sm font-medium text-gray-700 mb-2">Pod Status</h4>
            <div className="flex flex-wrap gap-2">
              {execution.pods.map((pod) => (
                <span
                  key={pod.name}
                  className={`px-2 py-1 text-xs rounded ${
                    pod.ready ? 'bg-green-100 text-green-700' : 'bg-yellow-100 text-yellow-700'
                  }`}
                >
                  {pod.name.split('-').slice(-1)} ({pod.phase})
                </span>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* Summary Stats */}
      {summary && Object.keys(summary).length > 0 && (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          {[
            { label: 'Total Requests', value: summary.totalRequests?.toLocaleString() },
            { label: 'Error Rate', value: summary.errorRate ? `${summary.errorRate.toFixed(2)}%` : 'N/A' },
            { label: 'Avg Response', value: summary.avgResponseTime ? `${summary.avgResponseTime}ms` : 'N/A' },
            { label: 'P95 Response', value: summary.p95ResponseTime ? `${summary.p95ResponseTime}ms` : 'N/A' },
            { label: 'P99 Response', value: summary.p99ResponseTime ? `${summary.p99ResponseTime}ms` : 'N/A' },
            { label: 'Throughput', value: summary.throughput ? `${summary.throughput} req/s` : 'N/A' },
          ].map((stat) => (
            <div key={stat.label} className="bg-white rounded-lg shadow p-4">
              <p className="text-sm text-gray-500">{stat.label}</p>
              <p className="text-2xl font-bold text-gray-900 mt-1">{stat.value || '--'}</p>
            </div>
          ))}
        </div>
      )}

      {/* Charts */}
      {execution.status === 'COMPLETED' && (
        <ResponseTimeChart executionId={executionId} />
      )}

      {/* Actions */}
      {execution.status === 'COMPLETED' && execution.report_path && (
        <div className="bg-white rounded-lg shadow p-6">
          <h3 className="text-lg font-semibold mb-4">Reports</h3>
          <div className="flex gap-4">
            <a
              href={reportApi.getHtmlUrl(executionId)}
              target="_blank"
              rel="noopener noreferrer"
              className="px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700"
            >
              View HTML Report
            </a>
          </div>
        </div>
      )}

      {execution.error_message && (
        <div className="bg-red-50 border border-red-200 rounded-lg p-4">
          <h4 className="text-sm font-medium text-red-800">Error</h4>
          <p className="text-sm text-red-700 mt-1">{execution.error_message}</p>
        </div>
      )}
    </div>
  );
}
