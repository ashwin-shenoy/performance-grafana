/**
 * StatusBadge — Color-coded execution status indicator
 */
import React from 'react';
import { clsx } from 'clsx';
import type { ExecutionStatus } from '../../types';

const statusStyles: Record<ExecutionStatus, string> = {
  PENDING: 'bg-yellow-100 text-yellow-800',
  PROVISIONING: 'bg-blue-100 text-blue-800',
  RUNNING: 'bg-green-100 text-green-800 animate-pulse',
  COMPLETED: 'bg-green-100 text-green-800',
  FAILED: 'bg-red-100 text-red-800',
  STOPPED: 'bg-gray-100 text-gray-800',
};

interface StatusBadgeProps {
  status: ExecutionStatus;
}

export default function StatusBadge({ status }: StatusBadgeProps) {
  return (
    <span
      className={clsx(
        'inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium',
        statusStyles[status] || 'bg-gray-100 text-gray-800'
      )}
    >
      {status === 'RUNNING' && (
        <span className="w-2 h-2 bg-green-500 rounded-full mr-1.5" />
      )}
      {status}
    </span>
  );
}
