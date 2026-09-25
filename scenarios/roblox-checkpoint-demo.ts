import { randomUUID } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { basename, join, resolve } from "node:path";
import { AutopsyReport, latestAutopsyReport } from "../packages/core/autopsy";
import { compileContext } from "../packages/core/compiler";
import { applyMutation } from "../packages/core/mutations";
import { latestSavepoint, readVerifiedSavepoint, Savepoint } from "../packages/core/savepoints";
import { activeFacts, AgentEvent, AgentState, StateDiff } from "../packages/core/state";
import { JsonFileStorage } from "../packages/core/storage";
import { Mutation, validateMutation } from "../packages/core/validation";
import { ContinuityStatus, readContinuityStatus } from "../packages/agent/supervisor";

export const robloxBaseDirectory = process.env.CONTEXTOS_DATA_DIR ?? resolve(process.cwd(), "data");
export type RobloxStage = "empty" | "started" | "prepared" | "saved" | "lost" | "restored" | "continued" | "requirement" | "fault" | "failure" | "autopsied";
export interface RobloxRun { id: string; store: JsonFileStorage }
export interface RobloxDashboardData {
  runId: string; stage: RobloxStage; state: AgentState; events: AgentEvent[]; diffs: StateDiff[];
  savepoint: Savepoint | null; continuity: ContinuityStatus; report: AutopsyReport | null;
  failure: AgentEvent | null; originBefore: AgentState | null; originAfter: AgentState | null;
}
const event = (runId: string, type: AgentEvent["type"], message: string, stateVersion: number, extra: Partial<AgentEvent> = {}): AgentEvent => ({
  id: randomUUID(), type, timestamp: new Date().toISOString(), message, stateVersion, mode: "DEMO", scenario: "roblox_checkpoint", runId, ...extra
});
const active = (state: AgentState, key: string) => activeFacts(state).find((fact) => fact.key === key)?.value;
const activeLoop = (state: AgentState) => state.openLoops.find((item) => item.status === "active" && item.text === "Verify Blue spawn sightline.");
const activeAction = (state: AgentState) => state.nextActions.find((item) => item.status === "active" && item.text === "Run Blue spawn verification.");

export async function currentRobloxRun(baseDirectory = robloxBaseDirectory): Promise<RobloxRun | null> {
  try {
    const pointer = JSON.parse(await readFile(join(baseDirectory, "roblox-current.json"), "utf8")) as { id: string };
    if (!/^run-[a-f0-9-]{36}$/.test(pointer.id)) throw new Error("ROBLOX RUN INVALID");
    return { id: pointer.id, store: new JsonFileStorage(join(baseDirectory, "roblox-runs", pointer.id)) };
  } catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return null; throw error; }
}

export function robloxRunForStore(store: JsonFileStorage): RobloxRun {
  const id = basename(store.directoryPath);
  if (!/^run-[a-f0-9-]{36}$/.test(id)) throw new Error("ROBLOX RUN NOT FOUND");
  return { id, store };
}

export async function startRobloxScenario(baseDirectory = robloxBaseDirectory): Promise<RobloxRun> {
  const id = `run-${randomUUID()}`;
  const store = new JsonFileStorage(join(baseDirectory, "roblox-runs", id));
  const now = new Date().toISOString();
  const fact = (key: string, value: string) => ({ id: `seed-${key}`, key, value, status: "active" as const, createdAt: now, updatedAt: now });
  const state: AgentState = {
    mission: "Improve ATOM TOWN multiplayer FPS layout while preserving mission continuity.",
    currentGoal: "Fix Red spawn exposure, then verify Blue spawn sightline.",
    facts: [fact("map_name", "ATOM TOWN"), fact("red_spawn_exposed", "true"), fact("blue_spawn", "north"), fact("spawn_clearance", "24"), fact("traversal_tests_passed", "0"), fact("traversal_tests_total", "48")],
    constraints: [{ id: "seed-sightlines", text: "Maintain fair sightlines; no direct spawn-to-mid visibility.", status: "active", createdAt: now, updatedAt: now }],
    decisions: [], openLoops: [], nextActions: [], artifacts: [], stateVersion: 1, completedTurns: 0, createdAt: now, updatedAt: now
  };
  await store.reset(state, event(id, "scenario_started", "CONTROLLED ROBLOX DEMO SCENARIO / ATOM TOWN map inspection started.", 1));
  await mkdir(baseDirectory, { recursive: true });
  const temporary = join(baseDirectory, `.roblox-current.${process.pid}.${randomUUID()}.tmp`);
  await writeFile(temporary, JSON.stringify({ id, updatedAt: now }) + "\n");
  await rename(temporary, join(baseDirectory, "roblox-current.json"));
  return { id, store };
}

async function stateFor(run: RobloxRun): Promise<AgentState> {
  const state = await run.store.loadState();
  if (!state) throw new Error("ROBLOX STATE NOT FOUND");
  return state;
}
async function observation(run: RobloxRun, type: AgentEvent["type"], message: string, extra: Partial<AgentEvent> = {}): Promise<AgentEvent> {
  const entry = event(run.id, type, message, (await stateFor(run)).stateVersion, extra);
  await run.store.appendEvent(entry);
  return entry;
}
async function mutate(run: RobloxRun, proposal: Mutation, source: AgentEvent): Promise<StateDiff> {
  const validated = validateMutation(proposal);
  if (!validated.valid) throw new Error(validated.error);
  const before = await stateFor(run);
  const proposed = event(run.id, "mutation_proposed", "Deterministic Second Brain proposed a context-point change.", before.stateVersion, {
    sourceEventId: source.id, detail: JSON.stringify(proposal), mutationType: proposal.type, relatedStateKeys: "key" in proposal ? [proposal.key] : undefined
  });
  await run.store.appendEvent(proposed);
  const result = applyMutation(before, validated.mutation, new Date().toISOString(), source.id);
  result.diff.mutationProposalEventId = proposed.id;
  await run.store.saveState(result.state);
  await run.store.appendDiff(result.diff);
  await run.store.appendEvent(event(run.id, "mutation_applied", result.diff.subject, result.state.stateVersion, {
    sourceEventId: source.id, mutationProposalEventId: proposed.id, mutationType: result.diff.mutationType, detail: result.diff.reason
  }));
  return result.diff;
}
async function requireState(run: RobloxRun, condition: (state: AgentState) => boolean, message: string): Promise<AgentState> {
  const state = await stateFor(run);
  if (!condition(state)) throw new Error(message);
  return state;
}

export async function prepareRobloxCheckpoint(run: RobloxRun) {
  await inspectRobloxMap(run);
  await decideRedSpawn(run);
  await recordTraversalProgress(run);
  await observation(run, "action_observed", "Red spawn corrected; traversal 42/48; Blue spawn verification remains.", { detail: "roblox-stage:prepared" });
  return stateFor(run);
}

export async function inspectRobloxMap(run: RobloxRun) {
  await requireState(run, (state) => state.stateVersion === 1 && active(state, "red_spawn_exposed") === "true", "ROBLOX MISSION NOT READY");
  const source = await observation(run, "tool_result", "Controlled map inspection: Red spawn is exposed to Mid Lane.", { relatedStateKeys: ["red_spawn_exposed"] });
  await mutate(run, { type: "ADD_OPEN_LOOP", text: "Fix Red spawn exposure.", reason: "Direct spawn-to-mid sightline observed." }, source);
  return stateFor(run);
}

export async function decideRedSpawn(run: RobloxRun) {
  const state = await requireState(run, (value) => active(value, "red_spawn_exposed") === "true" && value.openLoops.some((loop) => loop.status === "active" && loop.text === "Fix Red spawn exposure."), "RED SPAWN DECISION NOT READY");
  const source = await observation(run, "tool_result", "Controlled map change: Red spawn moved behind House B cover.", { relatedStateKeys: ["red_spawn_exposed"] });
  await observation(run, "second_brain_analysis", "Red spawn correction classified as durable context.", { role: "second", provider: "deterministic", sourceEventId: source.id });
  await mutate(run, { type: "SUPERSEDE_FACT", key: "red_spawn_exposed", oldValue: "true", newValue: "false", reason: "Controlled map inspection placed Red spawn behind House B cover." }, source);
  await mutate(run, { type: "ADD_DECISION", text: "Move Red spawn behind House B cover.", reason: "Block direct spawn-to-mid sightline." }, source);
  await mutate(run, { type: "RESOLVE_OPEN_LOOP", id: state.openLoops.find((loop) => loop.status === "active" && loop.text === "Fix Red spawn exposure.")!.id, reason: "Red spawn repositioned behind cover." }, source);
  return stateFor(run);
}

export async function recordTraversalProgress(run: RobloxRun) {
  await requireState(run, (state) => active(state, "red_spawn_exposed") === "false" && active(state, "traversal_tests_passed") === "0", "TRAVERSAL NOT READY");
  const source = await observation(run, "tool_result", "Controlled traversal checks pass 42 of 48; Blue spawn sightline remains unverified.", { relatedStateKeys: ["traversal_tests_passed", "blue_spawn"] });
  for (const proposal of [
    { type: "UPDATE_FACT", key: "traversal_tests_passed", value: "42", reason: "Controlled traversal test passed 42 of 48 checks." },
    { type: "ADD_OPEN_LOOP", text: "Verify Blue spawn sightline.", reason: "Six traversal checks remain and Blue spawn needs confirmation." },
    { type: "ADD_NEXT_ACTION", text: "Run Blue spawn verification.", reason: "Continue the unresolved map test after checkpoint." }
  ] as Mutation[]) await mutate(run, proposal, source);
  return stateFor(run);
}

export async function robloxWorkerContext(run: RobloxRun) {
  const state = await stateFor(run);
  const compiled = compileContext(state, []);
  return { pid: process.pid, stateVersion: state.stateVersion, compiledContext: compiled.text, estimatedTokens: compiled.compiledTokens, historyEventsReplayed: 0 as const,
    openLoop: activeLoop(state)?.text ?? null, nextAction: activeAction(state)?.text ?? null,
    redSpawnExposed: active(state, "red_spawn_exposed"), traversalPassed: active(state, "traversal_tests_passed") };
}

export async function continueRobloxMission(run: RobloxRun) {
  const context = await robloxWorkerContext(run);
  if (context.openLoop !== "Verify Blue spawn sightline." || context.nextAction !== "Run Blue spawn verification." || context.redSpawnExposed !== "false" || context.traversalPassed !== "42" ||
      !context.compiledContext.includes("Blue spawn verification") || !context.compiledContext.includes("Move Red spawn behind House B cover.")) throw new Error("RESTORED ROBLOX CONTEXT INCOMPLETE");
  await observation(run, "context_compiled", "Fresh worker received compiled canonical Roblox context, with zero historical replay.", { workerPid: process.pid, compiledContextTokensEstimate: context.estimatedTokens, rawHistoryTokensEstimate: 0 });
  const source = await observation(run, "first_brain_output", "Blue spawn sightline verification PASS; pending map task completed.", { role: "first", provider: "deterministic", workerPid: process.pid, relatedStateKeys: ["blue_spawn"] });
  await observation(run, "second_brain_analysis", "Verification resolves the open loop and updates durable map state.", { role: "second", provider: "deterministic", sourceEventId: source.id });
  const state = await stateFor(run);
  await mutate(run, { type: "RESOLVE_OPEN_LOOP", id: activeLoop(state)!.id, reason: "Blue spawn sightline passed after restore." }, source);
  await mutate(run, { type: "REMOVE_NEXT_ACTION", id: activeAction(state)!.id, reason: "Blue spawn verification completed." }, source);
  await mutate(run, { type: "ADD_FACT", key: "blue_spawn_verified", value: "true", reason: "Fresh worker completed the pending sightline check." }, source);
  const continued = await stateFor(run);
  await observation(run, "mission_continued", `Fresh worker continued the Roblox mission at state #${continued.stateVersion}.`, { workerPid: process.pid });
  return { stateVersion: continued.stateVersion, verified: active(continued, "blue_spawn_verified") === "true", pid: process.pid };
}

export async function supersedeRobloxRequirement(run: RobloxRun) {
  await requireState(run, (state) => active(state, "blue_spawn_verified") === "true" && active(state, "spawn_clearance") === "24", "ROBLOX REQUIREMENT NOT READY");
  const source = await observation(run, "tool_result", "Controlled design requirement changed: minimum spawn clearance is now 32 units.", { relatedStateKeys: ["spawn_clearance"], actual: { spawn_clearance: "32" } });
  const diff = await mutate(run, { type: "SUPERSEDE_FACT", key: "spawn_clearance", oldValue: "24", newValue: "32", reason: "Current map design requirement supersedes the old clearance." }, source);
  await observation(run, "action_observed", "Current clearance is 32; old value 24 remains historical.", { detail: "roblox-stage:requirement" });
  const context = compileContext(await stateFor(run), []);
  if (!context.text.includes("spawn_clearance = 32") || context.text.includes("spawn_clearance = 24")) throw new Error("STALE CLEARANCE IN ACTIVE CONTEXT");
  return diff;
}

export async function injectRobloxFault(run: RobloxRun) {
  await requireState(run, (state) => active(state, "spawn_clearance") === "32" && active(state, "blue_spawn") === "north", "ROBLOX FAULT NOT READY");
  const source = await observation(run, "tool_result", "Controlled stale map configuration reported Blue spawn at east; this fixture is intentionally wrong.", { relatedStateKeys: ["blue_spawn"], actual: { blue_spawn: "east" } });
  const diff = await mutate(run, { type: "SUPERSEDE_FACT", key: "blue_spawn", oldValue: "north", newValue: "east", reason: "Stale map configuration was incorrectly promoted to canonical state." }, source);
  await observation(run, "action_observed", "Controlled stale Blue spawn context point entered canonical state.", { detail: "roblox-stage:fault" });
  return diff;
}

export async function failRobloxVerification(run: RobloxRun): Promise<AgentEvent> {
  const state = await requireState(run, (value) => active(value, "blue_spawn") === "east" && active(value, "blue_spawn_verified") === "true", "ROBLOX FAILURE NOT READY");
  const selected = active(state, "blue_spawn")!;
  const target = await observation(run, "action_observed", `Spawn target selected from canonical state: ${selected}.`, { relatedStateKeys: ["blue_spawn"], actual: { blue_spawn: selected } });
  await mutate(run, { type: "ADD_FACT", key: "blue_spawn_target", value: selected, reason: "Verification target read from active canonical blue_spawn." }, target);
  await observation(run, "action_observed", `Sightline test command constructed for Blue spawn ${selected}.`, { relatedStateKeys: ["blue_spawn"], actual: { blue_spawn: selected }, sourceEventId: target.id });
  const check = await observation(run, "tool_result", `Controlled sightline check expected north, received ${selected}.`, { relatedStateKeys: ["blue_spawn"], expected: { blue_spawn: "north" }, actual: { blue_spawn: selected } });
  await mutate(run, { type: "ADD_FACT", key: "sightline_check", value: "failed", reason: "Selected Blue spawn did not match the approved map configuration." }, check);
  const failure = await observation(run, "mission_failure", "Blue spawn verification failed: stale target selected.", { relatedStateKeys: ["blue_spawn"], expected: { blue_spawn: "north" }, actual: { blue_spawn: selected }, sourceEventId: check.id });
  return failure;
}

export function robloxStage(events: AgentEvent[], report: AutopsyReport | null): RobloxStage {
  if (report) return "autopsied";
  if (events.some((entry) => entry.type === "mission_failure")) return "failure";
  if (events.some((entry) => entry.detail === "roblox-stage:fault")) return "fault";
  if (events.some((entry) => entry.detail === "roblox-stage:requirement")) return "requirement";
  if (events.some((entry) => entry.type === "mission_continued")) return "continued";
  if (events.some((entry) => entry.type === "savepoint_restored")) return "restored";
  if (events.some((entry) => entry.type === "worker_lost")) return "lost";
  if (events.some((entry) => entry.type === "savepoint_created")) return "saved";
  if (events.some((entry) => entry.detail === "roblox-stage:prepared")) return "prepared";
  return events.some((entry) => entry.type === "scenario_started") ? "started" : "empty";
}

export async function loadRobloxDashboard(baseDirectory = robloxBaseDirectory): Promise<RobloxDashboardData | null> {
  const run = await currentRobloxRun(baseDirectory);
  if (!run) return null;
  const [state, events, diffs, savepointId, continuity, report] = await Promise.all([
    run.store.loadState(), run.store.loadEvents(), run.store.loadDiffs(), latestSavepoint(run.store), readContinuityStatus(run.store), latestAutopsyReport(run.store)
  ]);
  if (!state) throw new Error("ROBLOX STATE NOT FOUND");
  const savepoint = savepointId ? (await readVerifiedSavepoint(run.store, savepointId)).savepoint : null;
  const originBefore = report?.recommendedHealthyVersion ? await run.store.getStateAtVersion(report.recommendedHealthyVersion) : null;
  const originAfter = report?.suspectedOrigin?.stateVersion ? await run.store.getStateAtVersion(report.suspectedOrigin.stateVersion) : null;
  return { runId: run.id, stage: robloxStage(events, report), state, events, diffs, savepoint, continuity, report,
    failure: [...events].reverse().find((entry) => entry.type === "mission_failure") ?? null, originBefore, originAfter };
}
