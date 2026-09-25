import { randomUUID } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { applyMutation } from "../packages/core/mutations";
import { activeFacts, AgentEvent, AgentState } from "../packages/core/state";
import { JsonFileStorage } from "../packages/core/storage";
import { Mutation, validateMutation } from "../packages/core/validation";
import { createTelemetryPipeline } from "../packages/telemetry";

export const autopsyBaseDirectory = process.env.CONTEXTOS_DATA_DIR ?? resolve(process.cwd(), "data");
export interface AutopsyRun { id: string; directory: string; store: JsonFileStorage; failureEvent: AgentEvent }
function makeEvent(type: AgentEvent["type"], message: string, stateVersion: number, extra: Partial<AgentEvent> = {}): AgentEvent {
  return { id: randomUUID(), type, timestamp: new Date().toISOString(), message, stateVersion, ...extra };
}
export async function currentAutopsyRun(baseDirectory = autopsyBaseDirectory): Promise<{ id: string; store: JsonFileStorage } | null> {
  try {
    const pointer = JSON.parse(await readFile(join(baseDirectory, "autopsy-current.json"), "utf8")) as { id: string };
    if (!/^run-[a-f0-9-]{36}$/.test(pointer.id)) throw new Error("AUTOPSY RUN INVALID");
    return { id: pointer.id, store: new JsonFileStorage(join(baseDirectory, "autopsy-runs", pointer.id)) };
  } catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return null; throw error; }
}
export async function runAutopsyScenario(baseDirectory = autopsyBaseDirectory): Promise<AutopsyRun> {
  const id = `run-${randomUUID()}`;
  const directory = join(baseDirectory, "autopsy-runs", id);
  const store = new JsonFileStorage(directory, createTelemetryPipeline(baseDirectory));
  const now = new Date().toISOString();
  let state: AgentState = {
    mission: "Deploy the application to the configured production region.",
    currentGoal: "Build and deploy to the approved production region.",
    facts: [{ id: "fact-region", key: "deployment_region", value: "us-west-2", status: "active", createdAt: now, updatedAt: now }],
    constraints: [{ id: "constraint-region", text: "Production deployment must target the approved us-west-2 region.", status: "active", createdAt: now, updatedAt: now }],
    decisions: [], openLoops: [], nextActions: [], artifacts: [], stateVersion: 1, completedTurns: 0, createdAt: now, updatedAt: now
  };
  await store.reset(state, makeEvent("scenario_started", "Deployment autopsy scenario started; approved region is us-west-2.", 1, { mode: "DEMO", runId: id, scenario: "autopsy" }));
  async function mutate(proposal: Mutation, source: AgentEvent) {
    const validated = validateMutation(proposal);
    if (!validated.valid) throw new Error(validated.error);
    const proposed = makeEvent("mutation_proposed", "Second Brain proposed a state change", state.stateVersion, { sourceEventId: source.id, detail: JSON.stringify(proposal), mutationType: proposal.type, relatedStateKeys: "key" in proposal ? [proposal.key] : undefined });
    await store.appendEvent(proposed);
    const result = applyMutation(state, validated.mutation, new Date().toISOString(), source.id);
    result.diff.mutationProposalEventId = proposed.id;
    state = result.state;
    await store.saveState(state);
    await store.appendDiff(result.diff);
    await store.appendEvent(makeEvent("mutation_applied", result.diff.subject, state.stateVersion, { sourceEventId: source.id, mutationProposalEventId: proposed.id, mutationType: result.diff.mutationType, detail: result.diff.reason }));
  }
  const healthy = makeEvent("tool_result", "Approved deployment configuration confirms us-west-2.", 1, { relatedStateKeys: ["deployment_region"], actual: { deployment_region: "us-west-2" } });
  await store.appendEvent(healthy);
  await mutate({ type: "ADD_FACT", key: "deployment_status", value: "pending", reason: "Deployment has not started." }, healthy); // #2
  await mutate({ type: "ADD_DECISION", text: "Deploy using the approved production configuration.", reason: "Production configuration is approved." }, healthy); // #3
  await mutate({ type: "ADD_OPEN_LOOP", text: "Confirm the deployment target before execution.", reason: "Target must be checked at deploy time." }, healthy); // #4
  await mutate({ type: "ADD_NEXT_ACTION", text: "Build and deploy the application.", reason: "Preparation is complete." }, healthy); // #5
  const stale = makeEvent("tool_result", "Old cached deployment configuration reported us-east-1.", 5, { relatedStateKeys: ["deployment_region"], actual: { deployment_region: "us-east-1" } });
  await store.appendEvent(stale);
  await mutate({ type: "SUPERSEDE_FACT", key: "deployment_region", oldValue: "us-west-2", newValue: "us-east-1", reason: "Cached deployment configuration observed." }, stale); // #6
  const build = makeEvent("action_observed", "Build completed successfully.", 6, { relatedStateKeys: ["deployment_status"] });
  await store.appendEvent(build);
  await mutate({ type: "UPDATE_FACT", key: "deployment_status", value: "built", reason: "Build artifact is ready." }, build); // #7
  const selected = activeFacts(state).find((fact) => fact.key === "deployment_region")?.value;
  if (!selected) throw new Error("Deployment region missing");
  const target = makeEvent("action_observed", `Deployment target selected from canonical state: ${selected}.`, 7, { relatedStateKeys: ["deployment_region"], actual: { deployment_region: selected } });
  await store.appendEvent(target);
  await mutate({ type: "ADD_FACT", key: "deployment_target", value: selected, reason: "Target read from active canonical deployment_region." }, target); // #8
  await store.appendEvent(makeEvent("action_observed", `Deployment command constructed for ${selected}.`, 8, { relatedStateKeys: ["deployment_region"], actual: { deployment_region: selected }, sourceEventId: target.id }));
  const check = makeEvent("tool_result", `Deployment validation expected us-west-2 but received ${selected}.`, 8, { relatedStateKeys: ["deployment_region"], expected: { deployment_region: "us-west-2" }, actual: { deployment_region: selected } });
  await store.appendEvent(check);
  await mutate({ type: "UPDATE_FACT", key: "deployment_status", value: "failed", reason: "Deployment validation rejected the selected region." }, check); // #9
  const failureEvent = makeEvent("mission_failure", "Deployment targeted incorrect region.", 9, { relatedStateKeys: ["deployment_region"], expected: { deployment_region: "us-west-2" }, actual: { deployment_region: selected }, sourceEventId: check.id });
  await store.appendEvent(failureEvent);
  await mkdir(baseDirectory, { recursive: true });
  const temporary = join(baseDirectory, `.autopsy-current.${process.pid}.${randomUUID()}.tmp`);
  await writeFile(temporary, JSON.stringify({ id, updatedAt: new Date().toISOString() }) + "\n");
  await rename(temporary, join(baseDirectory, "autopsy-current.json"));
  return { id, directory, store, failureEvent };
}
