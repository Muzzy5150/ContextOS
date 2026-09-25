import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { runRobloxCheckpointDemo } from "../packages/agent/roblox-demo";
import { analyzeFailure, latestAutopsyReport } from "../packages/core/autopsy";
import { readVerifiedSavepoint } from "../packages/core/savepoints";
import { activeFacts } from "../packages/core/state";
import { currentRobloxRun, loadRobloxDashboard, prepareRobloxCheckpoint, startRobloxScenario } from "../scenarios/roblox-checkpoint-demo";

async function isolated(run: (base: string) => Promise<void>) {
  const base = await mkdtemp(join(tmpdir(), "contextos-roblox-"));
  try { await run(base); } finally { await rm(base, { recursive: true, force: true }); }
}

test("controlled Roblox mission creates validated context points with persisted provenance", async () => isolated(async (base) => {
  const run = await startRobloxScenario(base);
  const initial = await run.store.loadState();
  assert.equal(initial?.stateVersion, 1);
  assert.equal(activeFacts(initial!).find((item) => item.key === "blue_spawn")?.value, "north");
  assert.equal(initial?.constraints[0].text, "Maintain fair sightlines; no direct spawn-to-mid visibility.");
  const prepared = await prepareRobloxCheckpoint(run);
  assert.equal(prepared.stateVersion, 8);
  assert.equal(activeFacts(prepared).find((item) => item.key === "red_spawn_exposed")?.value, "false");
  assert.equal(prepared.facts.find((item) => item.key === "red_spawn_exposed" && item.value === "true")?.status, "superseded");
  assert.equal(prepared.openLoops.find((item) => item.status === "active")?.text, "Verify Blue spawn sightline.");
  assert.equal(prepared.nextActions.find((item) => item.status === "active")?.text, "Run Blue spawn verification.");
  const diffs = await run.store.loadDiffs();
  const events = await run.store.loadEvents();
  assert.equal(diffs.length, 7);
  assert.ok(diffs.every((diff) => diff.sourceEventId && diff.mutationProposalEventId && events.some((entry) => entry.id === diff.mutationProposalEventId && entry.type === "mutation_proposed")));
}));

test("Roblox checkpoint survives exact worker death and Autopsy traces persisted bad map state", async () => isolated(async (base) => {
  const proof = await runRobloxCheckpointDemo(base);
  const run = await loadRobloxDashboard(base);
  assert.ok(run);
  assert.equal(run.stage, "autopsied");
  assert.equal(proof.termination.pid, proof.oldPid);
  assert.equal(proof.termination.signal, "SIGKILL");
  assert.equal(proof.termination.gone, true);
  assert.notEqual(proof.oldPid, proof.newPid);
  assert.equal(proof.freshContext.historyEventsReplayed, 0);
  assert.equal(proof.restored.historyEventsReplayed, 0);
  assert.equal(proof.freshContext.nextAction, "Run Blue spawn verification.");
  assert.match(proof.freshContext.compiledContext, /traversal_tests_passed = 42/);
  assert.equal(proof.continued.verified, true);
  const currentRun = await currentRobloxRun(base);
  assert.ok(currentRun);
  assert.equal((await readVerifiedSavepoint(currentRun.store, proof.savepoint.id)).savepoint.integrity.checksum.length, 64);
  assert.equal(proof.requirementDiff.mutationType, "SUPERSEDE_FACT");
  assert.equal(proof.requirementDiff.before, "24");
  assert.equal(proof.requirementDiff.after, "32");
  assert.equal(proof.faultDiff.mutationType, "SUPERSEDE_FACT");
  assert.equal(proof.failure.relatedStateKeys?.[0], "blue_spawn");
  assert.deepEqual(proof.failure.expected, { blue_spawn: "north" });
  assert.deepEqual(proof.failure.actual, { blue_spawn: "east" });
  assert.equal(proof.report.suspectedOrigin?.diffId, proof.faultDiff.id);
  assert.equal(proof.report.suspectedOrigin?.stateVersion, proof.faultDiff.stateVersion);
  assert.equal(proof.report.recommendedHealthyVersion, proof.faultDiff.stateVersion - 1);
  assert.deepEqual(proof.report.causalChain.map((step) => step.relation), ["superseded", "used", "used", "failed"]);
  assert.equal(run.originBefore?.facts.find((item) => item.key === "blue_spawn" && item.status === "active")?.value, "north");
  assert.equal(run.originAfter?.facts.find((item) => item.key === "blue_spawn" && item.status === "active")?.value, "east");
  const stateBeforeAnalysis = await currentRun.store.loadState();
  const eventsBeforeAnalysis = await currentRun.store.loadEvents();
  const diffsBeforeAnalysis = await currentRun.store.loadDiffs();
  assert.equal((await analyzeFailure(currentRun.store, proof.failure.id)).suspectedOrigin?.diffId, proof.faultDiff.id);
  assert.deepEqual(await currentRun.store.loadState(), stateBeforeAnalysis);
  assert.deepEqual(await currentRun.store.loadEvents(), eventsBeforeAnalysis);
  assert.deepEqual(await currentRun.store.loadDiffs(), diffsBeforeAnalysis);
  assert.equal((await latestAutopsyReport(currentRun.store))?.id, proof.report.id);
}));
