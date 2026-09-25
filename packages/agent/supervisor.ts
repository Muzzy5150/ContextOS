import { ChildProcessWithoutNullStreams, spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { readFile, writeFile, rename } from "node:fs/promises";
import { createInterface } from "node:readline";
import { resolve, join } from "node:path";
import { AgentEvent } from "../core/state";
import { JsonFileStorage } from "../core/storage";

export type WorkerStatus = "ONLINE" | "STOPPING" | "OFFLINE" | "RESTORING" | "RECOVERED" | "ERROR";
export interface ContinuityStatus { status: WorkerStatus; pid: number | null; oldPid?: number; newPid?: number; latestSavepoint?: string; recoveredAt?: string; restoredContextTokens?: number; historyEventsReplayed?: number; error?: string; updatedAt: string }
const statusPath = (store: JsonFileStorage) => join(store.directoryPath, "worker-status.json");
export async function readContinuityStatus(store: JsonFileStorage): Promise<ContinuityStatus> {
  try {
    const saved = JSON.parse(await readFile(statusPath(store), "utf8")) as ContinuityStatus;
    if (saved.pid && ["ONLINE", "STOPPING", "RESTORING", "RECOVERED"].includes(saved.status)) {
      try { process.kill(saved.pid, 0); }
      catch (error) { if ((error as NodeJS.ErrnoException).code === "ESRCH") return { ...saved, status: "OFFLINE", pid: null }; }
    }
    return saved;
  }
  catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return { status: "OFFLINE", pid: null, updatedAt: new Date().toISOString() }; throw error; }
}
export async function writeContinuityStatus(store: JsonFileStorage, patch: Partial<ContinuityStatus>): Promise<ContinuityStatus> {
  const next = { ...await readContinuityStatus(store), ...patch, updatedAt: new Date().toISOString() };
  const temporary = `${statusPath(store)}.${process.pid}.${randomUUID()}.tmp`;
  await writeFile(temporary, JSON.stringify(next, null, 2) + "\n");
  await rename(temporary, statusPath(store));
  return next;
}
async function lifecycle(store: JsonFileStorage, type: AgentEvent["type"], message: string, pid?: number, savepointId?: string) {
  const state = await store.loadState();
  await store.appendEvent({ id: randomUUID(), type, timestamp: new Date().toISOString(), message, stateVersion: state?.stateVersion, workerPid: pid, savepointId });
}
export class WorkerSupervisor {
  private child: ChildProcessWithoutNullStreams | null = null;
  private sequence = 0;
  private pending = new Map<number, { resolve: (value: unknown) => void; reject: (error: Error) => void }>();
  constructor(readonly store: JsonFileStorage) {}
  get pid() { return this.child?.pid ?? null; }
  async start(): Promise<number> {
    if (this.child) throw new Error("WORKER ALREADY ONLINE");
    const child = spawn(process.execPath, ["--import", "tsx", resolve(process.cwd(), "cli/worker.ts")], { cwd: process.cwd(), env: { ...process.env, CONTEXTOS_DATA_DIR: this.store.directoryPath }, stdio: ["pipe", "pipe", "pipe"] });
    this.child = child;
    const lines = createInterface({ input: child.stdout });
    lines.on("line", (line) => {
      try { const message = JSON.parse(line) as { id: number; ok: boolean; result?: unknown; error?: string }; const pending = this.pending.get(message.id); if (!pending) return; this.pending.delete(message.id); if (message.ok) pending.resolve(message.result); else pending.reject(new Error(message.error ?? "Worker error")); }
      catch { /* malformed worker output is ignored; request times out */ }
    });
    child.on("exit", () => { if (this.child === child) this.child = null; for (const pending of this.pending.values()) pending.reject(new Error("WORKER PROCESS LOST")); this.pending.clear(); });
    child.on("error", (error) => { if (this.child === child) this.child = null; for (const pending of this.pending.values()) pending.reject(error); this.pending.clear(); });
    try { await this.request("ping"); }
    catch (error) { this.child = null; await writeContinuityStatus(this.store, { status: "ERROR", pid: null, error: "WORKER START FAILURE" }); throw new Error(`WORKER START FAILURE: ${error instanceof Error ? error.message : "unknown"}`); }
    await writeContinuityStatus(this.store, { status: "ONLINE", pid: child.pid ?? null, error: undefined });
    await lifecycle(this.store, "worker_online", `NEW WORKER ONLINE / PID ${child.pid}`, child.pid);
    return child.pid as number;
  }
  async request(action: string, savepointId?: string): Promise<unknown> {
    if (!this.child) throw new Error("WORKER ALREADY DEAD");
    const id = ++this.sequence;
    return new Promise((resolveRequest, rejectRequest) => {
      const timer = setTimeout(() => { this.pending.delete(id); rejectRequest(new Error("WORKER REQUEST TIMEOUT")); }, 30_000);
      this.pending.set(id, { resolve: (value) => { clearTimeout(timer); resolveRequest(value); }, reject: (error) => { clearTimeout(timer); rejectRequest(error); } });
      this.child?.stdin.write(JSON.stringify({ id, action, savepointId }) + "\n");
    });
  }
  async kill(): Promise<{ pid: number; signal: "SIGKILL"; gone: boolean }> {
    const child = this.child;
    if (!child || !child.pid) throw new Error("WORKER ALREADY DEAD");
    const pid = child.pid;
    await writeContinuityStatus(this.store, { status: "STOPPING", pid });
    const exited = new Promise<void>((resolveExit) => child.once("exit", () => resolveExit()));
    child.kill("SIGKILL");
    await exited;
    let gone = false;
    try { process.kill(pid, 0); } catch (error) { gone = (error as NodeJS.ErrnoException).code === "ESRCH"; }
    await writeContinuityStatus(this.store, { status: "OFFLINE", pid: null, oldPid: pid });
    await lifecycle(this.store, "worker_lost", `WORKER PROCESS LOST / PID ${pid}`, pid);
    return { pid, signal: "SIGKILL", gone };
  }
  async restore(id: string): Promise<unknown> {
    if (!this.child) await this.start();
    await writeContinuityStatus(this.store, { status: "RESTORING", pid: this.pid, latestSavepoint: id });
    await lifecycle(this.store, "recovery_started", `RECOVERY STARTED / ${id}`, this.pid ?? undefined, id);
    try {
      const result = await this.request("restore", id) as { estimatedTokens: number; historyEventsReplayed: number };
      await writeContinuityStatus(this.store, { status: "RECOVERED", pid: this.pid, newPid: this.pid ?? undefined, latestSavepoint: id, recoveredAt: new Date().toISOString(), restoredContextTokens: result.estimatedTokens, historyEventsReplayed: result.historyEventsReplayed, error: undefined });
      await lifecycle(this.store, "worker_recovered", `WORKER LINK RESTORED / PID ${this.pid}`, this.pid ?? undefined, id);
      return result;
    } catch (error) { await writeContinuityStatus(this.store, { status: "ERROR", pid: this.pid, error: error instanceof Error ? error.message : "RESTORE FAILURE" }); throw error; }
  }
  async stop(): Promise<void> {
    if (!this.child) return;
    await this.request("shutdown");
    await writeContinuityStatus(this.store, { status: "OFFLINE", pid: null });
  }
}
