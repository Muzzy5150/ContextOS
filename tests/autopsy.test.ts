import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { analyzeFailure, compareStateImages, compareStates, latestAutopsyReport, runAutopsy } from "../packages/core/autopsy";
import { activeFacts } from "../packages/core/state";
import { currentAutopsyRun, runAutopsyScenario } from "../scenarios/autopsy-demo";

async function withBase(run: (base: string) => Promise<void>) {
  const base = await mkdtemp(join(tmpdir(), "contextos-autopsy-"));
  try { await run(base); } finally { await rm(base, { recursive: true, force: true }); }
}
test("historical state images materialize every version without altering canonical state", async () => withBase(async (base) => {
  const run = await runAutopsyScenario(base);
  assert.deepEqual(await run.store.stateVersions(), [1, 2, 3, 4, 5, 6, 7, 8, 9]);
  const canonicalBefore = await run.store.loadState();
  const state5 = await run.store.getStateAtVersion(5);
  const state6 = await run.store.getStateAtVersion(6);
  const state9 = await run.store.getStateAtVersion(9);
  assert.equal(activeFacts(state5).find((fact) => fact.key === "deployment_region")?.value, "us-west-2");
  assert.equal(activeFacts(state6).find((fact) => fact.key === "deployment_region")?.value, "us-east-1");
  assert.equal(state6.facts.find((fact) => fact.value === "us-west-2")?.status, "superseded");
  assert.equal(activeFacts(state9).find((fact) => fact.key === "deployment_status")?.value, "failed");
  assert.deepEqual(await run.store.loadState(), canonicalBefore);
  await assert.rejects(() => run.store.getStateAtVersion(10), /STATE VERSION NOT FOUND/);
}));

test("state comparison and structured failure show expected and actual deployment values", async () => withBase(async (base) => {
  const run = await runAutopsyScenario(base);
  const comparison = await compareStates(run.store, 5, 9);
  assert.deepEqual(comparison.facts.find((change) => change.key === "deployment_region"), { key: "deployment_region", before: "us-west-2", after: "us-east-1" });
  assert.deepEqual(comparison.facts.find((change) => change.key === "deployment_status"), { key: "deployment_status", before: "pending", after: "failed" });
  const before = await run.store.getStateAtVersion(5);
  const after = structuredClone(before);
  after.stateVersion = 10;
  after.openLoops[0].status = "resolved";
  after.nextActions[0].status = "archived";
  after.nextActions.push({ id: "investigate", text: "Inspect deployment configuration.", status: "active", createdAt: before.createdAt, updatedAt: before.updatedAt });
  const itemComparison = compareStateImages(before, after);
  assert.deepEqual(itemComparison.openLoops.map((change) => change.before), ["Confirm the deployment target before execution."]);
  assert.deepEqual(itemComparison.nextActions.map((change) => change.key), ["Build and deploy the application.", "Inspect deployment configuration."]);
  const failure = (await run.store.loadEvents()).find((entry) => entry.id === run.failureEvent.id);
  assert.equal(failure?.type, "mission_failure");
  assert.equal(failure?.stateVersion, 9);
  assert.deepEqual(failure?.relatedStateKeys, ["deployment_region"]);
  assert.equal(failure?.expected?.deployment_region, "us-west-2");
  assert.equal(failure?.actual?.deployment_region, "us-east-1");
  assert.match((await run.store.loadEvents()).find((entry) => entry.type === "action_observed" && entry.message.includes("target selected"))?.message ?? "", /us-east-1/);
}));

test("autopsy traces generic failed key through source, mutation proposal, diff, usage, and failure", async () => withBase(async (base) => {
  const run = await runAutopsyScenario(base);
  const report = await analyzeFailure(run.store, run.failureEvent.id);
  const origin = report.suspectedOrigin!;
  const events = await run.store.loadEvents();
  const diffs = await run.store.loadDiffs();
  assert.equal(origin.stateVersion, 6);
  assert.equal(origin.diffId, "diff-6");
  assert.equal(origin.mutationType, "SUPERSEDE_FACT");
  assert.equal(origin.key, "deployment_region");
  assert.equal(origin.before, "us-west-2");
  assert.equal(origin.after, "us-east-1");
  assert.equal(origin.confidence, 0.97);
  assert.equal(report.recommendedHealthyVersion, 5);
  assert.match(events.find((entry) => entry.id === origin.sourceEventId)?.message ?? "", /Old cached deployment configuration/);
  assert.equal(events.find((entry) => entry.id === origin.mutationProposalEventId)?.type, "mutation_proposed");
  assert.equal(diffs.find((diff) => diff.id === origin.diffId)?.sourceEventId, origin.sourceEventId);
  assert.deepEqual(report.causalChain.map((step) => step.stateVersion), [6, 7, 8, 9]);
  assert.deepEqual(report.causalChain.map((step) => step.relation), ["superseded", "used", "used", "failed"]);
  const alternative = { ...run.failureEvent, id: "alternate-failure", relatedStateKeys: ["deployment_target"], expected: { deployment_target: "us-west-2" }, actual: { deployment_target: "us-east-1" } };
  await run.store.appendEvent(alternative);
  assert.equal((await analyzeFailure(run.store, alternative.id)).suspectedOrigin?.stateVersion, 8);
}));

test("Autopsy report is separate and never mutates canonical state or recorded history", async () => withBase(async (base) => {
  const run = await runAutopsyScenario(base);
  const stateBefore = await run.store.loadState();
  const eventsBefore = await readFile(join(run.directory, "events.jsonl"), "utf8");
  const diffsBefore = await readFile(join(run.directory, "diffs.jsonl"), "utf8");
  const versionsBefore = await run.store.stateVersions();
  const report = await runAutopsy(run.store, run.failureEvent.id);
  assert.equal(report.id, "autopsy-0001");
  assert.equal((await latestAutopsyReport(run.store))?.suspectedOrigin?.stateVersion, 6);
  assert.deepEqual(await run.store.loadState(), stateBefore);
  assert.equal(await readFile(join(run.directory, "events.jsonl"), "utf8"), eventsBefore);
  assert.equal(await readFile(join(run.directory, "diffs.jsonl"), "utf8"), diffsBefore);
  assert.deepEqual(await run.store.stateVersions(), versionsBefore);
  const later = await runAutopsyScenario(base);
  assert.notEqual(later.id, run.id);
  assert.equal((await currentAutopsyRun(base))?.id, later.id);
  assert.equal((await latestAutopsyReport(run.store))?.id, report.id);
  assert.equal((await run.store.getStateAtVersion(5)).stateVersion, 5);
}));
