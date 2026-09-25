import { createHash, randomUUID } from "node:crypto";
import { compileContext } from "./compiler";
import { AgentEvent, AgentState, StateDiff } from "./state";
import { JsonFileStorage } from "./storage";

export type SavepointReason = "manual" | "automatic" | "pre_shutdown" | "scenario";
export interface Savepoint {
  id: string; sequence: number; createdAt: string; stateVersion: number; mission: string;
  agentState: AgentState;
  contextSnapshot: { compiledContext: string; estimatedTokens: number };
  recentEventCursor: number;
  metadata: { reason: SavepointReason; mode: "demo" | "live"; firstBrainProvider?: string; secondBrainProvider?: string };
  integrity: { schemaVersion: 1; checksum: string };
}
export interface RecoveryResult {
  savepointId: string; savedStateVersion: number; resultingStateVersion: number;
  state: AgentState; compiledContext: string; estimatedTokens: number;
  historyEventsReplayed: 0; restoredFrom: { savepointId: string; stateVersion: number };
}
const record = (x: unknown): x is Record<string, unknown> => !!x && typeof x === "object" && !Array.isArray(x);
const str = (x: unknown): x is string => typeof x === "string" && x.trim().length > 0;
const status = (x: unknown, allowed: string[]) => typeof x === "string" && allowed.includes(x);
export function validateAgentState(value: unknown): asserts value is AgentState {
  if (!record(value) || !str(value.mission) || !str(value.currentGoal) || !Number.isSafeInteger(value.stateVersion) || (value.stateVersion as number) < 1 ||
      !str(value.createdAt) || !str(value.updatedAt) || !["facts", "constraints", "decisions", "openLoops", "nextActions", "artifacts"].every((key) => Array.isArray(value[key]))) throw new Error("SAVEPOINT INVALID: canonical state schema");
  if (value.completedTurns !== undefined && (!Number.isSafeInteger(value.completedTurns) || (value.completedTurns as number) < 0)) throw new Error("SAVEPOINT INVALID: completed turns");
  for (const fact of value.facts as unknown[]) if (!record(fact) || !str(fact.id) || !str(fact.key) || !str(fact.value) || !status(fact.status, ["active", "superseded", "archived"]) || !str(fact.createdAt) || !str(fact.updatedAt)) throw new Error("SAVEPOINT INVALID: fact schema");
  for (const key of ["constraints", "decisions", "openLoops", "nextActions"] as const) for (const item of value[key] as unknown[]) if (!record(item) || !str(item.id) || !str(item.text) || !status(item.status, key === "openLoops" ? ["active", "archived", "resolved"] : ["active", "archived"]) || !str(item.createdAt) || !str(item.updatedAt)) throw new Error(`SAVEPOINT INVALID: ${key} schema`);
  for (const item of value.artifacts as unknown[]) if (!record(item) || !str(item.id) || !str(item.label) || !str(item.uri) || !str(item.createdAt)) throw new Error("SAVEPOINT INVALID: artifact schema");
}
function checksum(savepoint: Omit<Savepoint, "integrity">): string { return createHash("sha256").update(JSON.stringify(savepoint)).digest("hex"); }
function event(type: AgentEvent["type"], message: string, stateVersion: number, savepointId: string): AgentEvent {
  return { id: randomUUID(), type, timestamp: new Date().toISOString(), message, stateVersion, savepointId };
}
export function verifySavepoint(value: unknown): Savepoint {
  if (!record(value)) throw new Error("SAVEPOINT INVALID: root schema");
  if (!record(value.integrity) || value.integrity.schemaVersion !== 1) throw new Error("UNSUPPORTED SCHEMA");
  if (!str(value.id) || !/^sp-\d{4,}$/.test(value.id) || !Number.isSafeInteger(value.sequence) || !str(value.createdAt) ||
      !Number.isSafeInteger(value.stateVersion) || !str(value.mission) || !Number.isSafeInteger(value.recentEventCursor) ||
      !record(value.contextSnapshot) || typeof value.contextSnapshot.compiledContext !== "string" || !Number.isSafeInteger(value.contextSnapshot.estimatedTokens) ||
      !record(value.metadata) || !status(value.metadata.reason, ["manual", "automatic", "pre_shutdown", "scenario"]) || !status(value.metadata.mode, ["demo", "live"]) || !str(value.integrity.checksum)) throw new Error("SAVEPOINT INVALID: envelope schema");
  validateAgentState(value.agentState);
  if (value.stateVersion !== value.agentState.stateVersion || value.mission !== value.agentState.mission || value.sequence !== Number(value.id.slice(3))) throw new Error("SAVEPOINT INVALID: inconsistent state");
  const { integrity, ...payload } = value;
  if (checksum(payload as Omit<Savepoint, "integrity">) !== integrity.checksum) throw new Error("CHECKSUM FAILURE");
  return value as unknown as Savepoint;
}
export async function createSavepoint(store: JsonFileStorage, reason: SavepointReason = "manual"): Promise<{ savepoint: Savepoint; bytes: number }> {
  const state = await store.loadState();
  if (!state) throw new Error("Canonical state not found");
  validateAgentState(state);
  const events = await store.loadEvents();
  const snapshotState = structuredClone(state);
  if (snapshotState.completedTurns === undefined) snapshotState.completedTurns = events.filter((entry) => entry.type === "turn_completed").length;
  const compiled = compileContext(snapshotState, events);
  const start = events.find((entry) => entry.type === "scenario_started");
  const ids = await store.savepointIds();
  const sequence = Math.max(0, ...ids.map((id) => Number(id.slice(3)))) + 1;
  const payload: Omit<Savepoint, "integrity"> = {
    id: `sp-${String(sequence).padStart(4, "0")}`, sequence, createdAt: new Date().toISOString(), stateVersion: state.stateVersion, mission: state.mission,
    agentState: snapshotState, contextSnapshot: { compiledContext: compiled.text, estimatedTokens: compiled.compiledTokens }, recentEventCursor: events.length,
    metadata: { reason, mode: start?.mode === "LIVE" ? "live" : "demo", firstBrainProvider: start?.firstProvider, secondBrainProvider: start?.secondProvider }
  };
  const savepoint: Savepoint = { ...payload, integrity: { schemaVersion: 1, checksum: checksum(payload) } };
  const bytes = await store.writeSavepoint(savepoint.id, JSON.stringify(savepoint, null, 2) + "\n");
  await store.appendEvent(event("savepoint_created", `SAVEPOINT CREATED / ${savepoint.id}`, state.stateVersion, savepoint.id));
  return { savepoint, bytes };
}
export async function readVerifiedSavepoint(store: JsonFileStorage, id: string): Promise<{ savepoint: Savepoint; bytes: number }> {
  const { text, bytes } = await store.readSavepoint(id);
  let parsed: unknown;
  try { parsed = JSON.parse(text); } catch { throw new Error("SAVEPOINT INVALID: malformed JSON"); }
  const savepoint = verifySavepoint(parsed);
  if (savepoint.id !== id) throw new Error("SAVEPOINT INVALID: mismatched ID");
  return { savepoint, bytes };
}
export async function latestSavepoint(store: JsonFileStorage): Promise<string | null> { return (await store.savepointIds()).at(-1) ?? null; }
export async function restoreSavepoint(store: JsonFileStorage, id: string): Promise<RecoveryResult> {
  // No event or diff history is read in this path. The saved AgentState is authoritative.
  const { savepoint } = await readVerifiedSavepoint(store, id);
  const current = await store.loadState();
  if (current) validateAgentState(current);
  const now = new Date().toISOString();
  const restored: AgentState = structuredClone(savepoint.agentState);
  restored.stateVersion = Math.max(current?.stateVersion ?? 0, savepoint.stateVersion) + 1;
  restored.updatedAt = now;
  restored.restoredFromSavepoint = id;
  restored.restoredFromStateVersion = savepoint.stateVersion;
  const compiled = compileContext(restored, []);
  const diff: StateDiff = { id: `diff-restore-${restored.stateVersion}-${randomUUID()}`, stateVersion: restored.stateVersion, mutationType: "RESTORE_SAVEPOINT", subject: "CANONICAL STATE", before: current ? `State #${current.stateVersion}` : "No state", after: `${id} / state #${savepoint.stateVersion}`, reason: "Verified savepoint restored as a new auditable state version", timestamp: now };
  await store.saveState(restored);
  await store.appendDiff(diff);
  await store.appendEvent(event("savepoint_verified", `SAVEPOINT VERIFIED / ${id}`, restored.stateVersion, id));
  await store.appendEvent(event("savepoint_restored", `STATE RESTORED / #${restored.stateVersion} FROM ${id} / #${savepoint.stateVersion}`, restored.stateVersion, id));
  return { savepointId: id, savedStateVersion: savepoint.stateVersion, resultingStateVersion: restored.stateVersion, state: restored, compiledContext: compiled.text, estimatedTokens: compiled.compiledTokens, historyEventsReplayed: 0, restoredFrom: { savepointId: id, stateVersion: savepoint.stateVersion } };
}
