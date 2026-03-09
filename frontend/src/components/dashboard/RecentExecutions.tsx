/**
 * RecentExecutions — Table of recent test executions with status
 */
import React from 'react';
import Link from 'next/link';
import { useQuery } from '@tanstack/react-query';
import { executionApi } from '../../services/api';
import StatusBadge from '../common/StatusBadge';
import { formatDistanceToNow } from 'date-fns';

export default function RecentExecutions() {
  const { data } = useQuery({
    queryKey: ['recentExecutions'],
    queryFn: () => executionApi.list({ page: 1,  }),
    refetchInterval: 15000,
  });

  const executions = data?.data || [];

  return (
    <div className="bg-white rounded-lg shadow">
      <div className="px-6 py-4 border-b border-gray-200 flex justify-between items-center">
        <h2 className="text-lg font-semibold text-gray-900">Recent Executions</h2>
        <Link href="/executions" className="text-sm text-blue-600 hover:text-blue-800">
          View all
        </Link>
      </div>

      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-gray-50">
            <tr>
              <th className="px-6 py-3 text-left font-medium text-gray-500">Test</th>
              <th className="px-6 py-3 text-left font-medium text-gray-500">Status</th>
              <th className="px-6 py-3 text-left font-medium text-gray-500">Workers</th>
              <th className="px-6 py-3 text-left font-medium text-gray-500">When</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-200">
            {executions.map((exec) => (
              <tr key={exec.id} className="hover:bg-gray-50">
                <td className="px-6 py-4">
                  <Link
                    href={`/executions/${exec.id}`}
                    className="font-medium text-blue-600 hover:text-blue-800"
                  >
                    {exec.test_plan_name || `Execution #${exec.id}`}
                  </Link>
                </td>
                <td className="px-6 py-4">
                  <StatusBadge status={exec.status} />
                </td>
                <td className="px-6 py-4 text-gray-500">{exec.worker_count}</td>
                <td className="px-6 py-4 text-gray-500">
                  {formatDistanceToNow(new Date(exec.created_at), { addSuffix: true })}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
