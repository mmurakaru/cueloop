import { NodeSDK } from "@opentelemetry/sdk-node";
import { BatchSpanProcessor } from "@opentelemetry/sdk-trace";
import { PeriodicExportingMetricReader } from "@opentelemetry/sdk-metrics";
import { BatchLogRecordProcessor } from "@opentelemetry/sdk-logs";
import { OTLPTraceExporter } from "@opentelemetry/exporter-trace-otlp-http";
import { OTLPMetricExporter } from "@opentelemetry/exporter-metrics-otlp-http";
import { OTLPLogExporter } from "@opentelemetry/exporter-logs-otlp-http";
import { AsyncLocalStorageContextManager } from "@opentelemetry/context-async-hooks";
import { W3CTraceContextPropagator, setGlobalErrorHandler } from "@opentelemetry/core";
import { resourceFromAttributes } from "@opentelemetry/resources";

export function createTestSyncTelemetry(
  endpoint: string,
  serviceName: string,
  onTelemetryError?: () => void,
) {
  // Scheduled exports can fail before shutdown has a batch left to flush.
  if (onTelemetryError) setGlobalErrorHandler(onTelemetryError);

  const telemetry = new NodeSDK({
    autoDetectResources: false,
    resource: resourceFromAttributes({ "service.name": serviceName }),
    contextManager: new AsyncLocalStorageContextManager(),
    textMapPropagator: new W3CTraceContextPropagator(),
    spanProcessors: [
      new BatchSpanProcessor({
        exporter: new OTLPTraceExporter({ url: `${endpoint}/v1/traces`, timeoutMillis: 1000 }),
        exportTimeoutMillis: 1500,
        scheduledDelayMillis: 100,
      }),
    ],
    metricReaders: [
      new PeriodicExportingMetricReader({
        exporter: new OTLPMetricExporter({ url: `${endpoint}/v1/metrics`, timeoutMillis: 1000 }),
        exportIntervalMillis: 60000,
        exportTimeoutMillis: 1500,
      }),
    ],
    logRecordProcessors: [
      new BatchLogRecordProcessor({
        exporter: new OTLPLogExporter({ url: `${endpoint}/v1/logs`, timeoutMillis: 1000 }),
        exportTimeoutMillis: 1500,
        scheduledDelayMillis: 100,
      }),
    ],
  });

  telemetry.start();

  return telemetry;
}
