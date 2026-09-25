import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { createInitialState } from "../packages/core/state";
import { JsonFileStorage } from "../packages/core/storage";
import { LocalTelemetryExporter, normalizeAgentEvent, RawTreeTelemetryExporter, TelemetryPipeline, rawTreeConfig, runAnalyticsQueries, queryRunAnalytics } from "../packages/telemetry";
const now = "2026-09-25T00:00:00.000Z";
const config = rawTreeConfig({ NODE_ENV: "test", RAWTREE_ENABLED: "true", RAWTREE_API_KEY: "test-secret", RAWTREE_DATABASE: "demo_db", RAWTREE_TABLE: "contextos_events" });
test("telemetry normalization exports structured metrics without prompts or secrets", () => {
  const normalized = normalizeAgentEvent({ id: "evt-1", type: "context_compiled", timestamp: now, message: "Context compiled", detail: "Bearer test-secret and private prompt", stateVersion: 5, rawHistoryTokensEstimate: 1000, compiledContextTokensEstimate: 250, turn: 3 }, { runId: "run-1", mission: "API integration", scenario: "api_migration" });
  assert.equal(normalized.context_ratio, .25);
  assert.equal(normalized.state_version, 5);
  assert.equal(normalized.step, 3);
  assert.doesNotMatch(JSON.stringify(normalized), /test-secret|private prompt|detail/);
  const redacted = normalizeAgentEvent({ id: "evt-2", type: "scenario_started", timestamp: now, message: "Started" }, { runId: "run-1", mission: "Use API key sk-example-secret-123456", scenario: "test" });
  assert.equal(redacted.mission, "[redacted mission]");
});
test("RawTree exporter sends sanitized JSON and supports run analytics queries", async () => {
  const calls: { url: string; init: RequestInit }[] = [];
  const mock = (async (input: string | URL | Request, init?: RequestInit) => {
    calls.push({ url: String(input), init: init! });
    return Response.json(calls.length === 1 ? { inserted: 1 } : { data: [{ event_type: "context_compiled", total: 1 }] });
  }) as typeof fetch;
  const exporter = new RawTreeTelemetryExporter(config, mock);
  await exporter.emit({ run_id: "run-1", event_id: "evt-1", event_type: "context_compiled", timestamp: now });
  const queries = runAnalyticsQueries(config.table, "run-1");
  const rows = await exporter.query(queries.eventCounts);
  assert.equal(rows[0].total, 1);
  assert.match(calls[0].url, /\/v1\/tables\/contextos_events\?database=demo_db/);
  assert.equal(calls[0].init.headers && (calls[0].init.headers as Record<string, string>).Authorization, "Bearer test-secret");
  assert.doesNotMatch(String(calls[0].init.body), /test-secret/);
  assert.match(String(calls[1].init.body), /GROUP BY event_type/);
  const analytics = await queryRunAnalytics(exporter, "run-1");
  assert.equal(Object.keys(analytics).length, 4);
  assert.equal(calls.length, 6);
});
test("RawTree failure is diagnostic and does not affect local canonical state", async () => {
  const directory = await mkdtemp(join(tmpdir(), "contextos-telemetry-"));
  try {
    const failed = new RawTreeTelemetryExporter(config, (async () => { throw new Error("offline"); }) as typeof fetch);
    const pipeline = new TelemetryPipeline(directory, new LocalTelemetryExporter(directory), failed);
    const store = new JsonFileStorage(directory, pipeline);
    const state = createInitialState(now);
    const start = { id: "start", type: "scenario_started" as const, timestamp: now, message: "Started", runId: "run-1", scenario: "api_migration" };
    await store.reset(state, start);
    await store.appendEvent({ id: "evt-2", type: "context_compiled", timestamp: now, message: "Compiled", stateVersion: 1 });
    await store.flushTelemetry();
    assert.deepEqual(await store.loadState(), state);
    assert.equal((await store.loadEvents()).length, 2);
    const status = JSON.parse(await readFile(join(directory, "telemetry-status.json"), "utf8")) as { status: string };
    assert.equal(status.status, "ERROR");
    const mirror = await readFile(join(directory, "telemetry.jsonl"), "utf8");
    assert.match(mirror, /context_compiled/);
  } finally { await rm(directory, { recursive: true, force: true }); }
});
