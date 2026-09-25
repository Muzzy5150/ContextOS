import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { createBrainPair, runtimeDisplay } from "../packages/agent/config";
import { EvidenceError, NimbleEvidenceProvider, nimbleStatus } from "../packages/agent/evidence";
import { DeterministicRevalidationSecondBrain, revalidateFact, startRevalidationScenario } from "../packages/agent/revalidation";
import { SecondBrainProvider } from "../packages/agent/provider";
import { activeFacts } from "../packages/core/state";
import { JsonFileStorage } from "../packages/core/storage";

const withStore = async (run: (store: JsonFileStorage) => Promise<void>) => { const directory = await mkdtemp(join(tmpdir(), "contextos-sponsor-")); try { await run(new JsonFileStorage(directory)); } finally { await rm(directory, { recursive: true, force: true }); } };
const liveEnv: NodeJS.ProcessEnv = { NODE_ENV: "test", CONTEXTOS_SECOND_BRAIN_PROVIDER: "liquid", CONTEXTOS_SECOND_BRAIN_BASE_URL: "https://liquid.example.test/v1", CONTEXTOS_SECOND_BRAIN_MODEL: "small-lfm", CONTEXTOS_SECOND_BRAIN_API_KEY: "liquid-test-secret", NIMBLE_ENABLED: "true", NIMBLE_API_KEY: "nimble-test-secret", NIMBLE_SOURCE_URL: "https://docs.example.test/version" };

test("Liquid resolves through the existing LIVE provider path and DEMO remains deterministic", () => {
  const env = { ...liveEnv, CONTEXTOS_FIRST_BRAIN_PROVIDER: "openai-compatible", CONTEXTOS_FIRST_BRAIN_BASE_URL: "https://worker.example.test/v1", CONTEXTOS_FIRST_BRAIN_MODEL: "worker" };
  assert.equal(runtimeDisplay(env).second.provider, "liquid");
  assert.equal(runtimeDisplay(env).liveReady, true);
  assert.equal(createBrainPair("LIVE", env).second.id, "liquid");
  assert.equal(createBrainPair("DEMO", env).second.id, "deterministic");
});

test("deterministic evidence is interpreted by Second Brain and supersedes stale fact with provenance", async () => withStore(async (store) => {
  const seeded = await startRevalidationScenario("DEMO", store);
  assert.equal(activeFacts(seeded.state)[0].freshness?.status, "stale");
  const result = await revalidateFact(store);
  const current = activeFacts(result.state)[0];
  const evidence = result.events.find((entry) => entry.type === "external_evidence_received");
  const proposal = result.events.find((entry) => entry.type === "mutation_proposed");
  assert.equal(current.value, "v2");
  assert.equal(current.freshness?.status, "fresh");
  assert.equal(current.sourceEventId, evidence?.id);
  assert.equal(current.sourceUrl, evidence?.sourceUrl);
  assert.equal(result.state.facts.find((fact) => fact.value === "v1")?.status, "superseded");
  assert.equal(result.diffs[0].sourceEventId, evidence?.id);
  assert.equal(result.diffs[0].mutationProposalEventId, proposal?.id);
  assert.equal((await store.getStateAtVersion(1)).facts[0].value, "v1");
}));

test("Nimble Extract v2 request normalizes fresh evidence and keeps API key out of result", async () => {
  let requested = "";
  let authorization = "";
  const provider = new NimbleEvidenceProvider({ apiKey: "nimble-test-secret", fetchImpl: async (url, init) => {
    requested = String(url); authorization = new Headers(init?.headers).get("Authorization") ?? "";
    assert.deepEqual(JSON.parse(String(init?.body)), { url: "https://docs.example.test/version", formats: ["markdown"] });
    return new Response(JSON.stringify({ status: "success", data: { markdown: "# Current release\napi_version: v2\n" }, status_code: 200 }), { status: 200 });
  } });
  const result = await provider.fetchEvidence({ factKey: "api_version", currentValue: "v1", sourceUrl: "https://docs.example.test/version" });
  assert.equal(requested, "https://sdk.nimbleway.com/v2/extract");
  assert.equal(authorization, "Bearer nimble-test-secret");
  assert.equal(result.value, "v2");
  assert.equal(JSON.stringify(result).includes("nimble-test-secret"), false);
  assert.equal(JSON.stringify(result).includes("# Current release"), false);
});

test("Nimble failures and ambiguous content preserve canonical state", async () => withStore(async (store) => {
  await startRevalidationScenario("DEMO", store);
  const failed = new NimbleEvidenceProvider({ apiKey: "nimble-test-secret", fetchImpl: async () => new Response("", { status: 429 }) });
  await assert.rejects(() => revalidateFact(store, { evidenceProvider: failed }), (error: unknown) => error instanceof EvidenceError && error.code === "RATE_LIMITED");
  assert.equal((await store.loadState())?.stateVersion, 1);
  const ambiguous = new NimbleEvidenceProvider({ apiKey: "nimble-test-secret", fetchImpl: async () => new Response(JSON.stringify({ status: "success", data: { markdown: "api_version: v1\napi_version: v2" } }), { status: 200 }) });
  await assert.rejects(() => revalidateFact(store, { evidenceProvider: ambiguous }), (error: unknown) => error instanceof EvidenceError && error.code === "UNSUPPORTED_RESPONSE");
  assert.equal((await store.loadState())?.stateVersion, 1);
  assert.equal((await store.loadDiffs()).length, 0);
}));

test("fresh evidence confirming the existing value clears staleness through the mutation engine", async () => withStore(async (store) => {
  await startRevalidationScenario("DEMO", store);
  const evidence = { id: "deterministic" as const, async fetchEvidence() { return { provider: "deterministic" as const, factKey: "api_version", value: "v1", sourceUrl: "https://example.org/version", observedAt: new Date().toISOString(), summary: "api_version: v1 confirmed" }; } };
  const result = await revalidateFact(store, { evidenceProvider: evidence });
  assert.equal(activeFacts(result.state)[0].value, "v1");
  assert.equal(activeFacts(result.state)[0].freshness?.status, "fresh");
  assert.equal(result.diffs[0].mutationType, "UPDATE_FACT");
}));

test("failed and malformed Second Brain outputs cannot mutate revalidation state", async () => withStore(async (store) => {
  await startRevalidationScenario("DEMO", store);
  const failure: SecondBrainProvider = { id: "liquid", model: "mock", async analyze() { throw new Error("model unavailable"); } };
  await assert.rejects(() => revalidateFact(store, { secondBrain: failure }), /Second Brain evidence analysis failed/);
  const malformed: SecondBrainProvider = { id: "liquid", model: "mock", async analyze() { return { classification: "wrong", analysis: "wrong", mutations: [{ type: "SUPERSEDE_FACT", key: "api_version", oldValue: "v1", newValue: "v3", reason: "Invented" }] }; } };
  await assert.rejects(() => revalidateFact(store, { secondBrain: malformed }), /did not match verified evidence/);
  assert.equal((await store.loadState())?.stateVersion, 1);
  assert.equal((await store.loadDiffs()).length, 0);
}));

test("mocked Nimble evidence can pass through Second Brain without persisting provider secrets", async () => withStore(async (store) => {
  assert.equal(nimbleStatus(liveEnv).configured, true);
  await startRevalidationScenario("LIVE", store, liveEnv);
  const evidence = new NimbleEvidenceProvider({ apiKey: liveEnv.NIMBLE_API_KEY, fetchImpl: async () => new Response(JSON.stringify({ status: "success", data: { markdown: "api_version: v2" } }), { status: 200 }) });
  const result = await revalidateFact(store, { evidenceProvider: evidence, secondBrain: new DeterministicRevalidationSecondBrain(), env: liveEnv });
  assert.equal(result.mode, "LIVE");
  assert.equal(result.events.find((entry) => entry.type === "external_evidence_received")?.provider, "nimble");
  assert.equal(activeFacts(result.state)[0].value, "v2");
  const serialized = (await readFile(join(store.directoryPath, "events.jsonl"), "utf8")) + (await readFile(join(store.directoryPath, "state.json"), "utf8"));
  assert.equal(serialized.includes("nimble-test-secret"), false);
  assert.equal(serialized.includes("liquid-test-secret"), false);
}));

test("disabled Nimble is reported as unavailable without a credential", () => {
  assert.equal(nimbleStatus({ NODE_ENV: "test", NIMBLE_ENABLED: "false", NIMBLE_API_KEY: "present" }).configured, false);
  assert.equal(nimbleStatus({ NODE_ENV: "test", NIMBLE_ENABLED: "true" }).issue, "API KEY MISSING");
  assert.equal(nimbleStatus({ ...liveEnv, NIMBLE_SOURCE_URL: "https://docs.example.test/version?token=secret" }).configured, false);
});
