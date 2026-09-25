import { resolve } from "node:path";
import { applyMutation } from "../core/mutations";
import { AgentEvent, AgentState, StateDiff, activeFacts, createInitialState } from "../core/state";
import { JsonFileStorage } from "../core/storage";
import { validateMutation } from "../core/validation";
import { createLiveSecondBrain, runtimeDisplay } from "./config";
import { DeterministicEvidenceProvider, EvidenceError, EvidenceProvider, NimbleEvidenceProvider, nimbleStatus } from "./evidence";
import { SecondBrainProvider, MaintainerOutput, RuntimeMode } from "./provider";
import { createTelemetryPipeline } from "../telemetry";

const directory = resolve(process.env.CONTEXTOS_DATA_DIR ?? resolve(process.cwd(), "data"), "revalidation");
export const revalidationStore = new JsonFileStorage(directory, createTelemetryPipeline(directory));
const event = (type: AgentEvent["type"], message: string, extra: Partial<AgentEvent> = {}): AgentEvent => ({ id: crypto.randomUUID(), type, timestamp: new Date().toISOString(), message, scenario: "fact_revalidation", ...extra });

export class DeterministicRevalidationSecondBrain implements SecondBrainProvider {
  readonly id = "deterministic";
  readonly model = "revalidation-v1";
  async analyze(input: Parameters<SecondBrainProvider["analyze"]>[0]): Promise<MaintainerOutput> {
    const evidence = input.workerEvent.structuredEvidence;
    const key = input.workerEvent.factKey;
    const fact = activeFacts(input.state).find((entry) => entry.key === key);
    const value = key ? evidence?.[key] : undefined;
    if (!fact || !value) throw new Error("EVIDENCE INVALID");
    return { classification: "FRESH EVIDENCE", analysis: "Fresh evidence was checked against the stale canonical fact.", mutations: [fact.value === value ? { type: "UPDATE_FACT", key, value, reason: "Fresh evidence confirmed the durable fact." } : { type: "SUPERSEDE_FACT", key, oldValue: fact.value, newValue: value, reason: "Fresh evidence changed the durable fact." }] };
  }
}

export interface RevalidationDashboard { state: AgentState; events: AgentEvent[]; diffs: StateDiff[]; mode: RuntimeMode; provider: "deterministic" | "nimble" }
export async function loadRevalidationDashboard(store: JsonFileStorage = revalidationStore): Promise<RevalidationDashboard | null> {
  const state = await store.loadState();
  if (!state) return null;
  const [events, diffs] = await Promise.all([store.loadEvents(), store.loadDiffs()]);
  const start = events.find((entry) => entry.type === "scenario_started");
  const mode: RuntimeMode = start?.mode === "LIVE" ? "LIVE" : "DEMO";
  return { state, events, diffs, mode, provider: mode === "LIVE" ? "nimble" : "deterministic" };
}
export function revalidationLiveReady(env: NodeJS.ProcessEnv = process.env): boolean {
  return nimbleStatus(env).configured && runtimeDisplay(env).second.ready;
}
export async function startRevalidationScenario(mode: RuntimeMode = "DEMO", store: JsonFileStorage = revalidationStore, env: NodeJS.ProcessEnv = process.env): Promise<RevalidationDashboard> {
  if (mode === "LIVE" && !revalidationLiveReady(env)) throw new EvidenceError("NOT_CONFIGURED", "Nimble and a LIVE Second Brain must both be configured");
  const now = new Date().toISOString();
  const state = createInitialState(now);
  state.mission = "Revalidate a stale external API fact.";
  state.currentGoal = "Check whether the remembered API version is still current.";
  state.facts[0].sourceUrl = mode === "LIVE" ? nimbleStatus(env).sourceUrl : "https://example.org/contextos-demo-api-version";
  state.facts[0].observedAt = new Date(Date.now() - 24 * 3600 * 1000).toISOString();
  state.facts[0].freshness = { status: "stale" };
  await store.reset(state, event("scenario_started", "Stale api_version = v1 fact seeded", { mode, stateVersion: 1, runId: crypto.randomUUID(), secondProvider: mode === "LIVE" ? runtimeDisplay(env).second.provider : "deterministic", secondModel: mode === "LIVE" ? runtimeDisplay(env).second.model : "revalidation-v1" }));
  return (await loadRevalidationDashboard(store))!;
}
export async function revalidateFact(store: JsonFileStorage = revalidationStore, options: { evidenceProvider?: EvidenceProvider; secondBrain?: SecondBrainProvider; env?: NodeJS.ProcessEnv } = {}): Promise<RevalidationDashboard> {
  const env = options.env ?? process.env;
  const dashboard = await loadRevalidationDashboard(store);
  if (!dashboard) throw new EvidenceError("NOT_CONFIGURED", "Start the revalidation scenario first");
  const state = dashboard.state;
  const fact = activeFacts(state).find((entry) => entry.key === "api_version");
  if (!fact) throw new EvidenceError("UNSUPPORTED_RESPONSE", "Active api_version fact is missing");
  const evidenceProvider = options.evidenceProvider ?? (dashboard.mode === "LIVE" ? new NimbleEvidenceProvider({ apiKey: env.NIMBLE_API_KEY, sourceUrl: env.NIMBLE_SOURCE_URL }) : new DeterministicEvidenceProvider());
  const secondBrain = options.secondBrain ?? (dashboard.mode === "LIVE" ? createLiveSecondBrain(env) : new DeterministicRevalidationSecondBrain());
  let evidence;
  try { evidence = await evidenceProvider.fetchEvidence({ factKey: fact.key, currentValue: fact.value, sourceUrl: fact.sourceUrl ?? "" }); }
  catch (cause) {
    const code = cause instanceof EvidenceError ? cause.code : "NETWORK_FAILURE";
    await store.appendEvent(event("evidence_lookup_failed", `Evidence lookup failed: ${code}`, { stateVersion: state.stateVersion, provider: evidenceProvider.id, errorCode: code }));
    throw cause instanceof EvidenceError ? cause : new EvidenceError("NETWORK_FAILURE", "Evidence lookup failed");
  }
  if (evidence.factKey !== fact.key || !evidence.value) throw new EvidenceError("UNSUPPORTED_RESPONSE", "Evidence did not match the requested fact");
  const evidenceEvent = event("external_evidence_received", evidence.summary, { stateVersion: state.stateVersion, mode: dashboard.mode, provider: evidence.provider, factKey: evidence.factKey, relatedStateKeys: [evidence.factKey], sourceUrl: evidence.sourceUrl, observedAt: evidence.observedAt, structuredEvidence: { [evidence.factKey]: evidence.value } });
  await store.appendEvent(evidenceEvent);
  let proposal: MaintainerOutput;
  if (dashboard.mode === "LIVE") await store.appendEvent(event("model_request_started", "SECOND BRAIN / EVIDENCE ANALYSIS", { role: "second", stateVersion: state.stateVersion, provider: secondBrain.id, model: secondBrain.model, mode: dashboard.mode }));
  try { proposal = await secondBrain.analyze({ state, workerEvent: evidenceEvent, observation: evidence.summary, evidence: `${evidence.factKey}: ${evidence.value} / source ${evidence.sourceUrl}`, recentDiffs: dashboard.diffs.slice(-3), turn: 1 }); }
  catch {
    await store.appendEvent(event("model_request_failed", "Second Brain evidence analysis failed", { role: "second", stateVersion: state.stateVersion, provider: secondBrain.id, model: secondBrain.model, errorCode: "SECOND_BRAIN_FAILURE" }));
    throw new EvidenceError("UNSUPPORTED_RESPONSE", "Second Brain evidence analysis failed");
  }
  if (dashboard.mode === "LIVE" && proposal.result) await store.appendEvent(event("model_request_completed", "SECOND BRAIN / RESPONSE RECEIVED", { role: "second", stateVersion: state.stateVersion, provider: secondBrain.id, model: secondBrain.model, mode: dashboard.mode, latencyMs: proposal.result.latencyMs, inputTokens: proposal.result.inputTokens, outputTokens: proposal.result.outputTokens, estimatedInputTokens: proposal.result.estimatedInputTokens, estimatedOutputTokens: proposal.result.estimatedOutputTokens }));
  await store.appendEvent(event("second_brain_analysis", proposal.classification, { detail: proposal.analysis.slice(0, 500), provider: secondBrain.id, model: secondBrain.model, mode: dashboard.mode, stateVersion: state.stateVersion, sourceEventId: evidenceEvent.id }));
  const candidate = proposal.mutations.length === 1 ? validateMutation(proposal.mutations[0]) : { valid: false as const, error: "Expected one fact mutation" };
  const matchesEvidence = candidate.valid && (
    candidate.mutation.type === "SUPERSEDE_FACT" && candidate.mutation.key === fact.key && candidate.mutation.oldValue === fact.value && candidate.mutation.newValue === evidence.value
    || candidate.mutation.type === "UPDATE_FACT" && candidate.mutation.key === fact.key && candidate.mutation.value === fact.value && candidate.mutation.value === evidence.value
  );
  if (!candidate.valid || !matchesEvidence) {
    await store.appendEvent(event("mutation_rejected", "Second Brain proposal did not match verified evidence", { stateVersion: state.stateVersion, sourceEventId: evidenceEvent.id, relatedStateKeys: [fact.key] }));
    throw new EvidenceError("UNSUPPORTED_RESPONSE", "Second Brain proposal did not match verified evidence");
  }
  const mutation = { ...candidate.mutation, reason: `${evidence.provider === "nimble" ? "Nimble" : "Demo"} evidence from ${evidence.sourceUrl} changed ${fact.key}.` };
  const proposed = event("mutation_proposed", `Second Brain proposed ${mutation.type}`, { stateVersion: state.stateVersion, sourceEventId: evidenceEvent.id, mutationType: mutation.type, relatedStateKeys: [fact.key], detail: JSON.stringify(mutation) });
  await store.appendEvent(proposed);
  const applied = applyMutation(state, mutation, new Date().toISOString(), evidenceEvent.id, { sourceUrl: evidence.sourceUrl, observedAt: evidence.observedAt, freshness: { status: "fresh", lastVerifiedAt: evidence.observedAt } });
  applied.diff.mutationProposalEventId = proposed.id;
  await store.saveState(applied.state);
  await store.appendDiff(applied.diff);
  await store.appendEvent(event("mutation_applied", applied.diff.subject, { stateVersion: applied.state.stateVersion, sourceEventId: evidenceEvent.id, mutationProposalEventId: proposed.id, mutationType: mutation.type, relatedStateKeys: [fact.key] }));
  await store.appendEvent(event("state_updated", `Canonical fact updated to ${evidence.value}`, { stateVersion: applied.state.stateVersion, sourceEventId: evidenceEvent.id, relatedStateKeys: [fact.key] }));
  return (await loadRevalidationDashboard(store))!;
}
