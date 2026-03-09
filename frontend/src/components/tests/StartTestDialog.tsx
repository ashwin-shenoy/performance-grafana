/**
 * StartTestDialog — Configure and launch a test execution
 */
import React, { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { executionApi } from '../../services/api';
import type { TestPlan } from '../../types';

interface StartTestDialogProps {
  testPlan: TestPlan;
  onClose: () => void;
}

export default function StartTestDialog({ testPlan, onClose }: StartTestDialogProps) {
  const planConfig = typeof testPlan.config === 'string'
    ? JSON.parse(testPlan.config)
    : testPlan.config || {};

  const [workerCount, setWorkerCount] = useState(3);
  const [params, setParams] = useState<Record<string, string>>({
    host: planConfig.host || '',
    port: planConfig.port || '443',
    protocol: planConfig.protocol || 'https',
    threads: planConfig.threads || '10',
    duration: planConfig.duration || '60',
    rampup: planConfig.rampup || '10',
  });

  const queryClient = useQueryClient();
  const startMutation = useMutation({
    mutationFn: () => executionApi.start({
      testPlanId: testPlan.id,
      workerCount,
      parameters: params,
    }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['executions'] });
      queryClient.invalidateQueries({ queryKey: ['activeExecutions'] });
      onClose();
    },
  });

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
      <div className="bg-white rounded-lg shadow-xl w-full max-w-lg p-6">
        <h3 className="text-lg font-semibold mb-4">Start Test: {testPlan.name}</h3>

        {/* Worker Count */}
        <div className="mb-4">
          <label className="block text-sm font-medium text-gray-700 mb-1">
            Number of Workers
          </label>
          <input
            type="range"
            min="1"
            max="50"
            value={workerCount}
            onChange={(e) => setWorkerCount(parseInt(e.target.value, 10))}
            className="w-full"
          />
          <div className="flex justify-between text-sm text-gray-500">
            <span>1</span>
            <span className="font-bold text-blue-600">{workerCount} workers</span>
            <span>50</span>
          </div>
        </div>

        {/* Parameters */}
        <div className="mb-6">
          <h4 className="text-sm font-medium text-gray-700 mb-2">Test Parameters</h4>
          <div className="grid grid-cols-2 gap-3">
            {Object.entries(params).map(([key, value]) => (
              <div key={key}>
                <label className="block text-xs text-gray-500 mb-1">
                  {key.charAt(0).toUpperCase() + key.slice(1)}
                </label>
                <input
                  type="text"
                  value={value}
                  onChange={(e) => setParams({ ...params, [key]: e.target.value })}
                  className="w-full px-2 py-1.5 text-sm border border-gray-300 rounded"
                />
              </div>
            ))}
          </div>
        </div>

        {/* Actions */}
        <div className="flex justify-end gap-3">
          <button
            onClick={onClose}
            className="px-4 py-2 text-sm text-gray-700 bg-gray-100 rounded-md hover:bg-gray-200"
          >
            Cancel
          </button>
          <button
            onClick={() => startMutation.mutate()}
            disabled={startMutation.isPending}
            className="px-4 py-2 text-sm text-white bg-green-600 rounded-md hover:bg-green-700
              disabled:bg-gray-300"
          >
            {startMutation.isPending ? 'Starting...' : `Start with ${workerCount} Workers`}
          </button>
        </div>

        {startMutation.isError && (
          <p className="mt-3 text-sm text-red-600">
            Error: {(startMutation.error as Error).message}
          </p>
        )}
      </div>
    </div>
  );
}
