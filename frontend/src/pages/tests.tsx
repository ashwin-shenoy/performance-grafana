/**
 * Test Plans Page — Browse, upload, and manage JMeter test plans
 */
import React, { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import Layout from '../components/common/Layout';
import TestUploadForm from '../components/tests/TestUploadForm';
import StartTestDialog from '../components/tests/StartTestDialog';
import { testPlanApi } from '../services/api';
import type { TestPlan } from '../types';

export default function TestsPage() {
  const [showUpload, setShowUpload] = useState(false);
  const [selectedPlan, setSelectedPlan] = useState<TestPlan | null>(null);
  const [search, setSearch] = useState('');

  const queryClient = useQueryClient();
  const { data, isLoading, error } = useQuery({
    queryKey: ['testPlans', search],
    queryFn: () => testPlanApi.list({ search }),
  });

  const deleteMutation = useMutation({
    mutationFn: (id: number) => testPlanApi.delete(id),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['testPlans'] }),
  });

  return (
    <Layout>
      <div className="space-y-6">
        {/* Header */}
        <div className="flex items-center justify-between">
          <h1 className="text-2xl font-bold text-gray-900">Test Plans</h1>
          <button
            onClick={() => setShowUpload(!showUpload)}
            className="px-4 py-2 bg-blue-600 text-white text-sm font-medium rounded-md hover:bg-blue-700"
          >
            {showUpload ? 'Cancel' : '+ Upload Test Plan'}
          </button>
        </div>

        {/* Upload Form */}
        {showUpload && (
          <TestUploadForm onSuccess={() => setShowUpload(false)} />
        )}

        {/* Search */}
        <div>
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search test plans..."
            className="w-full max-w-md px-3 py-2 border border-gray-300 rounded-md shadow-sm
              focus:ring-blue-500 focus:border-blue-500 text-sm"
          />
        </div>

        {/* Test Plans Table */}
        <div className="bg-white rounded-lg border border-gray-200 overflow-hidden">
          {isLoading ? (
            <div className="p-8 text-center text-gray-500">Loading test plans...</div>
          ) : error ? (
            <div className="p-8 text-center text-red-600">
              Error loading test plans. Is the API running?
            </div>
          ) : !data?.data?.length ? (
            <div className="p-8 text-center text-gray-500">
              No test plans yet. Upload a JMX file to get started.
            </div>
          ) : (
            <table className="w-full text-sm">
              <thead className="bg-gray-50 border-b border-gray-200">
                <tr>
                  <th className="px-4 py-3 text-left font-semibold text-gray-600 uppercase text-xs tracking-wider">Name</th>
                  <th className="px-4 py-3 text-left font-semibold text-gray-600 uppercase text-xs tracking-wider">File</th>
                  <th className="px-4 py-3 text-left font-semibold text-gray-600 uppercase text-xs tracking-wider">Created By</th>
                  <th className="px-4 py-3 text-left font-semibold text-gray-600 uppercase text-xs tracking-wider">Created</th>
                  <th className="px-4 py-3 text-left font-semibold text-gray-600 uppercase text-xs tracking-wider">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {data.data.map((plan) => (
                  <tr key={plan.id} className="hover:bg-gray-50">
                    <td className="px-4 py-3">
                      <div className="font-medium text-gray-900">{plan.name}</div>
                      {plan.description && (
                        <div className="text-xs text-gray-500 mt-0.5">{plan.description}</div>
                      )}
                    </td>
                    <td className="px-4 py-3 font-mono text-xs text-gray-600">{plan.jmx_file_name}</td>
                    <td className="px-4 py-3 text-gray-600">{plan.created_by || 'system'}</td>
                    <td className="px-4 py-3 text-gray-500">
                      {new Date(plan.created_at).toLocaleDateString()}
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-3">
                        <button
                          onClick={() => setSelectedPlan(plan)}
                          className="text-green-600 hover:text-green-800 text-xs font-medium"
                        >
                          ▶ Run
                        </button>
                        <button
                          onClick={() => {
                            if (confirm(`Delete "${plan.name}"?`)) {
                              deleteMutation.mutate(plan.id);
                            }
                          }}
                          className="text-red-600 hover:text-red-800 text-xs font-medium"
                        >
                          Delete
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>

        {/* Pagination info */}
        {data && (
          <p className="text-sm text-gray-500">
            Showing {data.data.length} of {data.total} test plans
          </p>
        )}
      </div>

      {/* Start Test Dialog */}
      {selectedPlan && (
        <StartTestDialog
          testPlan={selectedPlan}
          onClose={() => setSelectedPlan(null)}
        />
      )}
    </Layout>
  );
}
