import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { compileContext } from "../packages/core/compiler";
import { activeFacts } from "../packages/core/state";
import { JsonFileStorage } from "../packages/core/storage";
import { latestBenchmark, runLongHorizonBenchmark } from "../scenarios/long-horizon-benchmark";
test("benchmark uses one persisted event sequence and real compiler; stale v1 remains historical", async () => {
  const directory = await mkdtemp(join(tmpdir(), "contextos-benchmark-"));
  try {
    const result = await runLongHorizonBenchmark(directory, 120);
    const store = new JsonFileStorage(result.directory);
    const [state, events, diffs] = await Promise.all([store.loadState(), store.loadEvents(), store.loadDiffs()]);
    assert.ok(state);
    const final = result.perStep.at(-1)!;
    assert.equal(final.raw_event_count, events.length);
    assert.equal(final.state_version, state.stateVersion);
    assert.equal(activeFacts(state).find((fact) => fact.key === "api_version")?.value, "v2");
    assert.equal(state.facts.find((fact) => fact.value === "v1")?.status, "superseded");
    assert.ok(events.some((entry) => entry.detail?.includes("api_version = v1")));
    assert.ok(events.some((entry) => entry.detail?.includes("api_version = v2")));
    const compiled = compileContext(state, events);
    const taskSuffix = "\n\nCURRENT TASK\nContinue the API integration mission using the current requirements.";
    assert.equal(final.contextos_context_characters, compiled.text.length + taskSuffix.length);
    assert.ok(final.baseline_context_characters > final.contextos_context_characters);
    assert.ok(result.perStep[119].baseline_context_characters > result.perStep[9].baseline_context_characters);
    assert.equal(diffs.filter((diff) => diff.mutationType === "SUPERSEDE_FACT").length, 1);
    assert.equal(result.summary.staleCanonicalFacts, 0);
    assert.equal(result.summary.historyPreserved, true);
    assert.deepEqual((await latestBenchmark(directory))?.perStep, result.perStep);
    assert.equal((JSON.parse(await readFile(join(result.directory, "metrics.json"), "utf8")) as { sameEventsForBoth: boolean }).sameEventsForBoth, true);
    const repeated = await runLongHorizonBenchmark(directory, 120);
    assert.deepEqual(repeated.perStep, result.perStep);
  } finally { await rm(directory, { recursive: true, force: true }); }
});
