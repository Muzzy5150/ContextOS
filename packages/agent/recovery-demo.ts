import { activeFacts } from "../core/state";
import { JsonFileStorage } from "../core/storage";
import { Savepoint, RecoveryResult } from "../core/savepoints";
import { WorkerSupervisor } from "./supervisor";

type Midpoint = { stateVersion: number; apiVersion: string; openLoops: number; nextAction: string };
type Context = { pid: number; stateVersion: number; apiVersion: string; openLoops: number; nextAction: string; compiledContext: string; estimatedTokens: number; historyEventsReplayed: 0 };
type Continuation = { stateVersion: number; completedTurns: number; apiVersion: string; openLoops: number; verified: boolean; workerOutput: string };
export interface RecoveryProof { savepoint: Savepoint; savepointBytes: number; rawHistoryBytes: number; oldPid: number; termination: { pid: number; signal: "SIGKILL"; gone: boolean }; newPid: number; before: Midpoint; restored: RecoveryResult; freshContext: Context; continued: Continuation }
export async function runRecoveryDemo(store: JsonFileStorage): Promise<RecoveryProof> {
  const first = new WorkerSupervisor(store);
  const second = new WorkerSupervisor(store);
  let firstAlive = false;
  let secondAlive = false;
  try {
    const oldPid = await first.start(); firstAlive = true;
    const before = await first.request("prepare") as Midpoint;
    if (before.apiVersion !== "v2" || before.openLoops !== 1 || !before.nextAction) throw new Error("Recovery midpoint is incomplete");
    const { savepoint, bytes: savepointBytes } = await first.request("save") as { savepoint: Savepoint; bytes: number };
    const rawHistoryBytes = await store.rawHistoryBytes();
    const termination = await first.kill(); firstAlive = false;
    if (!termination.gone) throw new Error("WORKER PROCESS LOST could not be verified");
    const newPid = await second.start(); secondAlive = true;
    if (newPid === oldPid) throw new Error("Fresh worker reused the old PID");
    const restored = await second.restore(savepoint.id) as RecoveryResult;
    const freshContext = await second.request("context") as Context;
    if (freshContext.pid !== newPid || freshContext.apiVersion !== "v2" || freshContext.openLoops !== 1 || freshContext.nextAction !== before.nextAction || freshContext.historyEventsReplayed !== 0 || !freshContext.compiledContext.includes("api_version = v2") || freshContext.compiledContext.includes("api_version = v1")) throw new Error("Fresh worker did not receive restored canonical context");
    const continued = await second.request("continue") as Continuation;
    if (!continued.verified || continued.completedTurns !== 3 || continued.apiVersion !== "v2" || continued.openLoops !== 0 || !continued.workerOutput.includes("v2")) throw new Error("Mission did not continue after recovery");
    const current = await store.loadState();
    if (activeFacts(current!).find((x) => x.key === "api_version")?.value !== "v2") throw new Error("Canonical state lost API v2");
    return { savepoint, savepointBytes, rawHistoryBytes, oldPid, termination, newPid, before, restored, freshContext, continued };
  } finally {
    if (firstAlive) await first.stop().catch(() => {});
    if (secondAlive) await second.stop().catch(() => {});
  }
}
