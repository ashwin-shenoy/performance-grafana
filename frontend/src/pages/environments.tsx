/**
 * Environments Page — Manage target test environments (dev, staging, prod)
 */
import React, { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import Layout from '../components/common/Layout';
import { environmentApi } from '../services/api';

export default function EnvironmentsPage() {
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState({
    name: '',
    description: '',
    base_url: '',
    namespace: 'perf-testing',
  });

  const queryClient = useQueryClient();

  const { data: environments, isLoading } = useQuery({
    queryKey: ['environments'],
    queryFn: () => environmentApi.list(),
  });

  const createMutation = useMutation({
    mutationFn: () => environmentApi.create(form),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['environments'] });
      setShowForm(false);
      setForm({ name: '', description: '', base_url: '', namespace: 'perf-testing' });
    },
  });

  return (
    <Layout>
      <div className="space-y-6">
        {/* Header */}
        <div className="flex items-center justify-between">
          <h1 className="text-2xl font-bold text-gray-900">Environments</h1>
          <button
            onClick={() => setShowForm(!showForm)}
            className="px-4 py-2 bg-blue-600 text-white text-sm font-medium rounded-md hover:bg-blue-700"
          >
            {showForm ? 'Cancel' : '+ New Environment'}
          </button>
        </div>

        {/* Create Form */}
        {showForm && (
          <div className="bg-white rounded-lg border border-gray-200 p-6 space-y-4">
            <h3 className="text-lg font-semibold">Create Environment</h3>

            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Name</label>
                <input
                  type="text"
                  value={form.name}
                  onChange={(e) => setForm({ ...form, name: e.target.value })}
                  placeholder="e.g., staging"
                  className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm focus:ring-blue-500 focus:border-blue-500"
                  required
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Base URL</label>
                <input
                  type="url"
                  value={form.base_url}
                  onChange={(e) => setForm({ ...form, base_url: e.target.value })}
                  placeholder="https://staging.example.com"
                  className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm focus:ring-blue-500 focus:border-blue-500"
                  required
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Description</label>
                <input
                  type="text"
                  value={form.description}
                  onChange={(e) => setForm({ ...form, description: e.target.value })}
                  placeholder="Brief description"
                  className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm focus:ring-blue-500 focus:border-blue-500"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">K8s Namespace</label>
                <input
                  type="text"
                  value={form.namespace}
                  onChange={(e) => setForm({ ...form, namespace: e.target.value })}
                  placeholder="perf-testing"
                  className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm font-mono focus:ring-blue-500 focus:border-blue-500"
                />
              </div>
            </div>

            <div className="flex justify-end gap-3">
              <button
                onClick={() => setShowForm(false)}
                className="px-4 py-2 text-sm text-gray-700 bg-gray-100 rounded-md hover:bg-gray-200"
              >
                Cancel
              </button>
              <button
                onClick={() => createMutation.mutate()}
                disabled={!form.name || !form.base_url || createMutation.isPending}
                className="px-4 py-2 text-sm text-white bg-blue-600 rounded-md hover:bg-blue-700 disabled:bg-gray-300"
              >
                {createMutation.isPending ? 'Creating...' : 'Create Environment'}
              </button>
            </div>
          </div>
        )}

        {/* Environments Grid */}
        {isLoading ? (
          <div className="p-8 text-center text-gray-500">Loading environments...</div>
        ) : !environments?.length ? (
          <div className="bg-white rounded-lg border border-gray-200 p-8 text-center text-gray-500">
            No environments configured. Create one to associate tests with target systems.
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {environments.map((env) => (
              <div key={env.id} className="bg-white rounded-lg border border-gray-200 p-6">
                <div className="flex items-start justify-between">
                  <div>
                    <h3 className="text-base font-semibold text-gray-900 capitalize">{env.name}</h3>
                    {env.description && (
                      <p className="text-sm text-gray-500 mt-0.5">{env.description}</p>
                    )}
                  </div>
                  <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-blue-100 text-blue-700">
                    #{env.id}
                  </span>
                </div>
                <div className="mt-4 space-y-2 text-sm">
                  <div className="flex items-center gap-2">
                    <span className="text-gray-400 w-20 shrink-0">URL</span>
                    <a
                      href={env.base_url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-blue-600 hover:text-blue-800 truncate"
                    >
                      {env.base_url}
                    </a>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="text-gray-400 w-20 shrink-0">Namespace</span>
                    <code className="text-xs bg-gray-100 px-1.5 py-0.5 rounded">{env.namespace}</code>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="text-gray-400 w-20 shrink-0">Created</span>
                    <span className="text-gray-600">{new Date(env.created_at).toLocaleDateString()}</span>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </Layout>
  );
}
