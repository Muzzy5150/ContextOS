import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { advanceDemo, resetDemo } from "../packages/agent/runtime";
import { compileContext } from "../packages/core/compiler";
import { applyMutation } from "../packages/core/mutations";
import { activeFacts, createInitialState } from "../packages/core/state";
import { JsonFileStorage } from "../packages/core/storage";
import { validateMutation } from "../packages/core/validation";
const now = "2026-09-25T00:00:00.000Z";
const withStore = async (run: (store: JsonFileStorage) => Promise<void>) => {
  const directory = await mkdtemp(join(tmpdir(), "contextos-test-"));
  try { await run(new JsonFileStorage(directory)); } finally { await rm(directory, { recursive: true, force: true }); }
};
test("valid mutation changes state and records a versioned diff", () => {
  const mutation = validateMutation({ type: "ADD_DECISION", text: "Use API v2", reason: "Endpoint support" });
  assert.equal(mutation.valid, true);
  if (!mutation.valid) return;
  const result = applyMutation(createInitialState(now), mutation.mutation, now, "event-1");
  assert.equal(result.state.stateVersion, 2);
  assert.equal(result.state.decisions[0].text, "Use API v2");
  assert.equal(result.diff.stateVersion, 2);
  assert.equal(result.diff.sourceEventId, "event-1");
});
test("supersession preserves history and compiles only active value", () => {
  const result = applyMutation(createInitialState(now), { type: "SUPERSEDE_FACT", key: "api_version", oldValue: "v1", newValue: "v2", reason: "Endpoint is v2 only" }, now);
  assert.equal(result.state.facts.length, 2);
  assert.equal(result.state.facts[0].status, "superseded");
  assert.equal(result.state.facts[0].supersededBy, result.state.facts[1].id);
  assert.deepEqual(activeFacts(result.state).map((fact) => fact.value), ["v2"]);
  assert.equal(result.diff.before, "v1"); assert.equal(result.diff.after, "v2");
  const compiled = compileContext(result.state, []);
  assert.match(compiled.text, /api_version = v2/);
  assert.doesNotMatch(compiled.text, /api_version = v1/);
});
test("invalid model mutations are rejected before application", () => {
  assert.equal(validateMutation({ type: "SUPERSEDE_FACT", key: "api_version", oldValue: "v1", reason: "missing new value" }).valid, false);
  assert.equal(validateMutation({ type: "DELETE_ALL_STATE", reason: "invalid" }).valid, false);
  assert.throws(() => applyMutation(createInitialState(now), { type: "SUPERSEDE_FACT", key: "api_version", oldValue: "v9", newValue: "v2", reason: "mismatch" }, now));
});
test("state persists and reloads from local JSON", async () => withStore(async (store) => {
  const state = createInitialState(now);
  await store.saveState(state);
  assert.deepEqual(await store.loadState(), state);
}));
test("demo runs through v1 to v2 with predictable versions and durable logs", async () => withStore(async (store) => {
  await resetDemo(store);
  const first = await advanceDemo(store);
  assert.equal(first.state.stateVersion, 2);
  assert.equal(activeFacts(first.state)[0].value, "v1");
  const second = await advanceDemo(store);
  assert.equal(second.state.stateVersion, 5);
  assert.equal(activeFacts(second.state)[0].value, "v2");
  const third = await advanceDemo(store);
  assert.equal(third.state.stateVersion, 6);
  assert.equal(third.completedTurns, 3);
  assert.equal(third.diffs.length, 5);
  assert.equal(third.events.filter((entry) => entry.type === "mutation_applied").length, 5);
  assert.equal(third.state.facts[0].status, "superseded");
  assert.equal(third.events.find((entry) => entry.type === "first_brain_output" && entry.turn === 3)?.detail?.includes("API v2"), true);
  assert.equal((await store.loadState())?.stateVersion, 6);
}));

test("invalid maintainer output is logged and cannot change canonical state", async () => withStore(async (store) => {
  await resetDemo(store);
  const result = await advanceDemo(store, { id: "test", model: "test", analyze: async () => ({ classification: "INVALID", analysis: "Proposed malformed data", mutations: [{ type: "SUPERSEDE_FACT", key: "api_version", oldValue: "v1", reason: "Missing newValue" }] }) });
  assert.equal(result.state.stateVersion, 1);
  assert.equal(result.diffs.length, 0);
  assert.equal(result.events.filter((entry) => entry.type === "mutation_rejected").length, 1);
  assert.equal(activeFacts(result.state)[0].value, "v1");
}));
