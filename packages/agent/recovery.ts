import { randomUUID } from "node:crypto";
import { compileContext } from "../core/compiler";
import { applyMutation } from "../core/mutations";
import { activeFacts, AgentEvent, AgentState } from "../core/state";
import { JsonFileStorage } from "../core/storage";
import { DemoFirstBrain } from "./first-brain";
import { advanceDemo, advanceWithProviders, loadDashboard, resetDemo } from "./runtime";

function log(type: AgentEvent["type"], message: string, stateVersion: number): AgentEvent { return { id: randomUUID(), type, timestamp: new Date().toISOString(), message, stateVersion, mode: "DEMO" }; }
export async function prepareRecoveryMidpoint(store: JsonFileStorage) {
  await resetDemo(store);
  await advanceDemo(store);
  await advanceDemo(store);
  let state = await store.loadState() as AgentState;
  for (const mutation of [
    { type: "ADD_OPEN_LOOP", text: "Verify final generation endpoint.", reason: "API v2 choice still needs endpoint verification." },
    { type: "ADD_NEXT_ACTION", text: "Run endpoint verification.", reason: "Continue integration after the version decision." }
  ] as const) {
    const result = applyMutation(state, mutation, new Date().toISOString());
    state = result.state;
    await store.saveState(state);
    await store.appendDiff(result.diff);
    await store.appendEvent(log("mutation_applied", result.diff.subject, state.stateVersion));
  }
  return { stateVersion: state.stateVersion, apiVersion: activeFacts(state).find((fact) => fact.key === "api_version")?.value, openLoops: state.openLoops.filter((x) => x.status === "active").length, nextAction: state.nextActions.find((x) => x.status === "active")?.text };
}
export async function recoveryContext(store: JsonFileStorage) {
  const state = await store.loadState();
  if (!state) throw new Error("Canonical state missing");
  const compiled = compileContext(state, []);
  return { pid: process.pid, stateVersion: state.stateVersion, apiVersion: activeFacts(state).find((x) => x.key === "api_version")?.value, openLoops: state.openLoops.filter((x) => x.status === "active").length, nextAction: state.nextActions.find((x) => x.status === "active")?.text, compiledContext: compiled.text, estimatedTokens: compiled.compiledTokens, historyEventsReplayed: 0 };
}
export async function continueRecoveryMission(store: JsonFileStorage) {
  const before = await recoveryContext(store);
  if (before.apiVersion !== "v2" || !before.compiledContext.includes("Run endpoint verification.")) throw new Error("Restored context is missing mission state");
  const pair = { first: new DemoFirstBrain(), second: { id: "deterministic", model: "recovery-v1", async analyze(input: { state: AgentState }) {
    return { classification: "ENDPOINT VERIFIED", analysis: "API v2 endpoint verification completed from restored canonical context.", mutations: [
      ...input.state.openLoops.filter((x) => x.status === "active").map((x) => ({ type: "RESOLVE_OPEN_LOOP", id: x.id, reason: "Generation endpoint verified." })),
      ...input.state.nextActions.filter((x) => x.status === "active").map((x) => ({ type: "REMOVE_NEXT_ACTION", id: x.id, reason: "Verification action completed." })),
      { type: "ADD_DECISION", text: "API v2 generation endpoint verified after recovery.", reason: "Fresh worker completed the pending verification." }
    ] };
  } } };
  const result = await advanceWithProviders(store, pair);
  await store.appendEvent(log("mission_continued", `MISSION CONTINUED / STATE #${result.state.stateVersion}`, result.state.stateVersion));
  const data = await loadDashboard(store);
  return { stateVersion: data.state.stateVersion, completedTurns: data.completedTurns, apiVersion: activeFacts(data.state).find((x) => x.key === "api_version")?.value, openLoops: data.state.openLoops.filter((x) => x.status === "active").length, verified: data.state.decisions.some((x) => x.status === "active" && x.text.includes("verified after recovery")), workerOutput: [...data.events].reverse().find((x) => x.type === "first_brain_output")?.detail };
}
