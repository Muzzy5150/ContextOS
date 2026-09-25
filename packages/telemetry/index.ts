import { appendFile, mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { AgentEvent } from "../core/state";

export interface TelemetryEvent {
  run_id: string; event_id: string; event_type: string; timestamp: string;
  mission?: string; scenario?: string; state_version?: number; worker_pid?: number;
  provider?: string; model?: string; input_tokens?: number; output_tokens?: number; latency_ms?: number;
  raw_history_estimated_tokens?: number; compiled_context_estimated_tokens?: number; context_ratio?: number;
  mutation_type?: string; state_key?: string; savepoint_id?: string; failure_type?: string;
  autopsy_origin_version?: number; autopsy_confidence?: number; mode?: string; step?: number;
}
export interface TelemetryContext { runId: string; mission: string; scenario: string }
export interface TelemetryExporter { emit(event: TelemetryEvent): Promise<void>; emitMany?(events: TelemetryEvent[]): Promise<void> }
export interface RawTreeConfig { enabled: boolean; apiKey?: string; baseUrl: string; database?: string; table: string }
export interface TelemetryStatus { status: "NOT CONFIGURED" | "READY" | "CONNECTED" | "ERROR"; exportedEvents: number; lastExport?: string; lastRunId?: string; lastError?: string }
const identifier = /^[A-Za-z_][A-Za-z0-9_]*$/;
const sensitiveLabel = /\b(?:api[_ -]?key|secret|password|bearer|credential|access[_ -]?token)\b|sk-[A-Za-z0-9_-]{8,}/i;
const safeMission = (mission: string) => sensitiveLabel.test(mission) ? "[redacted mission]" : mission.slice(0, 160);
export function rawTreeConfig(env: NodeJS.ProcessEnv = process.env): RawTreeConfig {
  const table = env.RAWTREE_TABLE?.trim() || "contextos_events";
  const database = env.RAWTREE_DATABASE?.trim() || undefined;
  if (!identifier.test(table) || (database && !identifier.test(database))) throw new Error("Invalid RawTree table or database name");
  return { enabled: env.RAWTREE_ENABLED === "true", apiKey: env.RAWTREE_API_KEY?.trim() || undefined, baseUrl: (env.RAWTREE_BASE_URL?.trim() || "https://api.rawtree.com").replace(/\/$/, ""), database, table };
}
export function normalizeAgentEvent(event: AgentEvent, context: TelemetryContext): TelemetryEvent {
  const raw = event.rawHistoryTokensEstimate;
  const compiled = event.compiledContextTokensEstimate;
  const key = event.message.startsWith("FACT / ") ? event.message.slice(7) : event.relatedStateKeys?.[0];
  return {
    run_id: event.runId ?? context.runId, event_id: event.id, event_type: event.type === "worker_online" ? "worker_started" : event.type,
    timestamp: event.timestamp, mission: safeMission(context.mission), scenario: event.scenario ?? context.scenario,
    state_version: event.stateVersion, worker_pid: event.workerPid, provider: event.provider ? safeMission(event.provider) : undefined, model: event.model ? safeMission(event.model) : undefined,
    input_tokens: event.inputTokens ?? event.estimatedInputTokens, output_tokens: event.outputTokens ?? event.estimatedOutputTokens, latency_ms: event.latencyMs,
    raw_history_estimated_tokens: raw, compiled_context_estimated_tokens: compiled,
    context_ratio: raw && compiled !== undefined ? compiled / raw : undefined,
    mutation_type: event.mutationType, state_key: key ? safeMission(key) : undefined, savepoint_id: event.savepointId,
    failure_type: event.type === "mission_failure" ? "mission_failure" : event.errorCode,
    mode: event.mode, step: event.turn
  };
}
export class LocalTelemetryExporter implements TelemetryExporter {
  constructor(private readonly directory: string) {}
  async emit(event: TelemetryEvent): Promise<void> { await mkdir(this.directory, { recursive: true }); await appendFile(join(this.directory, "telemetry.jsonl"), JSON.stringify(event) + "\n"); }
  async emitMany(events: TelemetryEvent[]): Promise<void> { if (!events.length) return; await mkdir(this.directory, { recursive: true }); await appendFile(join(this.directory, "telemetry.jsonl"), events.map((event) => JSON.stringify(event)).join("\n") + "\n"); }
}
export class RawTreeTelemetryExporter implements TelemetryExporter {
  constructor(readonly config: RawTreeConfig, private readonly fetchImpl: typeof fetch = fetch) {
    if (!config.enabled || !config.apiKey) throw new Error("RawTree is not configured");
  }
  async emit(event: TelemetryEvent) { await this.emitMany([event]); }
  async emitMany(events: TelemetryEvent[]): Promise<void> {
    if (!events.length) return;
    const url = new URL(`${this.config.baseUrl}/v1/tables/${this.config.table}`);
    if (this.config.database) url.searchParams.set("database", this.config.database);
    let response: Response;
    try { response = await this.fetchImpl(url, { method: "POST", headers: { Authorization: `Bearer ${this.config.apiKey}`, "Content-Type": "application/json" }, body: JSON.stringify(events), signal: AbortSignal.timeout(2500) }); }
    catch { throw new Error("RawTree network request failed"); }
    if (!response.ok) throw new Error(`RawTree HTTP ${response.status}`);
    const body = await response.json().catch(() => null) as { inserted?: number | null } | null;
    if (body?.inserted !== undefined && body.inserted !== null && body.inserted !== events.length) throw new Error(`RawTree accepted ${body.inserted} of ${events.length} records`);
  }
  async query<T extends Record<string, unknown>>(sql: string): Promise<T[]> {
    const url = new URL(`${this.config.baseUrl}/v1/query`);
    if (this.config.database) url.searchParams.set("database", this.config.database);
    let response: Response;
    try { response = await this.fetchImpl(url, { method: "POST", headers: { Authorization: `Bearer ${this.config.apiKey}`, "Content-Type": "application/json" }, body: JSON.stringify({ sql }), signal: AbortSignal.timeout(5000) }); }
    catch { throw new Error("RawTree query request failed"); }
    if (!response.ok) throw new Error(`RawTree query HTTP ${response.status}`);
    const body = await response.json() as { data?: T[] };
    return body.data ?? [];
  }
}
export function runAnalyticsQueries(table: string, runId: string): { eventCounts: string; contextByStep: string; totals: string; modelUsage: string } {
  if (!identifier.test(table)) throw new Error("Invalid RawTree table name");
  const id = runId.replaceAll("'", "''");
  return {
    eventCounts: `SELECT event_type, count() AS total FROM ${table} WHERE run_id = '${id}' GROUP BY event_type ORDER BY total DESC LIMIT 50`,
    contextByStep: `SELECT step, raw_history_estimated_tokens, compiled_context_estimated_tokens, context_ratio FROM ${table} WHERE run_id = '${id}' AND event_type = 'benchmark_step' ORDER BY step LIMIT 200`,
    totals: `SELECT count() AS events, countIf(event_type = 'model_request_completed') AS model_calls, countIf(event_type = 'mutation_applied') AS mutations, countIf(event_type = 'mutation_rejected') AS rejected_mutations, countIf(event_type = 'savepoint_created') AS savepoints, countIf(event_type = 'worker_recovered') AS recoveries, countIf(event_type = 'mission_failure') AS mission_failures, countIf(event_type = 'autopsy_completed') AS autopsies FROM ${table} WHERE run_id = '${id}'`,
    modelUsage: `SELECT provider, model, count() AS calls, sum(input_tokens) AS input_tokens, sum(output_tokens) AS output_tokens, avg(latency_ms) AS average_latency_ms FROM ${table} WHERE run_id = '${id}' AND event_type = 'model_request_completed' GROUP BY provider, model ORDER BY calls DESC LIMIT 50`
  };
}
export async function queryRunAnalytics(exporter: RawTreeTelemetryExporter, runId: string) {
  const queries = runAnalyticsQueries(exporter.config.table, runId);
  const [eventCounts, contextByStep, totals, modelUsage] = await Promise.all([
    exporter.query(queries.eventCounts), exporter.query(queries.contextByStep), exporter.query(queries.totals), exporter.query(queries.modelUsage)
  ]);
  return { eventCounts, contextByStep, totals, modelUsage };
}
export class TelemetryPipeline {
  private readonly pending = new Set<Promise<void>>();
  private hydration?: Promise<void>;
  private statusWrites: Promise<void> = Promise.resolve();
  private status: TelemetryStatus;
  constructor(private readonly directory: string, private readonly local: TelemetryExporter, private readonly remote?: TelemetryExporter) {
    this.status = { status: remote ? "READY" : "NOT CONFIGURED", exportedEvents: 0 };
  }
  record(event: TelemetryEvent): void { this.batch([event]); }
  recordAgentEvent(event: AgentEvent, context: TelemetryContext): void { this.record(normalizeAgentEvent(event, context)); }
  batch(events: TelemetryEvent[]): void {
    if (!events.length) return;
    this.hydration ??= (async () => {
      if (!this.remote) return;
      try {
        const previous = JSON.parse(await readFile(join(this.directory, "telemetry-status.json"), "utf8")) as TelemetryStatus;
        if (Number.isSafeInteger(previous.exportedEvents) && previous.exportedEvents >= 0) this.status = { ...previous, status: "READY" };
      } catch { /* no prior status */ }
    })();
    const work = (async () => {
      await this.hydration;
      try { if (this.local.emitMany) await this.local.emitMany(events); else for (const event of events) await this.local.emit(event); }
      catch { console.warn("ContextOS local telemetry mirror failed; canonical event log remains authoritative"); }
      if (!this.remote) return;
      try {
        if (this.remote.emitMany) await this.remote.emitMany(events); else for (const event of events) await this.remote.emit(event);
        this.status = { status: "CONNECTED", exportedEvents: this.status.exportedEvents + events.length, lastExport: new Date().toISOString(), lastRunId: events.at(-1)?.run_id };
      } catch (error) {
        const message = error instanceof Error ? error.message : "RawTree export failed";
        if (this.status.status !== "ERROR" || this.status.lastError !== message) console.warn(`ContextOS RawTree telemetry: ${message}`);
        this.status = { ...this.status, status: "ERROR", lastError: message };
      }
      this.statusWrites = this.statusWrites.then(() => this.persistStatus()).catch(() => {});
      await this.statusWrites;
    })();
    this.pending.add(work);
    void work.finally(() => this.pending.delete(work));
  }
  async flush(): Promise<void> { await Promise.all([...this.pending]); }
  private async persistStatus() {
    await mkdir(this.directory, { recursive: true });
    const temporary = join(this.directory, `telemetry-status.${process.pid}.${crypto.randomUUID()}.tmp`);
    await writeFile(temporary, JSON.stringify(this.status, null, 2) + "\n");
    await rename(temporary, join(this.directory, "telemetry-status.json"));
  }
}
export function createTelemetryPipeline(directory: string, env: NodeJS.ProcessEnv = process.env, fetchImpl: typeof fetch = fetch): TelemetryPipeline {
  try {
    const config = rawTreeConfig(env);
    return new TelemetryPipeline(directory, new LocalTelemetryExporter(directory), config.enabled && config.apiKey ? new RawTreeTelemetryExporter(config, fetchImpl) : undefined);
  } catch {
    console.warn("ContextOS RawTree telemetry configuration invalid; local runtime continues");
    return new TelemetryPipeline(directory, new LocalTelemetryExporter(directory));
  }
}
export async function readTelemetryStatus(directory: string, env: NodeJS.ProcessEnv = process.env): Promise<TelemetryStatus> {
  let config: RawTreeConfig;
  try { config = rawTreeConfig(env); }
  catch { return { status: "ERROR", exportedEvents: 0, lastError: "Invalid RawTree configuration" }; }
  if (!config.enabled || !config.apiKey) return { status: "NOT CONFIGURED", exportedEvents: 0, lastError: config.enabled ? "RAWTREE_API_KEY missing" : undefined };
  try { return JSON.parse(await readFile(join(directory, "telemetry-status.json"), "utf8")) as TelemetryStatus; }
  catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return { status: "READY", exportedEvents: 0 }; throw error; }
}
export async function recordAutopsyTelemetry(directory: string, runId: string, type: "autopsy_started" | "autopsy_completed", originVersion?: number, confidence?: number): Promise<void> {
  const pipeline = createTelemetryPipeline(directory);
  pipeline.record({ run_id: runId, event_id: `${runId}-${type}`, event_type: type, timestamp: new Date().toISOString(), scenario: "autopsy", mission: "Deploy the application to the configured production region.", autopsy_origin_version: originVersion, autopsy_confidence: confidence, mode: "DEMO" });
  await pipeline.flush();
}
