import { afterEach, describe, expect, test } from "bun:test";
import { GatewayMetrics, startMetricsServer, type MetricsServer } from "./metrics";

describe("GatewayMetrics.render", () => {
  test("renders share counters, a latency histogram, and R2 counters as Prometheus text", () => {
    // Given a metrics registry with a few recorded operations
    const metrics = new GatewayMetrics();

    metrics.recordShare("pull", "ok", 0.2);
    metrics.recordShare("pull", "ok", 3);
    metrics.recordShare("pull", "error", 0.02);
    metrics.recordR2("get", "ok");
    metrics.recordR2("put", "error");

    // When it renders
    const text = metrics.render();

    // Then the counters, buckets, sum, and count are present in exposition format
    expect(text).toContain('cueloop_share_ops_total{primitive="pull",outcome="ok"} 2');
    expect(text).toContain('cueloop_share_ops_total{primitive="pull",outcome="error"} 1');
    expect(text).toContain("# TYPE cueloop_share_op_duration_seconds histogram");
    // 0.02, 0.2 are <= 0.25 (two obs); 3 is not -> le="0.25" bucket holds 2
    expect(text).toContain(
      'cueloop_share_op_duration_seconds_bucket{primitive="pull",le="0.25"} 2',
    );
    expect(text).toContain(
      'cueloop_share_op_duration_seconds_bucket{primitive="pull",le="+Inf"} 3',
    );
    expect(text).toContain('cueloop_share_op_duration_seconds_count{primitive="pull"} 3');
    const sum = Number(
      text.match(/cueloop_share_op_duration_seconds_sum\{primitive="pull"\} ([\d.]+)/)![1],
    );

    expect(sum).toBeCloseTo(3.22, 5);
    expect(text).toContain('cueloop_r2_ops_total{op="get",outcome="ok"} 1');
    expect(text).toContain('cueloop_r2_ops_total{op="put",outcome="error"} 1');
  });

  test("an empty registry still renders the HELP/TYPE headers, no samples", () => {
    // Given a fresh registry
    const metrics = new GatewayMetrics();

    // When it renders
    const text = metrics.render();

    // Then the type headers exist but there are no sample lines
    expect(text).toContain("# TYPE cueloop_share_ops_total counter");
    expect(text).not.toContain("cueloop_share_ops_total{");
  });
});

describe("startMetricsServer", () => {
  let server: MetricsServer | null = null;

  afterEach(() => {
    server?.stop();
    server = null;
  });

  test("serves the rendered metrics on /metrics and 404s elsewhere", async () => {
    // Given a running metrics server with one recorded op
    const metrics = new GatewayMetrics();

    metrics.recordShare("create", "ok", 0.1);
    server = startMetricsServer(metrics, { host: "127.0.0.1", port: 0 });

    // When /metrics is fetched
    const ok = await fetch(`http://127.0.0.1:${server.port}/metrics`);
    const body = await ok.text();

    // Then it returns the exposition text; other paths 404
    expect(ok.status).toBe(200);
    expect(body).toContain('cueloop_share_ops_total{primitive="create",outcome="ok"} 1');
    const missing = await fetch(`http://127.0.0.1:${server.port}/nope`);

    expect(missing.status).toBe(404);
  });
});
