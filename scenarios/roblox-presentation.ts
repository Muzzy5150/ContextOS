import { randomUUID } from "node:crypto";
import { join } from "node:path";
import { WorkerSupervisor, readContinuityStatus } from "../packages/agent/supervisor";
import { runAutopsy, latestAutopsyReport, AutopsyReport } from "../packages/core/autopsy";
import { createSavepoint, latestSavepoint, readVerifiedSavepoint } from "../packages/core/savepoints";
import { AgentEvent, AgentState, StateDiff } from "../packages/core/state";
import { BenchmarkResult, latestBenchmark, runLongHorizonBenchmark } from "./long-horizon-benchmark";
import { currentRobloxRun, decideRedSpawn, failRobloxVerification, injectRobloxFault, inspectRobloxMap, recordTraversalProgress, robloxBaseDirectory, RobloxRun, startRobloxScenario, supersedeRobloxRequirement } from "./roblox-checkpoint-demo";

export const presentationBaseDirectory = join(robloxBaseDirectory, "presentation");
const marker = (step: number) => `presentation-step:${step}`;
export interface PresentationFrame {
  step: number;
  state: AgentState;
  diffs: StateDiff[];
  eventId: string;
  workerPid?: number;
  savepointId?: string;
}
export interface PresentationData {
  runId: string;
  completedStep: number;
  frames: PresentationFrame[];
  savepoint: { id: string; stateVersion: number; bytes: number } | null;
  oldPid: number | null;
  newPid: number | null;
  historyEventsReplayed: number | null;
  restoredNextAction: string | null;
  failure: AgentEvent | null;
  report: AutopsyReport | null;
  benchmark: Pick<BenchmarkResult, "summary" | "perStep"> | null;
}

async function recordStep(run: RobloxRun, step: number, workerPid?: number, savepointId?: string): Promise<void> {
  const state = await run.store.loadState();
  if (!state) throw new Error("PRESENTATION STATE NOT FOUND");
  await run.store.appendEvent({ id: randomUUID(), type: "action_observed", timestamp: new Date().toISOString(), message: `Presentation step ${step} completed.`, detail: marker(step), stateVersion: state.stateVersion, runId: run.id, scenario: "roblox_checkpoint", mode: "DEMO", workerPid, savepointId });
}

export async function loadRobloxPresentation(baseDirectory = presentationBaseDirectory): Promise<PresentationData | null> {
  const run = await currentRobloxRun(baseDirectory);
  if (!run) return null;
  const [events, diffs, savepointId, continuity, report, benchmark] = await Promise.all([
    run.store.loadEvents(), run.store.loadDiffs(), latestSavepoint(run.store), readContinuityStatus(run.store), latestAutopsyReport(run.store), latestBenchmark()
  ]);
  const markers = events.filter((entry) => entry.detail?.startsWith("presentation-step:"));
  const frames = await Promise.all(markers.map(async (entry): Promise<PresentationFrame> => {
    const step = Number(entry.detail!.slice("presentation-step:".length));
    if (!Number.isInteger(step) || step < 0 || step > 13 || !entry.stateVersion) throw new Error("PRESENTATION STEP INVALID");
    const previous = [...markers].reverse().find((candidate) => Number(candidate.detail?.slice("presentation-step:".length)) === step - 1);
    const version = entry.stateVersion;
    return { step, state: await run.store.getStateAtVersion(version), diffs: diffs.filter((diff) => diff.stateVersion > (previous?.stateVersion ?? 0) && diff.stateVersion <= version), eventId: entry.id, workerPid: entry.workerPid, savepointId: entry.savepointId };
  }));
  const saved = savepointId ? await readVerifiedSavepoint(run.store, savepointId) : null;
  const restoreFrame = frames.find((frame) => frame.step === 7);
  const restoredNextAction = restoreFrame?.state.nextActions.find((item) => item.status === "active")?.text ?? null;
  return {
    runId: run.id, completedStep: frames.at(-1)?.step ?? -1, frames,
    savepoint: saved ? { id: saved.savepoint.id, stateVersion: saved.savepoint.stateVersion, bytes: saved.bytes } : null,
    oldPid: continuity.oldPid ?? frames.find((frame) => frame.step === 5)?.workerPid ?? null,
    newPid: continuity.newPid ?? frames.find((frame) => frame.step === 7)?.workerPid ?? null,
    historyEventsReplayed: continuity.historyEventsReplayed ?? null, restoredNextAction,
    failure: [...events].reverse().find((entry) => entry.type === "mission_failure") ?? null,
    report,
    benchmark: benchmark ? { summary: benchmark.summary, perStep: benchmark.perStep } : null
  };
}

export class RobloxPresentationSession {
  private supervisor: WorkerSupervisor | null = null;
  private runId: string | null = null;
  private inFlight = false;
  constructor(readonly baseDirectory = presentationBaseDirectory) {}
  async reset(): Promise<PresentationData> {
    if (this.inFlight) throw new Error("PRESENTATION ACTION IN PROGRESS");
    this.inFlight = true;
    try {
      if (this.supervisor?.pid) await this.supervisor.stop();
      const run = await startRobloxScenario(this.baseDirectory);
      this.supervisor = new WorkerSupervisor(run.store);
      this.runId = run.id;
      await recordStep(run, 0);
      return (await loadRobloxPresentation(this.baseDirectory))!;
    } finally { this.inFlight = false; }
  }
  async next(): Promise<PresentationData> {
    if (this.inFlight) throw new Error("PRESENTATION ACTION IN PROGRESS");
    this.inFlight = true;
    try {
      const run = await currentRobloxRun(this.baseDirectory);
      if (!run || !this.supervisor || run.id !== this.runId) throw new Error("PRESENTATION WORKER NOT OWNED; RESET THE DEMO");
      const events = await run.store.loadEvents();
      const completed = Number(events.filter((entry) => entry.detail?.startsWith("presentation-step:")).at(-1)?.detail?.split(":")[1] ?? -1);
      const step = completed + 1;
      let workerPid: number | undefined;
      let savepointId: string | undefined;
      switch (step) {
        case 1: await inspectRobloxMap(run); break;
        case 2: await decideRedSpawn(run); break;
        case 3: await recordTraversalProgress(run); break;
        case 4: savepointId = (await createSavepoint(run.store, "scenario")).savepoint.id; break;
        case 5: workerPid = await this.supervisor.start(); break;
        case 6: {
          const killed = await this.supervisor.kill();
          if (!killed.gone || killed.signal !== "SIGKILL") throw new Error("OWNED WORKER TERMINATION NOT VERIFIED");
          workerPid = killed.pid;
          break;
        }
        case 7: {
          savepointId = await latestSavepoint(run.store) ?? undefined;
          if (!savepointId) throw new Error("SAVEPOINT NOT FOUND");
          const result = await this.supervisor.restore(savepointId) as { historyEventsReplayed: number; state: AgentState };
          workerPid = this.supervisor.pid ?? undefined;
          const oldPid = [...events].reverse().find((entry) => entry.type === "worker_lost")?.workerPid;
          if (!workerPid || workerPid === oldPid || result.historyEventsReplayed !== 0 || !result.state.nextActions.some((item) => item.status === "active" && item.text === "Run Blue spawn verification.")) throw new Error("PRESENTATION RESTORE PROOF FAILED");
          break;
        }
        case 8: await this.supervisor.request("roblox-continue"); break;
        case 9: await supersedeRobloxRequirement(run); break;
        case 10: await injectRobloxFault(run); break;
        case 11: await failRobloxVerification(run); break;
        case 12: {
          const failure = [...events].reverse().find((entry) => entry.type === "mission_failure");
          if (!failure) throw new Error("MISSION FAILURE NOT FOUND");
          const report = await runAutopsy(run.store, failure.id);
          if (report.suspectedOrigin?.key !== "blue_spawn" || report.recommendedHealthyVersion !== report.suspectedOrigin.stateVersion - 1) throw new Error("AUTOPSY ORIGIN NOT VERIFIED");
          break;
        }
        case 13: if (!await latestBenchmark()) await runLongHorizonBenchmark(); break;
        default: throw new Error("PRESENTATION COMPLETE; RESET TO REPLAY");
      }
      await recordStep(run, step, workerPid, savepointId);
      return (await loadRobloxPresentation(this.baseDirectory))!;
    } finally { this.inFlight = false; }
  }
  async stop(): Promise<void> { if (this.supervisor?.pid) await this.supervisor.stop(); }
}

export { presentationMapState } from "./roblox-presentation-view";
