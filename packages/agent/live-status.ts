import { resolve } from "node:path";
import { JsonFileStorage } from "../core/storage";
import { activeFacts } from "../core/state";
import { runtimeDisplay } from "./config";
import { nimbleStatus } from "./evidence";

export interface ProviderVerification { status: "LIVE VERIFIED" | "LAST TEST FAILED" | "UNVERIFIED"; model?: string; timestamp?: string; latencyMs?: number; inputTokens?: number; outputTokens?: number; errorCode?: string }
const root = () => resolve(process.cwd(), "data/live-verification");

export async function readProviderVerification(env: NodeJS.ProcessEnv = process.env): Promise<{ openai: ProviderVerification; liquid: ProviderVerification; nimble: ProviderVerification }> {
  const config = runtimeDisplay(env);
  const openai: ProviderVerification = { status: "UNVERIFIED", model: config.first.model };
  const liquid: ProviderVerification = { status: "UNVERIFIED", model: config.second.model };
  const nimble: ProviderVerification = { status: "UNVERIFIED" };
  const firstStore = new JsonFileStorage(resolve(root(), "context"));
  const secondStore = new JsonFileStorage(resolve(root(), "liquid-maintenance"));
  const nimbleStore = new JsonFileStorage(resolve(root(), "nimble-liquid-e2e"));
  const [firstEvents, secondEvents, secondDiffs, secondState, nimbleEvents, nimbleDiffs, nimbleState] = await Promise.all([firstStore.loadEvents(), secondStore.loadEvents(), secondStore.loadDiffs(), secondStore.loadState(), nimbleStore.loadEvents(), nimbleStore.loadDiffs(), nimbleStore.loadState()]);
  if (config.first.provider === "openai") {
    const result = [...firstEvents].reverse().find((event) => event.role === "first" && event.provider === "openai" && (event.type === "model_request_completed" || event.type === "model_request_failed"));
    if (result?.type === "model_request_completed" && result.model === config.first.model) Object.assign(openai, { status: "LIVE VERIFIED", model: result.model, timestamp: result.timestamp, latencyMs: result.latencyMs, inputTokens: result.inputTokens, outputTokens: result.outputTokens });
    else if (result?.type === "model_request_failed" && result.model === config.first.model) Object.assign(openai, { status: "LAST TEST FAILED", model: result.model, timestamp: result.timestamp, errorCode: result.errorCode });
  }
  if (config.second.provider === "liquid") {
    const call = [...secondEvents].reverse().find((event) => event.type === "model_request_completed" && event.role === "second" && event.provider === "liquid" && event.model === config.second.model);
    const diff = [...secondDiffs].reverse().find((entry) => entry.mutationType === "SUPERSEDE_FACT" && entry.subject.startsWith("FACT / ") && secondEvents.some((event) => event.id === entry.mutationProposalEventId && event.type === "mutation_proposed"));
    const key = diff?.subject.slice("FACT / ".length);
    if (call && diff && secondState && activeFacts(secondState).some((fact) => fact.key === key && fact.value === diff.after)) Object.assign(liquid, { status: "LIVE VERIFIED", model: call.model, timestamp: call.timestamp, latencyMs: call.latencyMs, inputTokens: call.inputTokens, outputTokens: call.outputTokens });
  }
  const source = nimbleStatus(env);
  if (source.configured) {
    const evidence = [...nimbleEvents].reverse().find((entry) => entry.type === "external_evidence_received" && entry.provider === "nimble" && entry.mode === "LIVE" && entry.sourceUrl === source.sourceUrl);
    const diff = nimbleDiffs.find((entry) => entry.sourceEventId === evidence?.id && entry.mutationProposalEventId && nimbleEvents.some((event) => event.id === entry.mutationProposalEventId && event.type === "mutation_proposed"));
    const key = evidence?.factKey;
    if (evidence && diff && key && nimbleState && activeFacts(nimbleState).some((fact) => fact.key === key && fact.value === evidence.structuredEvidence?.[key] && fact.sourceEventId === evidence.id)) Object.assign(nimble, { status: "LIVE VERIFIED", timestamp: evidence.timestamp });
  }
  return { openai, liquid, nimble };
}
