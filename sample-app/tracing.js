'use strict';

/**
 * OpenTelemetry SDK bootstrap
 * Must be --require'd before any application code so auto-instrumentations
 * can patch modules (http, express, dns, etc.) at load time.
 */

const { NodeSDK } = require('@opentelemetry/sdk-node');
const { getNodeAutoInstrumentations } = require('@opentelemetry/auto-instrumentations-node');
const { OTLPTraceExporter } = require('@opentelemetry/exporter-trace-otlp-http');
const { Resource } = require('@opentelemetry/resources');
const { SemanticResourceAttributes } = require('@opentelemetry/semantic-conventions');
const { BatchSpanProcessor } = require('@opentelemetry/sdk-trace-base');

const endpoint  = process.env.OTEL_EXPORTER_OTLP_ENDPOINT || 'http://tempo:4318';
const service   = process.env.OTEL_SERVICE_NAME            || 'sample-app';
const env       = process.env.NODE_ENV                     || 'local';

const exporter = new OTLPTraceExporter({
  url: `${endpoint}/v1/traces`,
});

const sdk = new NodeSDK({
  resource: new Resource({
    [SemanticResourceAttributes.SERVICE_NAME]:    service,
    [SemanticResourceAttributes.SERVICE_VERSION]: '1.0.0',
    'deployment.environment': env,
  }),
  spanProcessor: new BatchSpanProcessor(exporter, {
    maxExportBatchSize: 512,
    scheduledDelayMillis: 1000,
  }),
  instrumentations: [
    getNodeAutoInstrumentations({
      // fs is too noisy for a load-test target
      '@opentelemetry/instrumentation-fs':  { enabled: false },
      '@opentelemetry/instrumentation-http':    { enabled: true },
      '@opentelemetry/instrumentation-express': { enabled: true },
    }),
  ],
});

sdk.start();
console.log(JSON.stringify({ level: 'info', message: `[tracing] OpenTelemetry started → ${endpoint}`, service }));

process.on('SIGTERM', () => {
  sdk.shutdown()
    .then(() => console.log(JSON.stringify({ level: 'info', message: '[tracing] SDK shutdown complete' })))
    .catch(err => console.error(JSON.stringify({ level: 'error', message: '[tracing] SDK shutdown error', error: err.message })))
    .finally(() => process.exit(0));
});
