import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { activeFacts } from "../packages/core/state";
import { currentRobloxRun } from "../scenarios/roblox-checkpoint-demo";
import { loadRobloxPresentation, presentationMapState, RobloxPresentationSession } from "../scenarios/roblox-presentation";

test("presentation steps use real saved state, worker recovery, and persisted Autopsy", async () => {
  const base = await mkdtemp(join(tmpdir(), "contextos-presentation-"));
  const session = new RobloxPresentationSession(base);
  try {
    let data = await session.reset();
    assert.equal(data.completedStep, 0);
    assert.equal(data.frames[0].state.stateVersion, 1);
    for (let step = 1; step <= 13; step++) {
      data = await session.next();
      assert.equal(data.completedStep, step);
      const frame = data.frames.at(-1)!;
      assert.equal(frame.step, step);
      if (step === 1) assert.equal(frame.state.openLoops.find((item) => item.status === "active")?.text, "Fix Red spawn exposure.");
      if (step === 2) assert.equal(presentationMapState(frame.state, step).redExposed, false);
      if (step === 3) {
        assert.equal(presentationMapState(frame.state, step).traversalPassed, 42);
        assert.equal(frame.state.nextActions.find((item) => item.status === "active")?.text, "Run Blue spawn verification.");
      }
      if (step === 4) {
        assert.ok(data.savepoint);
        assert.equal(data.savepoint.stateVersion, frame.state.stateVersion);
        assert.equal(frame.state.openLoops.find((item) => item.status === "active")?.text, "Verify Blue spawn sightline.");
      }
      if (step === 5) assert.ok(data.oldPid && data.oldPid > 0);
      if (step === 6) {
        assert.equal(frame.workerPid, data.oldPid);
        assert.throws(() => process.kill(data.oldPid!, 0), { code: "ESRCH" });
      }
      if (step === 7) {
        assert.ok(data.newPid && data.newPid !== data.oldPid);
        assert.equal(data.historyEventsReplayed, 0);
        assert.equal(data.restoredNextAction, "Run Blue spawn verification.");
      }
      if (step === 8) assert.equal(frame.state.openLoops.filter((item) => item.status === "active").length, 0);
      if (step === 9) {
        assert.equal(activeFacts(frame.state).find((item) => item.key === "spawn_clearance")?.value, "32");
        assert.ok(frame.diffs.some((diff) => diff.before === "24" && diff.after === "32"));
      }
      if (step === 10) {
        assert.equal(presentationMapState(frame.state, step).blueSpawn, "east");
        assert.ok(frame.diffs.some((diff) => diff.before === "north" && diff.after === "east"));
      }
      if (step === 11) {
        assert.deepEqual(data.failure?.expected, { blue_spawn: "north" });
        assert.deepEqual(data.failure?.actual, { blue_spawn: "east" });
      }
      if (step === 12) {
        assert.equal(data.report?.suspectedOrigin?.key, "blue_spawn");
        assert.equal(data.report?.recommendedHealthyVersion, data.report!.suspectedOrigin!.stateVersion - 1);
        assert.equal(data.report?.failureStateVersion, data.failure?.stateVersion);
      }
      if (step === 13) assert.equal(data.benchmark?.summary.steps, 120);
    }
    const run = await currentRobloxRun(base);
    assert.ok(run);
    const before = await run.store.loadState();
    const inspected = await loadRobloxPresentation(base);
    assert.equal(inspected?.frames[4].state.nextActions.find((item) => item.status === "active")?.text, "Run Blue spawn verification.");
    assert.deepEqual(await run.store.loadState(), before);
    const reset = await session.reset();
    assert.equal(reset.completedStep, 0);
    assert.notEqual(reset.runId, data.runId);
    assert.equal(reset.savepoint, null);
  } finally { await session.stop(); await rm(base, { recursive: true, force: true }); }
});
