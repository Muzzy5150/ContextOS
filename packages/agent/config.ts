import { DemoFirstBrain } from "./first-brain";
import { DemoSecondBrain } from "./second-brain";
import { OpenAICompatibleHttpProvider, ProviderError } from "./http-provider";
import { LiveFirstBrain, LiveSecondBrain } from "./live-brains";
import { FirstBrainProvider, RuntimeMode, SecondBrainProvider } from "./provider";

export interface ProviderDisplay { provider: string; model: string; ready: boolean; issue?: string }
export interface RuntimeDisplay { mode: RuntimeMode; first: ProviderDisplay; second: ProviderDisplay; liveReady: boolean }
export interface BrainPair { first: FirstBrainProvider; second: SecondBrainProvider }
const supported = new Set(["openai", "openai-compatible", "liquid"]);
function providerSettings(role: "FIRST" | "SECOND", env: NodeJS.ProcessEnv): { display: ProviderDisplay; baseUrl: string; apiKey?: string; requireApiKey: boolean } {
  const prefix = `CONTEXTOS_${role}_BRAIN_`;
  const provider = env[`${prefix}PROVIDER`]?.trim().toLowerCase() ?? "";
  const model = env[`${prefix}MODEL`]?.trim() ?? "";
  const baseUrl = env[`${prefix}BASE_URL`]?.trim() || (provider === "openai" ? "https://api.openai.com/v1" : "");
  const apiKey = env[`${prefix}API_KEY`]?.trim() || (provider === "openai" ? env.OPENAI_API_KEY?.trim() : undefined);
  let host = "";
  try { host = baseUrl ? new URL(baseUrl).hostname : ""; } catch { host = "invalid"; }
  const requireApiKey = provider === "openai" || host === "api.openai.com";
  let issue: string | undefined;
  if (!supported.has(provider)) issue = `${role} provider must be openai, openai-compatible, or liquid`;
  else if (!model) issue = `${role} model is missing`;
  else if (!baseUrl) issue = `${role} base URL is missing`;
  else if (host === "invalid") issue = `${role} base URL is invalid`;
  else if (requireApiKey && !apiKey) issue = `${role} API key is missing`;
  return { display: { provider: provider || "unconfigured", model: model || "unconfigured", ready: !issue, issue }, baseUrl, apiKey, requireApiKey };
}
export function runtimeDisplay(env: NodeJS.ProcessEnv = process.env): RuntimeDisplay {
  const first = providerSettings("FIRST", env).display;
  const second = providerSettings("SECOND", env).display;
  return { mode: env.CONTEXTOS_MODE?.toUpperCase() === "LIVE" ? "LIVE" : "DEMO", first, second, liveReady: first.ready && second.ready };
}
export function createBrainPair(mode: RuntimeMode, env: NodeJS.ProcessEnv = process.env): BrainPair {
  if (mode === "DEMO") return { first: new DemoFirstBrain(), second: new DemoSecondBrain() };
  const first = providerSettings("FIRST", env);
  const second = providerSettings("SECOND", env);
  if (first.display.issue || second.display.issue) throw new ProviderError(first.display.issue?.includes("API key") || second.display.issue?.includes("API key") ? "NO_API_KEY" : "PROVIDER_ERROR", first.display.issue ?? second.display.issue ?? "Live provider configuration is incomplete");
  const make = (settings: typeof first) => new OpenAICompatibleHttpProvider({ id: settings.display.provider, model: settings.display.model, baseUrl: settings.baseUrl, apiKey: settings.apiKey, requireApiKey: settings.requireApiKey });
  return { first: new LiveFirstBrain(make(first)), second: new LiveSecondBrain(make(second)) };
}
export function createLiveSecondBrain(env: NodeJS.ProcessEnv = process.env): SecondBrainProvider {
  const second = providerSettings("SECOND", env);
  if (second.display.issue) throw new ProviderError(second.display.issue.includes("API key") ? "NO_API_KEY" : "PROVIDER_ERROR", second.display.issue);
  return new LiveSecondBrain(new OpenAICompatibleHttpProvider({ id: second.display.provider, model: second.display.model, baseUrl: second.baseUrl, apiKey: second.apiKey, requireApiKey: second.requireApiKey }));
}
export function pairDisplay(mode: RuntimeMode, env: NodeJS.ProcessEnv = process.env): Pick<RuntimeDisplay, "first" | "second"> {
  if (mode === "DEMO") return { first: { provider: "deterministic", model: "scenario-v1", ready: true }, second: { provider: "deterministic", model: "scenario-v1", ready: true } };
  const display = runtimeDisplay(env); return { first: display.first, second: display.second };
}
