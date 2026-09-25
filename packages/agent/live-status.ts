import { resolve } from "node:path";
import { JsonFileStorage } from "../core/storage";
import { activeFacts } from "../core/state";
import { runtimeDisplay } from "./config";

export interface ProviderVerification { status: "LIVE VERIFIED" | "LAST TEST FAILED" | "UNVERIFIED"; model?: string; timestamp?: string; latencyMs?: number; inputTokens?: number; outputTokens?: number; errorCode?: string }
const root = () => resolve(process.cwd(), "data/live-verification");

export async function readProviderVerification(env: NodeJS.ProcessEnv = process.env): Promise<{ openai: ProviderVerification; liquid: ProviderVerification }> {
  const config = runtimeDisplay(env);
  const openai: ProviderVerification = { status: "UNVERIFIED", model: config.first.model };
  const liquid: ProviderVerification = { status: "UNVERIFIED", model: config.second.model };
  const firstStore = new JsonFileStorage(resolve(root(), "context"));
  const secondStore = new JsonFileStorage(resolve(root(), "liquid-maintenance"));
  const [firstEvents, secondEvents, secondDiffs, secondState] = await Promise.all([firstStore.loadEvents(), secondStore.loadEvents(), secondStore.loadDiffs(), secondStore.loadState()]);
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
  return { openai, liquid };
}
