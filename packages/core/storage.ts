import { mkdir, readFile, rename, writeFile, appendFile, readdir, link, unlink, stat } from "node:fs/promises";
import { join } from "node:path";
import { AgentEvent, AgentState, StateDiff } from "./state";
import { TelemetryPipeline, TelemetryContext } from "../telemetry";
export interface StateStorage {
  loadState(): Promise<AgentState | null>;
  loadEvents(): Promise<AgentEvent[]>;
  loadDiffs(): Promise<StateDiff[]>;
  saveState(state: AgentState): Promise<void>;
  appendEvent(event: AgentEvent): Promise<void>;
  appendDiff(diff: StateDiff): Promise<void>;
  reset(state: AgentState, event: AgentEvent): Promise<void>;
  saveHistoricalState?(state: AgentState): Promise<void>;
}
export class JsonFileStorage implements StateStorage {
  private telemetryContext?: TelemetryContext;
  constructor(private readonly directory: string, private readonly telemetry?: TelemetryPipeline) {}
  get directoryPath() { return this.directory; }
  private path(name: string) { return join(this.directory, name); }
  private async readJsonl<T>(name: string): Promise<T[]> {
    try { const text = await readFile(this.path(name), "utf8"); return text.trim() ? text.trim().split("\n").map((line) => JSON.parse(line) as T) : []; }
    catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return []; throw error; }
  }
  async loadState(): Promise<AgentState | null> { try { return JSON.parse(await readFile(this.path("state.json"), "utf8")) as AgentState; } catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return null; throw error; } }
  loadEvents() { return this.readJsonl<AgentEvent>("events.jsonl"); }
  loadDiffs() { return this.readJsonl<StateDiff>("diffs.jsonl"); }
  async saveState(state: AgentState) {
    await mkdir(this.directory, { recursive: true });
    const temporary = this.path(`state.${process.pid}.${crypto.randomUUID()}.tmp`);
    await writeFile(temporary, JSON.stringify(state, null, 2) + "\n", "utf8");
    await rename(temporary, this.path("state.json"));
    await this.saveHistoricalState(state);
  }
  private async historyEpoch(): Promise<string> {
    const pointer = this.path("state-history/current.json");
    try { return (JSON.parse(await readFile(pointer, "utf8")) as { epoch: string }).epoch; }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
      await mkdir(this.path("state-history"), { recursive: true });
      const epoch = crypto.randomUUID();
      try { await writeFile(pointer, JSON.stringify({ epoch }) + "\n", { flag: "wx" }); return epoch; }
      catch (writeError) { if ((writeError as NodeJS.ErrnoException).code === "EEXIST") return (JSON.parse(await readFile(pointer, "utf8")) as { epoch: string }).epoch; throw writeError; }
    }
  }
  async saveHistoricalState(state: AgentState): Promise<void> {
    const epoch = await this.historyEpoch();
    const directory = this.path(`state-history/${epoch}`);
    await mkdir(directory, { recursive: true });
    const target = join(directory, `state-${String(state.stateVersion).padStart(4, "0")}.json`);
    const temporary = join(directory, `.state-${state.stateVersion}.${process.pid}.${crypto.randomUUID()}.tmp`);
    await writeFile(temporary, JSON.stringify(state, null, 2) + "\n", { flag: "wx" });
    try { await link(temporary, target); }
    catch (error) { if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error; }
    finally { await unlink(temporary); }
  }
  async getStateAtVersion(version: number): Promise<AgentState> {
    if (!Number.isSafeInteger(version) || version < 1) throw new Error("STATE VERSION NOT FOUND");
    const epoch = await this.historyEpoch();
    try {
      const state = JSON.parse(await readFile(this.path(`state-history/${epoch}/state-${String(version).padStart(4, "0")}.json`), "utf8")) as AgentState;
      if (state.stateVersion !== version) throw new Error("HISTORICAL STATE INVALID");
      return state;
    } catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") throw new Error("STATE VERSION NOT FOUND"); throw error; }
  }
  async stateVersions(): Promise<number[]> {
    const epoch = await this.historyEpoch();
    try { return (await readdir(this.path(`state-history/${epoch}`))).filter((name) => /^state-\d{4,}\.json$/.test(name)).map((name) => Number(name.slice(6, -5))).sort((a, b) => a - b); }
    catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return []; throw error; }
  }
  async appendEvent(event: AgentEvent) {
    await mkdir(this.directory, { recursive: true });
    await appendFile(this.path("events.jsonl"), JSON.stringify(event) + "\n", "utf8");
    if (this.telemetry) {
      try {
        if (!this.telemetryContext) {
          const [state, contextText] = await Promise.all([this.loadState(), readFile(this.path("telemetry-run.json"), "utf8").catch(() => "null")]);
          const persisted = JSON.parse(contextText) as TelemetryContext | null;
          this.telemetryContext = persisted ?? { runId: event.runId ?? "unknown", mission: state?.mission ?? "unknown", scenario: event.scenario ?? "api_migration" };
        }
        this.telemetry.recordAgentEvent(event, this.telemetryContext);
      } catch { /* local event is authoritative */ }
    }
  }
  async appendDiff(diff: StateDiff) { await mkdir(this.directory, { recursive: true }); await appendFile(this.path("diffs.jsonl"), JSON.stringify(diff) + "\n", "utf8"); }
  async reset(state: AgentState, event: AgentEvent) {
    await mkdir(this.directory, { recursive: true });
    await mkdir(this.path("state-history"), { recursive: true });
    const temporary = this.path(`state-history/.current.${process.pid}.${crypto.randomUUID()}.tmp`);
    await writeFile(temporary, JSON.stringify({ epoch: crypto.randomUUID() }) + "\n");
    await rename(temporary, this.path("state-history/current.json"));
    await writeFile(this.path("events.jsonl"), JSON.stringify(event) + "\n", "utf8");
    await writeFile(this.path("diffs.jsonl"), "", "utf8");
    await this.saveState(state);
    this.telemetryContext = { runId: event.runId ?? event.id, mission: state.mission, scenario: event.scenario ?? "api_migration" };
    if (this.telemetry) {
      try { await writeFile(this.path("telemetry-run.json"), JSON.stringify(this.telemetryContext) + "\n"); }
      catch { /* telemetry metadata cannot fail the canonical reset */ }
    }
    try { this.telemetry?.recordAgentEvent(event, this.telemetryContext); } catch { /* local reset is authoritative */ }
  }
  async flushTelemetry() { await this.telemetry?.flush(); }
  async savepointIds(): Promise<string[]> {
    try { return (await readdir(this.path("savepoints"))).filter((name) => /^sp-\d{4,}\.json$/.test(name)).map((name) => name.slice(0, -5)).sort((a, b) => Number(a.slice(3)) - Number(b.slice(3))); }
    catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return []; throw error; }
  }
  async readSavepoint(id: string): Promise<{ text: string; bytes: number }> {
    if (!/^sp-\d{4,}$/.test(id)) throw new Error("SAVEPOINT NOT FOUND");
    try { const text = await readFile(this.path(`savepoints/${id}.json`), "utf8"); return { text, bytes: Buffer.byteLength(text) }; }
    catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") throw new Error("SAVEPOINT NOT FOUND"); throw error; }
  }
  async writeSavepoint(id: string, text: string): Promise<number> {
    if (!/^sp-\d{4,}$/.test(id)) throw new Error("Invalid savepoint ID");
    await mkdir(this.path("savepoints"), { recursive: true });
    const temporary = this.path(`savepoints/.${id}.${process.pid}.${crypto.randomUUID()}.tmp`);
    await writeFile(temporary, text, { flag: "wx" });
    try { await link(temporary, this.path(`savepoints/${id}.json`)); }
    catch (error) { if ((error as NodeJS.ErrnoException).code === "EEXIST") throw new Error("SAVEPOINT ALREADY EXISTS"); throw error; }
    finally { await unlink(temporary); }
    return Buffer.byteLength(text);
  }
  async rawHistoryBytes(): Promise<number> { try { return (await stat(this.path("events.jsonl"))).size; } catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return 0; throw error; } }
}
