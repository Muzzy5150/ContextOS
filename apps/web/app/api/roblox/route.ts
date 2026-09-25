import { NextRequest, NextResponse } from "next/server";
import { runAutopsy } from "../../../../../packages/core/autopsy";
import { latestSavepoint } from "../../../../../packages/core/savepoints";
import { WorkerSupervisor } from "../../../../../packages/agent/supervisor";
import { currentRobloxRun, robloxStage, startRobloxScenario } from "../../../../../scenarios/roblox-checkpoint-demo";

export const runtime = "nodejs";
const shared = globalThis as typeof globalThis & { __contextosRobloxSupervisor?: WorkerSupervisor; __contextosRobloxRunId?: string };

export async function POST(request: NextRequest) {
  const body = await request.json().catch(() => null) as { action?: string } | null;
  if (body?.action !== "next" && body?.action !== "reset") return NextResponse.json({ error: "Invalid action" }, { status: 400 });
  try {
    let run = await currentRobloxRun();
    if (body.action === "reset" || !run) {
      if (shared.__contextosRobloxSupervisor?.pid) await shared.__contextosRobloxSupervisor.stop();
      run = await startRobloxScenario();
      shared.__contextosRobloxRunId = run.id;
      shared.__contextosRobloxSupervisor = new WorkerSupervisor(run.store);
      const pid = await shared.__contextosRobloxSupervisor.start();
      return NextResponse.json({ stage: "started", pid, runId: run.id });
    }
    const events = await run.store.loadEvents();
    const report = await import("../../../../../packages/core/autopsy").then(({ latestAutopsyReport }) => latestAutopsyReport(run.store));
    const stage = robloxStage(events, report);
    if (shared.__contextosRobloxRunId !== run.id) {
      if (stage !== "lost") throw new Error("DEMO WORKER NOT OWNED BY THIS SERVER; RESET THE CONTROLLED SCENARIO");
      shared.__contextosRobloxRunId = run.id;
      shared.__contextosRobloxSupervisor = new WorkerSupervisor(run.store);
    }
    const supervisor = shared.__contextosRobloxSupervisor!;
    let result: unknown;
    switch (stage) {
      case "started": result = await supervisor.request("roblox-prepare"); break;
      case "prepared": result = await supervisor.request("save"); break;
      case "saved": result = await supervisor.kill(); break;
      case "lost": {
        const savepointId = await latestSavepoint(run.store);
        if (!savepointId) throw new Error("SAVEPOINT NOT FOUND");
        result = await supervisor.restore(savepointId);
        break;
      }
      case "restored": result = await supervisor.request("roblox-continue"); break;
      case "continued": result = await supervisor.request("roblox-requirement"); break;
      case "requirement": result = await supervisor.request("roblox-fault"); break;
      case "fault": result = await supervisor.request("roblox-failure"); break;
      case "failure": {
        const failure = [...events].reverse().find((entry) => entry.type === "mission_failure");
        if (!failure) throw new Error("MISSION FAILURE NOT FOUND");
        result = await runAutopsy(run.store, failure.id);
        break;
      }
      default: throw new Error("CONTROLLED SCENARIO COMPLETE; RESET TO REPLAY");
    }
    return NextResponse.json({ stage, result });
  } catch (error) { return NextResponse.json({ error: error instanceof Error ? error.message : "Roblox demo action failed" }, { status: 409 }); }
}
