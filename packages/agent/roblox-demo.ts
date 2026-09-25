import { runAutopsy, AutopsyReport } from "../core/autopsy";
import { RecoveryResult, Savepoint } from "../core/savepoints";
import { activeFacts, AgentEvent, AgentState, StateDiff } from "../core/state";
import { WorkerSupervisor } from "./supervisor";
import { robloxBaseDirectory, startRobloxScenario } from "../../scenarios/roblox-checkpoint-demo";

interface WorkerContext {
  pid: number; stateVersion: number; compiledContext: string; estimatedTokens: number; historyEventsReplayed: 0;
  openLoop: string | null; nextAction: string | null; redSpawnExposed: string | undefined; traversalPassed: string | undefined;
}
export interface RobloxCheckpointProof {
  runId: string; savepoint: Savepoint; savepointBytes: number; oldPid: number; termination: { pid: number; signal: "SIGKILL"; gone: boolean };
  newPid: number; restored: RecoveryResult; freshContext: WorkerContext; continued: { stateVersion: number; verified: boolean; pid: number };
  requirementDiff: StateDiff; faultDiff: StateDiff; failure: AgentEvent; report: AutopsyReport; finalState: AgentState;
}
export async function runRobloxCheckpointDemo(baseDirectory = robloxBaseDirectory): Promise<RobloxCheckpointProof> {
  const run = await startRobloxScenario(baseDirectory);
  const original = new WorkerSupervisor(run.store);
  const fresh = new WorkerSupervisor(run.store);
  let originalAlive = false;
  let freshAlive = false;
  try {
    const oldPid = await original.start(); originalAlive = true;
    await original.request("roblox-prepare");
    const { savepoint, bytes: savepointBytes } = await original.request("save") as { savepoint: Savepoint; bytes: number };
    const saved = savepoint.agentState;
    if (savepoint.stateVersion !== saved.stateVersion || activeFacts(saved).find((fact) => fact.key === "red_spawn_exposed")?.value !== "false" ||
        saved.openLoops.filter((item) => item.status === "active").length !== 1 || saved.nextActions.find((item) => item.status === "active")?.text !== "Run Blue spawn verification.") throw new Error("ROBLOX SAVEPOINT INCOMPLETE");
    const termination = await original.kill(); originalAlive = false;
    if (!termination.gone || termination.pid !== oldPid) throw new Error("ROBLOX WORKER LOSS NOT VERIFIED");
    const newPid = await fresh.start(); freshAlive = true;
    if (newPid === oldPid) throw new Error("ROBLOX FRESH WORKER PID DID NOT CHANGE");
    const restored = await fresh.restore(savepoint.id) as RecoveryResult;
    const freshContext = await fresh.request("roblox-context") as WorkerContext;
    if (freshContext.pid !== newPid || freshContext.historyEventsReplayed !== 0 || restored.historyEventsReplayed !== 0 ||
        freshContext.openLoop !== "Verify Blue spawn sightline." || freshContext.nextAction !== "Run Blue spawn verification." ||
        freshContext.redSpawnExposed !== "false" || freshContext.traversalPassed !== "42" ||
        !freshContext.compiledContext.includes("blue_spawn = north")) throw new Error("ROBLOX RESTORED CONTEXT INCOMPLETE");
    const continued = await fresh.request("roblox-continue") as RobloxCheckpointProof["continued"];
    if (!continued.verified || continued.pid !== newPid) throw new Error("ROBLOX MISSION DID NOT CONTINUE");
    const requirementDiff = await fresh.request("roblox-requirement") as StateDiff;
    if (requirementDiff.before !== "24" || requirementDiff.after !== "32") throw new Error("ROBLOX REQUIREMENT SUPERSESSION FAILED");
    const faultDiff = await fresh.request("roblox-fault") as StateDiff;
    const failure = await fresh.request("roblox-failure") as AgentEvent;
    const report = await runAutopsy(run.store, failure.id);
    const finalState = await run.store.loadState();
    if (!finalState || faultDiff.subject !== "FACT / blue_spawn" || faultDiff.before !== "north" || faultDiff.after !== "east" ||
        failure.actual?.blue_spawn !== "east" || failure.expected?.blue_spawn !== "north" ||
        report.suspectedOrigin?.diffId !== faultDiff.id || report.recommendedHealthyVersion !== faultDiff.stateVersion - 1 ||
        activeFacts(finalState).find((fact) => fact.key === "blue_spawn")?.value !== "east") throw new Error("ROBLOX AUTOPSY PROOF FAILED");
    return { runId: run.id, savepoint, savepointBytes, oldPid, termination, newPid, restored, freshContext, continued, requirementDiff, faultDiff, failure, report, finalState };
  } finally {
    if (originalAlive) await original.stop().catch(() => {});
    if (freshAlive) await fresh.stop().catch(() => {});
  }
}
