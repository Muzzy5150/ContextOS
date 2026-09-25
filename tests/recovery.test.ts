import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { prepareRecoveryMidpoint, recoveryContext } from "../packages/agent/recovery";
import { runRecoveryDemo } from "../packages/agent/recovery-demo";
import { createSavepoint, readVerifiedSavepoint, restoreSavepoint } from "../packages/core/savepoints";
import { activeFacts } from "../packages/core/state";
import { JsonFileStorage } from "../packages/core/storage";

async function withStore(run: (store: JsonFileStorage) => Promise<void>) {
  const directory = await mkdtemp(join(tmpdir(), "contextos-recovery-"));
  try { await run(new JsonFileStorage(directory)); } finally { await rm(directory, { recursive: true, force: true }); }
}
test("savepoint persists canonical state, context, checksum, and unique sequence without changing state", async () => withStore(async (store) => {
  const before = await prepareRecoveryMidpoint(store);
  const first = await createSavepoint(store, "manual");
  const second = await createSavepoint(store, "manual");
  assert.equal(first.savepoint.id, "sp-0001"); assert.equal(second.savepoint.id, "sp-0002");
  assert.equal(first.savepoint.stateVersion, before.stateVersion);
  assert.equal(first.savepoint.agentState.completedTurns, 2);
  assert.equal(first.savepoint.agentState.facts.find((x) => x.key === "api_version" && x.status === "active")?.value, "v2");
  assert.equal(first.savepoint.agentState.openLoops.filter((x) => x.status === "active").length, 1);
  assert.equal(first.savepoint.agentState.nextActions.find((x) => x.status === "active")?.text, "Run endpoint verification.");
  assert.ok(first.bytes > 0);
  assert.equal((await readVerifiedSavepoint(store, first.savepoint.id)).savepoint.integrity.checksum.length, 64);
  assert.equal((await store.loadState())?.stateVersion, before.stateVersion);
  await assert.rejects(() => store.writeSavepoint(first.savepoint.id, "{}"), /SAVEPOINT ALREADY EXISTS/);
}));

test("corrupt, unsupported, missing savepoints abort with canonical state and history unchanged", async () => withStore(async (store) => {
  await prepareRecoveryMidpoint(store);
  const { savepoint } = await createSavepoint(store);
  const stateBefore = await store.loadState();
  const eventsBefore = await store.loadEvents();
  const diffsBefore = await store.loadDiffs();
  const path = join(store.directoryPath, "savepoints", `${savepoint.id}.json`);
  const original = await readFile(path, "utf8");
  const changed = JSON.parse(original); changed.agentState.facts[1].value = "v3";
  await writeFile(path, JSON.stringify(changed));
  await assert.rejects(() => restoreSavepoint(store, savepoint.id), /CHECKSUM FAILURE/);
  changed.integrity.schemaVersion = 99;
  await writeFile(path, JSON.stringify(changed));
  await assert.rejects(() => restoreSavepoint(store, savepoint.id), /UNSUPPORTED SCHEMA/);
  await writeFile(path, "not JSON");
  await assert.rejects(() => restoreSavepoint(store, savepoint.id), /SAVEPOINT INVALID/);
  await assert.rejects(() => restoreSavepoint(store, "sp-9999"), /SAVEPOINT NOT FOUND/);
  assert.deepEqual(await store.loadState(), stateBefore);
  assert.deepEqual(await store.loadEvents(), eventsBefore);
  assert.deepEqual(await store.loadDiffs(), diffsBefore);
}));

test("restore creates an auditable new version without reading event history", async () => withStore(async (store) => {
  await prepareRecoveryMidpoint(store);
  const { savepoint } = await createSavepoint(store);
  const oldEvents = await store.loadEvents(); const oldDiffs = await store.loadDiffs();
  const state = await store.loadState();
  state!.facts.find((x) => x.key === "api_version" && x.status === "active")!.value = "v3";
  state!.stateVersion++;
  await store.saveState(state!);
  const originalLoadEvents = store.loadEvents.bind(store);
  store.loadEvents = async () => { throw new Error("FULL HISTORY MUST NOT BE READ"); };
  const restored = await restoreSavepoint(store, savepoint.id);
  store.loadEvents = originalLoadEvents;
  assert.equal(restored.historyEventsReplayed, 0);
  assert.equal(restored.resultingStateVersion, state!.stateVersion + 1);
  assert.equal(restored.state.restoredFromSavepoint, savepoint.id);
  assert.equal(restored.state.restoredFromStateVersion, savepoint.stateVersion);
  assert.equal(activeFacts(restored.state).find((x) => x.key === "api_version")?.value, "v2");
  assert.equal(restored.state.facts.find((x) => x.value === "v1")?.status, "superseded");
  assert.equal(restored.state.openLoops.filter((x) => x.status === "active").length, 1);
  assert.equal(restored.state.nextActions.find((x) => x.status === "active")?.text, "Run endpoint verification.");
  assert.match(restored.compiledContext, /api_version = v2/);
  assert.doesNotMatch(restored.compiledContext, /api_version = v1/);
  assert.ok((await store.loadEvents()).length > oldEvents.length);
  assert.ok((await store.loadDiffs()).length > oldDiffs.length);
  assert.equal((await store.loadDiffs()).at(-1)?.mutationType, "RESTORE_SAVEPOINT");
  assert.equal((await recoveryContext(store)).historyEventsReplayed, 0);
}));

test("recovery demo kills only its owned worker; fresh PID receives state and continues", async () => withStore(async (store) => {
  const unrelated = spawn(process.execPath, ["-e", "setInterval(() => {}, 1000)"], { stdio: "ignore" });
  try {
    const proof = await runRecoveryDemo(store);
    assert.notEqual(proof.oldPid, proof.newPid);
    assert.equal(proof.termination.pid, proof.oldPid);
    assert.equal(proof.termination.signal, "SIGKILL");
    assert.equal(proof.termination.gone, true);
    assert.equal(unrelated.exitCode, null);
    assert.equal(unrelated.signalCode, null);
    assert.equal(proof.freshContext.historyEventsReplayed, 0);
    assert.equal(proof.freshContext.nextAction, "Run endpoint verification.");
    assert.equal(proof.continued.verified, true);
    assert.equal(proof.continued.completedTurns, 3);
    assert.equal(proof.continued.apiVersion, "v2");
    assert.deepEqual(await store.stateVersions(), [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11]);
    assert.equal((await store.getStateAtVersion(11)).restoredFromSavepoint, proof.savepoint.id);
  } finally { unrelated.kill("SIGTERM"); }
}));
