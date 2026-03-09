/**
 * JTL Parser — Parse JMeter JTL CSV results into aggregated performance metrics
 *
 * JTL CSV columns (standard JMeter format):
 *   timeStamp, elapsed, label, responseCode, responseMessage, threadName,
 *   dataType, success, failureMessage, bytes, sentBytes, grpThreads,
 *   allThreads, URL, Latency, IdleTime, Connect
 */
'use strict';

const fs   = require('fs');
const path = require('path');

/**
 * Parse a JTL file and return aggregated metrics.
 * @param {string} jtlFilePath - Absolute path to the results.jtl file
 * @returns {object} metrics
 */
function parseJtl(jtlFilePath) {
  if (!fs.existsSync(jtlFilePath)) {
    throw new Error(`JTL file not found: ${jtlFilePath}`);
  }

  const content = fs.readFileSync(jtlFilePath, 'utf8');
  const lines   = content.split('\n').filter(Boolean);

  if (lines.length < 2) {
    throw new Error('JTL file is empty or has no data rows');
  }

  // Detect delimiter and parse header
  const header    = lines[0].split(',').map(s => s.trim().toLowerCase());
  const tsIdx     = header.indexOf('timestamp');
  const elIdx     = header.indexOf('elapsed');
  const labelIdx  = header.indexOf('label');
  const successIdx= header.indexOf('success');
  const rcIdx     = header.indexOf('responsecode');

  if (tsIdx === -1 || elIdx === -1) {
    throw new Error('JTL file missing required columns (timeStamp, elapsed)');
  }

  const elapsed   = [];   // all response times
  let errors      = 0;
  let total       = 0;
  let minTs       = Infinity;
  let maxTs       = 0;

  // Per-label breakdown
  const byLabel = {};

  for (let i = 1; i < lines.length; i++) {
    const cols = lines[i].split(',');
    if (cols.length < Math.max(tsIdx, elIdx) + 1) continue;

    const ts      = parseInt(cols[tsIdx], 10);
    const ms      = parseInt(cols[elIdx],  10);
    const success = successIdx !== -1 ? cols[successIdx]?.trim().toLowerCase() !== 'false' : true;
    const label   = labelIdx   !== -1 ? (cols[labelIdx] || 'Unknown').trim() : 'Unknown';

    if (isNaN(ts) || isNaN(ms)) continue;

    total++;
    elapsed.push(ms);
    if (ts < minTs) minTs = ts;
    if (ts > maxTs) maxTs = ts;
    if (!success) errors++;

    if (!byLabel[label]) byLabel[label] = { elapsed: [], errors: 0, total: 0 };
    byLabel[label].elapsed.push(ms);
    byLabel[label].total++;
    if (!success) byLabel[label].errors++;
  }

  if (total === 0) throw new Error('JTL contains no parseable rows');

  elapsed.sort((a, b) => a - b);

  const durationMs   = maxTs - minTs;
  const durationSec  = Math.max(durationMs / 1000, 1);
  const avgRps       = total / durationSec;

  // Compute peak RPS using a 10-second sliding window
  const peakRps = computePeakRps(lines, tsIdx, header, 10_000);

  // Aggregate per-label metrics
  const samplers = Object.entries(byLabel).map(([name, d]) => {
    d.elapsed.sort((a, b) => a - b);
    return {
      name,
      count:       d.total,
      errors:      d.errors,
      errorRate:   d.total > 0 ? parseFloat(((d.errors / d.total) * 100).toFixed(3)) : 0,
      avgMs:       parseFloat((d.elapsed.reduce((s, v) => s + v, 0) / d.elapsed.length).toFixed(1)),
      p50Ms:       percentile(d.elapsed, 0.50),
      p90Ms:       percentile(d.elapsed, 0.90),
      p95Ms:       percentile(d.elapsed, 0.95),
      p99Ms:       percentile(d.elapsed, 0.99),
      minMs:       d.elapsed[0],
      maxMs:       d.elapsed[d.elapsed.length - 1],
    };
  });

  return {
    // Top-level aggregated metrics (matches test_executions columns)
    totalRequests:  total,
    totalErrors:    errors,
    errorRatePct:   parseFloat(((errors / total) * 100).toFixed(3)),
    avgMs:          parseFloat((elapsed.reduce((s, v) => s + v, 0) / elapsed.length).toFixed(1)),
    p50Ms:          percentile(elapsed, 0.50),
    p90Ms:          percentile(elapsed, 0.90),
    p95Ms:          percentile(elapsed, 0.95),
    p99Ms:          percentile(elapsed, 0.99),
    minMs:          elapsed[0],
    maxMs:          elapsed[elapsed.length - 1],
    avgRps:         parseFloat(avgRps.toFixed(2)),
    peakRps:        parseFloat(peakRps.toFixed(2)),
    durationSec:    Math.round(durationSec),
    startedAt:      new Date(minTs).toISOString(),
    finishedAt:     new Date(maxTs).toISOString(),

    // Per-sampler breakdown
    samplers,
  };
}

function percentile(sorted, p) {
  if (!sorted.length) return 0;
  const idx = Math.min(Math.floor(sorted.length * p), sorted.length - 1);
  return sorted[idx];
}

/**
 * Compute peak RPS using a sliding window over timestamps.
 * @param {string[]} lines  - All CSV lines including header
 * @param {number}   tsIdx  - Index of timestamp column
 * @param {string[]} header - Parsed header row
 * @param {number}   windowMs - Window size in milliseconds
 */
function computePeakRps(lines, tsIdx, header, windowMs) {
  const timestamps = [];
  for (let i = 1; i < lines.length; i++) {
    const cols = lines[i].split(',');
    const ts   = parseInt(cols[tsIdx], 10);
    if (!isNaN(ts)) timestamps.push(ts);
  }
  timestamps.sort((a, b) => a - b);

  let peak = 0;
  let left = 0;
  for (let right = 0; right < timestamps.length; right++) {
    while (timestamps[right] - timestamps[left] > windowMs) left++;
    const count = right - left + 1;
    const rps   = count / (windowMs / 1000);
    if (rps > peak) peak = rps;
  }
  return peak;
}

module.exports = { parseJtl };
