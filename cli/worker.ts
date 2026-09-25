import { createInterface } from "node:readline";
import { resolve } from "node:path";
import { JsonFileStorage } from "../packages/core/storage";
import { createSavepoint, restoreSavepoint } from "../packages/core/savepoints";
import { continueRecoveryMission, prepareRecoveryMidpoint, recoveryContext } from "../packages/agent/recovery";
import { advanceDemo, resetDemo } from "../packages/agent/runtime";
import { createTelemetryPipeline } from "../packages/telemetry";
import { continueRobloxMission, failRobloxVerification, injectRobloxFault, prepareRobloxCheckpoint, robloxRunForStore, robloxWorkerContext, supersedeRobloxRequirement } from "../scenarios/roblox-checkpoint-demo";

const workerDirectory = process.env.CONTEXTOS_DATA_DIR ?? resolve(process.cwd(), "data");
const store = new JsonFileStorage(workerDirectory, createTelemetryPipeline(workerDirectory));
const lineReader = createInterface({ input: process.stdin });
lineReader.on("line", async (line) => {
  let id: number | undefined;
  try {
    const request = JSON.parse(line) as { id: number; action: string; savepointId?: string };
    id = request.id;
    let result: unknown;
    switch (request.action) {
      case "ping": result = { pid: process.pid }; break;
      case "prepare": result = await prepareRecoveryMidpoint(store); break;
      case "context": result = await recoveryContext(store); break;
      case "continue": result = await continueRecoveryMission(store); break;
      case "save": result = await createSavepoint(store, "scenario"); break;
      case "restore": if (!request.savepointId) throw new Error("SAVEPOINT NOT FOUND"); result = await restoreSavepoint(store, request.savepointId); break;
      case "reset": result = { stateVersion: (await resetDemo(store)).state.stateVersion }; break;
      case "advance": result = { stateVersion: (await advanceDemo(store)).state.stateVersion }; break;
      case "roblox-prepare": result = await prepareRobloxCheckpoint(await robloxRunForStore(store)); break;
      case "roblox-context": result = await robloxWorkerContext(await robloxRunForStore(store)); break;
      case "roblox-continue": result = await continueRobloxMission(await robloxRunForStore(store)); break;
      case "roblox-requirement": result = await supersedeRobloxRequirement(await robloxRunForStore(store)); break;
      case "roblox-fault": result = await injectRobloxFault(await robloxRunForStore(store)); break;
      case "roblox-failure": result = await failRobloxVerification(await robloxRunForStore(store)); break;
      case "shutdown": process.stdout.write(JSON.stringify({ id, ok: true, result: { pid: process.pid } }) + "\n", () => process.exit(0)); return;
      default: throw new Error("Unknown worker action");
    }
    process.stdout.write(JSON.stringify({ id, ok: true, result }) + "\n");
  } catch (error) { process.stdout.write(JSON.stringify({ id, ok: false, error: error instanceof Error ? error.message : "Worker error" }) + "\n"); }
});
