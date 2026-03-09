/**
 * TestUploadForm — Upload .jmx files and configure test parameters
 */
import React, { useState, useCallback } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { testPlanApi } from '../../services/api';

interface TestUploadFormProps {
  onSuccess?: () => void;
}

export default function TestUploadForm({ onSuccess }: TestUploadFormProps) {
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [file, setFile] = useState<File | null>(null);
  const [config, setConfig] = useState({
    host: '',
    port: '443',
    protocol: 'https',
    threads: '10',
    duration: '60',
    rampup: '10',
  });

  const queryClient = useQueryClient();
  const uploadMutation = useMutation({
    mutationFn: (formData: FormData) => testPlanApi.upload(formData),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['testPlans'] });
      setName('');
      setDescription('');
      setFile(null);
      onSuccess?.();
    },
  });

  const handleSubmit = useCallback((e: React.FormEvent) => {
    e.preventDefault();
    if (!file) return;

    const formData = new FormData();
    formData.append('jmxFile', file);
    formData.append('name', name || file.name.replace('.jmx', ''));
    formData.append('description', description);
    formData.append('config', JSON.stringify(config));

    uploadMutation.mutate(formData);
  }, [file, name, description, config, uploadMutation]);

  return (
    <form onSubmit={handleSubmit} className="space-y-6 bg-white p-6 rounded-lg shadow">
      <h3 className="text-lg font-semibold">Upload Test Plan</h3>

      {/* File Upload */}
      <div>
        <label className="block text-sm font-medium text-gray-700 mb-1">JMX File</label>
        <input
          type="file"
          accept=".jmx"
          onChange={(e) => setFile(e.target.files?.[0] || null)}
          className="block w-full text-sm text-gray-500 file:mr-4 file:py-2 file:px-4
            file:rounded file:border-0 file:text-sm file:font-semibold
            file:bg-blue-50 file:text-blue-700 hover:file:bg-blue-100"
          required
        />
      </div>

      {/* Name & Description */}
      <div className="grid grid-cols-2 gap-4">
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">Test Name</label>
          <input
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="e.g., API Load Test"
            className="w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm
              focus:ring-blue-500 focus:border-blue-500"
          />
        </div>
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">Description</label>
          <input
            type="text"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="Brief description"
            className="w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm
              focus:ring-blue-500 focus:border-blue-500"
          />
        </div>
      </div>

      {/* Test Parameters */}
      <div>
        <h4 className="text-sm font-medium text-gray-700 mb-2">Default Parameters</h4>
        <div className="grid grid-cols-3 gap-3">
          {Object.entries(config).map(([key, value]) => (
            <div key={key}>
              <label className="block text-xs font-medium text-gray-500 mb-1">
                {key.charAt(0).toUpperCase() + key.slice(1)}
              </label>
              <input
                type="text"
                value={value}
                onChange={(e) => setConfig({ ...config, [key]: e.target.value })}
                className="w-full px-2 py-1.5 text-sm border border-gray-300 rounded-md"
              />
            </div>
          ))}
        </div>
      </div>

      {/* Submit */}
      <button
        type="submit"
        disabled={!file || uploadMutation.isPending}
        className="w-full py-2.5 px-4 bg-blue-600 text-white rounded-md font-medium
          hover:bg-blue-700 disabled:bg-gray-300 disabled:cursor-not-allowed transition-colors"
      >
        {uploadMutation.isPending ? 'Uploading...' : 'Upload Test Plan'}
      </button>

      {uploadMutation.isError && (
        <p className="text-sm text-red-600">
          Error: {(uploadMutation.error as Error).message}
        </p>
      )}
    </form>
  );
}
