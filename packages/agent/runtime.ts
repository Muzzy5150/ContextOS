import { resolve } from "node:path";
import { compileContext } from "../core/compiler";
import { applyMutation } from "../core/mutations";
import { createInitialState, AgentEvent, AgentState, StateDiff } from "../core/state";
import { JsonFileStorage, StateStorage } from "../core/storage";
import { Mutation, validateMutation } from "../core/validation";
import { scenarioTasks } from "../../scenarios/api-migration";
import { createBrainPair, pairDisplay, runtimeDisplay, RuntimeDisplay, BrainPair } from "./config";
import { ProviderError } from "./http-provider";
import { SecondBrainParseError } from "./live-brains";
import { ModelResult, RuntimeMode, SecondBrainProvider } from "./provider";
import { createTelemetryPipeline } from "../telemetry";

const dataDirectory = process.env.CONTEXTOS_DATA_DIR ?? resolve(process.cwd(), "data");
export const storage: StateStorage = new JsonFileStorage(dataDirectory, createTelemetryPipeline(dataDirectory));
const event = (type: AgentEvent["type"], message: string, extra: Partial<AgentEvent> = {}): AgentEvent => ({ id: crypto.randomUUID(), type, timestamp: new Date().toISOString(), message, ...extra });
const safeRaw = (text: string) => text.slice(0, 12_000);
function failure(error: unknown): { code: string; message: string } {
  if (error instanceof ProviderError) return { code: error.code, message: error.message };
  if (error instanceof SecondBrainParseError) return { code: "INVALID_RESPONSE", message: error.reason };
  return { code: "PROVIDER_ERROR", message: "Model request failed" };
}
function usage(result: ModelResult): Partial<AgentEvent> {
  return { provider: result.provider, model: result.model, latencyMs: result.latencyMs, inputCharacters: result.inputCharacters, outputCharacters: result.outputCharacters, inputTokens: result.inputTokens, outputTokens: result.outputTokens, estimatedInputTokens: result.estimatedInputTokens, estimatedOutputTokens: result.estimatedOutputTokens };
}
export interface DashboardData { state: AgentState; events: AgentEvent[]; diffs: StateDiff[]; context: ReturnType<typeof compileContext>; completedTurns: number; mode: RuntimeMode; providers: Pick<RuntimeDisplay, "first" | "second">; liveReady: boolean }
export async function resetScenario(mode: RuntimeMode, store: StateStorage = storage, env: NodeJS.ProcessEnv = process.env): Promise<DashboardData> {
  const display = pairDisplay(mode, env);
  if (mode === "LIVE" && (!display.first.ready || !display.second.ready)) throw new ProviderError("PROVIDER_ERROR", display.first.issue ?? display.second.issue ?? "Live providers are not configured");
  const now = new Date().toISOString();
  await store.reset(createInitialState(now), event("scenario_started", "API migration scenario initialized with api_version = v1", { runId: crypto.randomUUID(), scenario: "api_migration", mode, stateVersion: 1, firstProvider: display.first.provider, firstModel: display.first.model, secondProvider: display.second.provider, secondModel: display.second.model }));
  return loadDashboard(store, env);
}
export const resetDemo = (store: StateStorage = storage) => resetScenario("DEMO", store);
export async function loadDashboard(store: StateStorage = storage, env: NodeJS.ProcessEnv = process.env): Promise<DashboardData> {
  const state = await store.loadState();
  if (!state) { const configured = runtimeDisplay(env); return resetScenario(configured.mode === "LIVE" && configured.liveReady ? "LIVE" : "DEMO", store, env); }
  const [events, diffs] = await Promise.all([store.loadEvents(), store.loadDiffs()]);
  const start = events.find((entry) => entry.type === "scenario_started");
  const mode: RuntimeMode = start?.mode === "LIVE" ? "LIVE" : "DEMO";
  const legacy = !start?.mode;
  const completedTurns = state.completedTurns ?? events.filter((entry) => entry.type === (legacy ? "first_brain_output" : "turn_completed")).length;
  const providers = start?.firstProvider ? { first: { provider: start.firstProvider, model: start.firstModel ?? "unknown", ready: true }, second: { provider: start.secondProvider ?? "unknown", model: start.secondModel ?? "unknown", ready: true } } : pairDisplay(mode, env);
  return { state, events, diffs, context: compileContext(state, events), completedTurns, mode, providers, liveReady: runtimeDisplay(env).liveReady };
}
export async function advanceWithProviders(store: StateStorage, pair: BrainPair, env: NodeJS.ProcessEnv = process.env): Promise<DashboardData> {
  const dashboard = await loadDashboard(store, env);
  const turn = dashboard.completedTurns + 1;
  if (turn > scenarioTasks.length) return dashboard;
  const task = scenarioTasks[turn - 1];
  const restoreIndex = dashboard.events.map((entry) => entry.type).lastIndexOf("savepoint_restored");
  let workerEvent = dashboard.events.slice(restoreIndex + 1).find((entry) => entry.type === "first_brain_output" && entry.turn === turn);
  if (!workerEvent) {
    const compiled = dashboard.context;
    await store.appendEvent(event("context_compiled", "Working context compiled from canonical state", { turn, stateVersion: dashboard.state.stateVersion, rawHistoryCharacters: compiled.rawHistoryCharacters, compiledContextCharacters: compiled.compiledCharacters, rawHistoryTokensEstimate: compiled.rawHistoryTokens, compiledContextTokensEstimate: compiled.compiledTokens }));
    await store.appendEvent(event("first_brain_input", task, { turn, detail: compiled.text, stateVersion: dashboard.state.stateVersion }));
    if (dashboard.mode === "LIVE") await store.appendEvent(event("model_request_started", "FIRST BRAIN / MODEL REQUEST", { turn, role: "first", provider: pair.first.id, model: pair.first.model, stateVersion: dashboard.state.stateVersion }));
    try {
      const output = await pair.first.respond({ compiledContext: compiled.text, task, turn });
      if (dashboard.mode === "LIVE" && output.result) await store.appendEvent(event("model_request_completed", "FIRST BRAIN / RESPONSE RECEIVED", { turn, role: "first", stateVersion: dashboard.state.stateVersion, ...usage(output.result) }));
      workerEvent = event("first_brain_output", output.activity, { turn, detail: output.message, stateVersion: dashboard.state.stateVersion, provider: pair.first.id, model: pair.first.model, mode: dashboard.mode });
      await store.appendEvent(workerEvent);
    } catch (error) {
      const fail = failure(error);
      await store.appendEvent(event("model_request_failed", `FIRST BRAIN / ${fail.code}`, { turn, role: "first", provider: pair.first.id, model: pair.first.model, errorCode: fail.code, detail: fail.message, stateVersion: dashboard.state.stateVersion }));
      return loadDashboard(store, env);
    }
  }
  const [currentState, recentDiffs] = await Promise.all([store.loadState(), store.loadDiffs()]);
  if (!currentState) throw new Error("Canonical state disappeared during turn");
  if (dashboard.mode === "LIVE" || pair.second.id !== "deterministic") await store.appendEvent(event("model_request_started", "SECOND BRAIN / MODEL REQUEST", { turn, role: "second", provider: pair.second.id, model: pair.second.model, stateVersion: currentState.stateVersion }));
  let maintenance;
  try {
    maintenance = await pair.second.analyze({ state: currentState, workerEvent, observation: workerEvent.detail ?? "", evidence: task, recentDiffs, turn });
    if (maintenance.result) await store.appendEvent(event("model_request_completed", "SECOND BRAIN / RESPONSE RECEIVED", { turn, role: "second", stateVersion: currentState.stateVersion, ...usage(maintenance.result) }));
  } catch (error) {
    const fail = failure(error);
    if (error instanceof SecondBrainParseError) {
      if (error.result) await store.appendEvent(event("model_request_completed", "SECOND BRAIN / RESPONSE RECEIVED", { turn, role: "second", stateVersion: currentState.stateVersion, ...usage(error.result) }));
      await store.appendEvent(event("second_brain_parse_failed", fail.message, { turn, role: "second", provider: pair.second.id, model: pair.second.model, errorCode: fail.code, detail: safeRaw(error.rawOutput), stateVersion: currentState.stateVersion }));
    } else await store.appendEvent(event("model_request_failed", `SECOND BRAIN / ${fail.code}`, { turn, role: "second", provider: pair.second.id, model: pair.second.model, errorCode: fail.code, detail: fail.message, stateVersion: currentState.stateVersion }));
    return loadDashboard(store, env);
  }
  await store.appendEvent(event("second_brain_analysis", maintenance.classification, { turn, detail: maintenance.analysis, provider: pair.second.id, model: pair.second.model, mode: dashboard.mode }));
  const validated: Mutation[] = [];
  const proposedIds: string[] = [];
  let invalid = false;
  for (const proposal of maintenance.mutations) {
    const candidate = proposal && typeof proposal === "object" ? proposal as Record<string, unknown> : {};
    const mutationType = typeof candidate.type === "string" ? candidate.type : undefined;
    const relatedStateKeys = typeof candidate.key === "string" ? [candidate.key] : undefined;
    const proposalEvent = event("mutation_proposed", "Second Brain proposed a state change", { turn, detail: JSON.stringify(proposal), sourceEventId: workerEvent.id, mutationType, relatedStateKeys });
    await store.appendEvent(proposalEvent);
    const result = validateMutation(proposal);
    if (!result.valid) {
      invalid = true;
      await store.appendEvent(event("mutation_validation_failed", result.error, { turn, role: "second", detail: JSON.stringify(proposal), stateVersion: currentState.stateVersion }));
      await store.appendEvent(event("mutation_rejected", result.error, { turn, detail: JSON.stringify(proposal), stateVersion: currentState.stateVersion, mutationType, relatedStateKeys }));
    } else { validated.push(result.mutation); proposedIds.push(proposalEvent.id); }
  }
  if (invalid) return loadDashboard(store, env);
  let next = currentState;
  const applied: StateDiff[] = [];
  const historicalStates: AgentState[] = [];
  try {
    for (const [index, mutation] of validated.entries()) { const result = applyMutation(next, mutation, new Date().toISOString(), workerEvent.id); result.diff.mutationProposalEventId = proposedIds[index]; next = result.state; applied.push(result.diff); historicalStates.push(result.state); }
  } catch (error) {
    const message = error instanceof Error ? error.message : "Mutation failed precondition";
    await store.appendEvent(event("mutation_validation_failed", message, { turn, role: "second", stateVersion: currentState.stateVersion }));
    await store.appendEvent(event("mutation_rejected", message, { turn, stateVersion: currentState.stateVersion }));
    return loadDashboard(store, env);
  }
  if (applied.length) {
    await store.saveState(next);
    for (const historical of historicalStates) await store.saveHistoricalState?.(historical);
    for (const diff of applied) {
      await store.appendDiff(diff);
      await store.appendEvent(event("mutation_applied", diff.subject, { turn, detail: diff.reason, mutationType: diff.mutationType, stateVersion: diff.stateVersion, sourceEventId: diff.sourceEventId, mutationProposalEventId: diff.mutationProposalEventId }));
    }
    await store.appendEvent(event("state_updated", `Canonical state advanced to #${next.stateVersion}`, { turn, stateVersion: next.stateVersion }));
  }
  next.completedTurns = turn;
  await store.saveState(next);
  await store.appendEvent(event("turn_completed", `Turn ${turn} completed`, { turn, stateVersion: next.stateVersion, mode: dashboard.mode }));
  return loadDashboard(store, env);
}
export async function advanceCurrent(store: StateStorage = storage, env: NodeJS.ProcessEnv = process.env): Promise<DashboardData> {
  const dashboard = await loadDashboard(store, env);
  try { return await advanceWithProviders(store, createBrainPair(dashboard.mode, env), env); }
  catch (error) {
    if (!(error instanceof ProviderError)) throw error;
    const fail = failure(error);
    await store.appendEvent(event("model_request_failed", fail.message, { turn: dashboard.completedTurns + 1, errorCode: fail.code, role: "first", stateVersion: dashboard.state.stateVersion }));
    return loadDashboard(store, env);
  }
}
export async function advanceDemo(store: StateStorage = storage, maintainer?: SecondBrainProvider): Promise<DashboardData> {
  if ((await loadDashboard(store)).mode !== "DEMO") throw new Error("Cannot run deterministic providers in a LIVE scenario");
  const pair = createBrainPair("DEMO"); if (maintainer) pair.second = maintainer;
  return advanceWithProviders(store, pair);
}
export async function runFullDemo(store: StateStorage = storage): Promise<DashboardData> {
  await resetDemo(store);
  for (let turn = 0; turn < scenarioTasks.length; turn++) await advanceDemo(store);
  return loadDashboard(store);
}
export async function runFullLive(store: StateStorage = storage, env: NodeJS.ProcessEnv = process.env): Promise<DashboardData> {
  await resetScenario("LIVE", store, env);
  for (let turn = 0; turn < scenarioTasks.length; turn++) {
    const before = (await loadDashboard(store, env)).completedTurns;
    const after = await advanceCurrent(store, env);
    if (after.completedTurns === before) return after;
  }
  return loadDashboard(store, env);
}
