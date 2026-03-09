/**
 * DashboardStats — Summary cards showing key metrics
 */
import React from 'react';
import { useQuery } from '@tanstack/react-query';
import { executionApi, testPlanApi, scheduleApi } from '../../services/api';

export default function DashboardStats() {
  const { data: executions } = useQuery({
    queryKey: ['executions', { limit: 100 }],
    queryFn: () => executionApi.list({ page: 1 }),
    refetchInterval: 10000,
  });

  const { data: tests } = useQuery({
    queryKey: ['testPlans'],
    queryFn: () => testPlanApi.list({ limit: 1 }),
  });

  const running = executions?.data?.filter(
    (e) => ['RUNNING', 'PROVISIONING'].includes(e.status)
  ).length || 0;

  const completed = executions?.data?.filter((e) => e.status === 'COMPLETED').length || 0;
  const failed = executions?.data?.filter((e) => e.status === 'FAILED').length || 0;

  const stats = [
    { label: 'Active Tests', value: running, color: 'bg-blue-500' },
    { label: 'Total Test Plans', value: tests?.total || 0, color: 'bg-indigo-500' },
    { label: 'Completed', value: completed, color: 'bg-green-500' },
    { label: 'Failed', value: failed, color: 'bg-red-500' },
  ];

  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
      {stats.map((stat) => (
        <div key={stat.label} className="bg-white rounded-lg shadow p-6">
          <div className="flex items-center">
            <div className={`w-3 h-3 rounded-full ${stat.color} mr-3`} />
            <p className="text-sm font-medium text-gray-500">{stat.label}</p>
          </div>
          <p className="mt-2 text-3xl font-bold text-gray-900">{stat.value}</p>
        </div>
      ))}
    </div>
  );
}
