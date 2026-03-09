/**
 * ResponseTimeChart — Recharts-based response time visualization
 */
import React from 'react';
import {
  LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer,
} from 'recharts';

interface ResponseTimeChartProps {
  executionId: number;
}

// Placeholder data — in production, fetch from InfluxDB/Prometheus via the API
const sampleData = [
  { time: '00:00', avg: 120, p90: 250, p95: 380, p99: 520 },
  { time: '00:30', avg: 135, p90: 280, p95: 410, p99: 580 },
  { time: '01:00', avg: 128, p90: 260, p95: 390, p99: 540 },
  { time: '01:30', avg: 142, p90: 290, p95: 430, p99: 610 },
  { time: '02:00', avg: 138, p90: 275, p95: 415, p99: 590 },
  { time: '02:30', avg: 125, p90: 255, p95: 385, p99: 530 },
  { time: '03:00', avg: 130, p90: 265, p95: 395, p99: 550 },
];

export default function ResponseTimeChart({ executionId }: ResponseTimeChartProps) {
  return (
    <div className="bg-white rounded-lg shadow p-6">
      <h3 className="text-lg font-semibold mb-4">Response Times Over Time</h3>
      <ResponsiveContainer width="100%" height={300}>
        <LineChart data={sampleData}>
          <CartesianGrid strokeDasharray="3 3" />
          <XAxis dataKey="time" />
          <YAxis label={{ value: 'ms', angle: -90, position: 'insideLeft' }} />
          <Tooltip />
          <Legend />
          <Line type="monotone" dataKey="avg" stroke="#3B82F6" name="Average" strokeWidth={2} />
          <Line type="monotone" dataKey="p90" stroke="#10B981" name="P90" />
          <Line type="monotone" dataKey="p95" stroke="#F59E0B" name="P95" />
          <Line type="monotone" dataKey="p99" stroke="#EF4444" name="P99" />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}
