/**
 * ActiveTests — Shows currently running test executions with live status
 */
import React from 'react';
import { useQuery } from '@tanstack/react-query';
import { executionApi } from '../../services/api';
import StatusBadge from '../common/StatusBadge';

export default function ActiveTests() {
  const { data, isLoading } = useQuery({
    queryKey: ['activeExecutions'],
    queryFn: () => executionApi.list({ status: 'RUNNING' }),
    refetchInterval: 5000,  // Poll every 5s for live updates
  });

  const activeTests = data?.data || [];

  return (
    <div className="bg-white rounded-lg shadow">
      <div className="px-6 py-4 border-b border-gray-200">
        <h2 className="text-lg font-semibold text-gray-900">Active Tests</h2>
      </div>

      <div className="p-6">
        {isLoading ? (
          <p className="text-gray-500">Loading...</p>
        ) : activeTests.length === 0 ? (
          <p className="text-gray-500 text-center py-8">No tests currently running</p>
        ) : (
          <div className="space-y-4">
            {activeTests.map((exec) => (
              <div
                key={exec.id}
                className="flex items-center justify-between p-4 bg-gray-50 rounded-lg"
              >
                <div>
                  <p className="font-medium text-gray-900">{exec.test_plan_name}</p>
                  <p className="text-sm text-gray-500">
                    {exec.worker_count} workers | Started{' '}
                    {exec.started_at ? new Date(exec.started_at).toLocaleTimeString() : 'pending'}
                  </p>
                </div>
                <div className="flex items-center gap-3">
                  <StatusBadge status={exec.status} />
                  <button
                    onClick={() => executionApi.stop(exec.id)}
                    className="px-3 py-1 text-sm bg-red-100 text-red-700 rounded hover:bg-red-200"
                  >
                    Stop
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
