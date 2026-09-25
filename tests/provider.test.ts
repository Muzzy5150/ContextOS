import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { OpenAICompatibleHttpProvider, ProviderError } from "../packages/agent/http-provider";
import { LiveFirstBrain, LiveSecondBrain, SecondBrainParseError, makeLiquidSecondBrainRequest } from "../packages/agent/live-brains";
import { ModelProvider, ModelRequest, ModelResult } from "../packages/agent/provider";
import { advanceDemo, advanceWithProviders, resetScenario } from "../packages/agent/runtime";
import { compileContext } from "../packages/core/compiler";
import { activeFacts, AgentEvent, createInitialState } from "../packages/core/state";
import { JsonFileStorage } from "../packages/core/storage";

const env: NodeJS.ProcessEnv = {
  NODE_ENV: "test",
  CONTEXTOS_FIRST_BRAIN_PROVIDER: "openai-compatible", CONTEXTOS_FIRST_BRAIN_BASE_URL: "https://example.test/v1", CONTEXTOS_FIRST_BRAIN_MODEL: "worker-test",
  CONTEXTOS_SECOND_BRAIN_PROVIDER: "liquid", CONTEXTOS_SECOND_BRAIN_BASE_URL: "https://example.test/v1", CONTEXTOS_SECOND_BRAIN_MODEL: "maintainer-test"
};
const withStore = async (run: (store: JsonFileStorage) => Promise<void>) => { const directory = await mkdtemp(join(tmpdir(), "contextos-provider-")); try { await run(new JsonFileStorage(directory)); } finally { await rm(directory, { recursive: true, force: true }); } };
const completion = (text: string, usage?: { prompt_tokens: number; completion_tokens: number }) => new Response(JSON.stringify({ model: "served-model", choices: [{ message: { content: text } }], ...(usage ? { usage } : {}) }), { status: 200, headers: { "Content-Type": "application/json" } });
const result = (text: string): ModelResult => ({ text, provider: "mock-http", model: "mock-model", inputCharacters: 500, outputCharacters: text.length, estimatedInputTokens: 125, estimatedOutputTokens: Math.ceil(text.length / 4), latencyMs: 42 });
const model = (responses: string[]): ModelProvider & { calls: ModelRequest[] } => ({ id: "mock-http", model: "mock-model", calls: [], async generate(request) { this.calls.push(request); return result(responses.shift() ?? ""); } });

test("HTTP First Brain sends compiled context, not raw historical events", async () => {
  const now = "2026-09-25T00:00:00.000Z";
  const history: AgentEvent[] = Array.from({ length: 60 }, (_, index) => ({ id: `old-${index}`, type: "tool_result", timestamp: now, message: `OLD_IRRELEVANT_SENTINEL_${index}`, detail: "archived transcript noise" }));
  history.push({ id: "recent", type: "state_updated", timestamp: now, message: "Ready for current task" });
  const compiled = compileContext(createInitialState(now), history, 1);
  let sentBody = "";
  const fetchImpl: typeof fetch = async (_url, options) => { sentBody = String(options?.body); return completion("Inspecting the current integration.", { prompt_tokens: 37, completion_tokens: 8 }); };
  const brain = new LiveFirstBrain(new OpenAICompatibleHttpProvider({ id: "openai-compatible", baseUrl: "https://example.test/v1", model: "worker-test", fetchImpl }));
  const output = await brain.respond({ compiledContext: compiled.text, task: "Inspect API integration", turn: 1 });
  assert.match(sentBody, /api_version = v1/);
  assert.match(sentBody, /Inspect API integration/);
  assert.doesNotMatch(sentBody, /OLD_IRRELEVANT_SENTINEL/);
  assert.ok(compiled.rawHistoryCharacters > compiled.compiledCharacters * 2);
  assert.equal(output.result?.inputTokens, 37);
  assert.equal(output.result?.outputTokens, 8);
  assert.equal(output.result?.provider, "openai-compatible");
});

test("HTTP Second Brain requests JSON and parses structured mutations", async () => {
  let requestBody = "";
  const fetchImpl: typeof fetch = async (_url, options) => { requestBody = String(options?.body); return completion(JSON.stringify({ classification: "DURABLE CONFLICT", analysis: "v2 evidence supersedes v1", mutations: [{ type: "SUPERSEDE_FACT", key: "api_version", oldValue: "v1", newValue: "v2", reason: "Endpoint requires v2" }] })); };
  const brain = new LiveSecondBrain(new OpenAICompatibleHttpProvider({ id: "liquid", baseUrl: "http://127.0.0.1:11434/v1", model: "lfm-local", fetchImpl }));
  const output = await brain.analyze({ state: createInitialState("2026-09-25T00:00:00.000Z"), workerEvent: { id: "worker", type: "first_brain_output", timestamp: "2026-09-25T00:00:00.000Z", message: "Done" }, observation: "Endpoint requires v2", evidence: "Documentation says v2 only", recentDiffs: [], turn: 2 });
  assert.equal(output.mutations.length, 1);
  assert.equal((output.mutations[0] as { type: string }).type, "SUPERSEDE_FACT");
  assert.match(requestBody, /"response_format":\{"type":"json_schema"/);
  assert.match(requestBody, /Documentation says v2 only/);
  assert.equal(output.result?.inputTokens, undefined);
  assert.ok((output.result?.estimatedInputTokens ?? 0) > 0);
});

test("Liquid conflict schema uses the recorded fact and evidence values", () => {
  const state = createInitialState("2026-09-25T00:00:00.000Z");
  state.facts[0].key = "deployment_region";
  state.facts[0].value = "us-west-2";
  const request = makeLiquidSecondBrainRequest({ state, workerEvent: { id: "evidence", type: "external_evidence_received", timestamp: state.createdAt, message: "Region updated", structuredEvidence: { deployment_region: "us-east-1" } }, observation: "Region updated", evidence: "Fresh configuration received", recentDiffs: [], turn: 2 });
  const schema = JSON.stringify(request.jsonSchema);
  assert.match(schema, /deployment_region/);
  assert.match(schema, /us-west-2/);
  assert.match(schema, /us-east-1/);
  assert.doesNotMatch(schema, /api_version/);
});

test("malformed Second Brain JSON is preserved for logging", async () => {
  const provider = model(["```json broken"]);
  const brain = new LiveSecondBrain(provider);
  await assert.rejects(() => brain.analyze({ state: createInitialState("2026-09-25T00:00:00.000Z"), workerEvent: { id: "worker", type: "first_brain_output", timestamp: "2026-09-25T00:00:00.000Z", message: "Done" }, observation: "Done", evidence: "Evidence", recentDiffs: [], turn: 1 }), (error: unknown) => error instanceof SecondBrainParseError && error.rawOutput === "```json broken" && !!error.result);
});

test("schema-invalid mutation rejects the whole set and preserves state", async () => withStore(async (store) => {
  await resetScenario("LIVE", store, env);
  const pair = { first: new LiveFirstBrain(model(["I found a route to investigate."])), second: new LiveSecondBrain(model([JSON.stringify({ mutations: [{ type: "ADD_OPEN_LOOP", text: "Check route", reason: "Pending" }, { type: "SUPERSEDE_FACT", key: "api_version", oldValue: "v1", reason: "Missing newValue" }] })])) };
  const data = await advanceWithProviders(store, pair, env);
  assert.equal(data.state.stateVersion, 1);
  assert.equal(data.diffs.length, 0);
  assert.equal(data.completedTurns, 0);
  assert.equal(data.events.some((entry) => entry.type === "mutation_validation_failed"), true);
  assert.equal(activeFacts(data.state)[0].value, "v1");
}));

test("parse failure allows a Second Brain retry without repeating First Brain", async () => withStore(async (store) => {
  await resetScenario("LIVE", store, env);
  const firstModel = model(["The route is not yet confirmed."]);
  const secondModel = model(["bad json", JSON.stringify({ classification: "OPEN LOOP", analysis: "Pending verification", mutations: [{ type: "ADD_OPEN_LOOP", text: "Verify the endpoint", reason: "Still unconfirmed" }] })]);
  const pair = { first: new LiveFirstBrain(firstModel), second: new LiveSecondBrain(secondModel) };
  const failed = await advanceWithProviders(store, pair, env);
  assert.equal(failed.state.stateVersion, 1);
  assert.equal(failed.completedTurns, 0);
  assert.equal(failed.events.find((entry) => entry.type === "second_brain_parse_failed")?.detail, "bad json");
  const retried = await advanceWithProviders(store, pair, env);
  assert.equal(firstModel.calls.length, 1);
  assert.equal(secondModel.calls.length, 2);
  assert.equal(retried.state.stateVersion, 2);
  assert.equal(retried.completedTurns, 1);
}));

test("live runtime logs provider usage without serializing API keys", async () => withStore(async (store) => {
  const secret = "unit-test-secret-key";
  const keyedEnv = { ...env, CONTEXTOS_FIRST_BRAIN_API_KEY: secret, CONTEXTOS_SECOND_BRAIN_API_KEY: secret };
  await resetScenario("LIVE", store, keyedEnv);
  let requests = 0;
  const fetchImpl: typeof fetch = async (_url, options) => {
    requests++;
    assert.equal(new Headers(options?.headers).get("Authorization"), `Bearer ${secret}`);
    return requests === 1 ? completion("The route needs investigation.", { prompt_tokens: 98, completion_tokens: 17 }) : completion(JSON.stringify({ classification: "OPEN LOOP", analysis: "Track route", mutations: [{ type: "ADD_OPEN_LOOP", text: "Verify endpoint", reason: "Still unknown" }] }), { prompt_tokens: 111, completion_tokens: 25 });
  };
  const pair = {
    first: new LiveFirstBrain(new OpenAICompatibleHttpProvider({ id: "openai-compatible", baseUrl: "https://example.test/v1", model: "worker-test", apiKey: secret, fetchImpl })),
    second: new LiveSecondBrain(new OpenAICompatibleHttpProvider({ id: "liquid", baseUrl: "https://example.test/v1", model: "maintainer-test", apiKey: secret, fetchImpl }))
  };
  const data = await advanceWithProviders(store, pair, keyedEnv);
  assert.equal(data.completedTurns, 1);
  assert.equal(data.state.stateVersion, 2);
  assert.equal(data.events.find((entry) => entry.type === "model_request_completed" && entry.role === "first")?.inputTokens, 98);
  assert.equal(data.events.find((entry) => entry.type === "model_request_completed" && entry.role === "second")?.outputTokens, 25);
  assert.ok(data.events.find((entry) => entry.type === "context_compiled")?.compiledContextTokensEstimate);
  assert.equal(JSON.stringify(data.events).includes(secret), false);
  assert.equal(JSON.stringify(data.state).includes(secret), false);
}));

test("HTTP errors map timeout, missing key, missing model, and rate limit", async () => {
  const base = { id: "openai", baseUrl: "https://api.openai.com/v1", model: "test-model" };
  await assert.rejects(() => new OpenAICompatibleHttpProvider({ ...base, requireApiKey: true }).generate({ system: "s", user: "u" }), (error: unknown) => error instanceof ProviderError && error.code === "NO_API_KEY");
  for (const [status, code] of [[404, "MODEL_NOT_FOUND"], [429, "RATE_LIMIT"]] as const) {
    await assert.rejects(() => new OpenAICompatibleHttpProvider({ ...base, apiKey: "test", fetchImpl: async () => new Response("", { status }) }).generate({ system: "s", user: "u" }), (error: unknown) => error instanceof ProviderError && error.code === code);
  }
  await assert.rejects(() => new OpenAICompatibleHttpProvider({ ...base, apiKey: "test", fetchImpl: async () => { throw new DOMException("deadline", "TimeoutError"); } }).generate({ system: "s", user: "u" }), (error: unknown) => error instanceof ProviderError && error.code === "TIMEOUT");
});

test("live mock scenario supersedes v1 through the deterministic engine", async () => withStore(async (store) => {
  await resetScenario("LIVE", store, env);
  const pair = { first: new LiveFirstBrain(model(["Inspecting v1 route.", "Evidence says the endpoint requires v2.", "Canonical state now says v2."])), second: new LiveSecondBrain(model([JSON.stringify({ mutations: [] }), JSON.stringify({ classification: "DURABLE CONFLICT", mutations: [{ type: "SUPERSEDE_FACT", key: "api_version", oldValue: "v1", newValue: "v2", reason: "Required endpoint is v2 only" }] }), JSON.stringify({ mutations: [] })])) };
  await advanceWithProviders(store, pair, env);
  const second = await advanceWithProviders(store, pair, env);
  assert.equal(activeFacts(second.state)[0].value, "v2");
  assert.equal(second.diffs[0].mutationType, "SUPERSEDE_FACT");
  const third = await advanceWithProviders(store, pair, env);
  assert.equal(third.completedTurns, 3);
  assert.equal(third.state.facts[0].status, "superseded");
}));

test("deterministic provider cannot silently run inside LIVE mode", async () => withStore(async (store) => {
  await resetScenario("LIVE", store, env);
  await assert.rejects(() => advanceDemo(store), /Cannot run deterministic providers in a LIVE scenario/);
  assert.equal((await store.loadState())?.stateVersion, 1);
}));
