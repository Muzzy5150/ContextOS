import { NextRequest, NextResponse } from "next/server";
import { runAutopsy, latestAutopsyReport } from "../../../../../packages/core/autopsy";
import { currentAutopsyRun, runAutopsyScenario } from "../../../../../scenarios/autopsy-demo";
import { recordAutopsyTelemetry } from "../../../../../packages/telemetry";
import { resolve } from "node:path";
export const runtime = "nodejs";
export async function POST(request: NextRequest) {
  const body = await request.json().catch(() => null) as { action?: string } | null;
  try {
    if (body?.action === "scenario") {
      const run = await runAutopsyScenario();
      return NextResponse.json({ runId: run.id, failureEventId: run.failureEvent.id });
    }
    if (body?.action === "analyze") {
      const run = await currentAutopsyRun();
      if (!run) throw new Error("AUTOPSY RUN NOT FOUND");
      const events = await run.store.loadEvents();
      const failure = [...events].reverse().find((entry) => entry.type === "mission_failure");
      if (!failure) throw new Error("MISSION FAILURE NOT FOUND");
      const existing = await latestAutopsyReport(run.store);
      if (!existing) await recordAutopsyTelemetry(resolve(run.store.directoryPath, "../.."), run.id, "autopsy_started");
      const report = existing ?? await runAutopsy(run.store, failure.id);
      if (!existing) await recordAutopsyTelemetry(resolve(run.store.directoryPath, "../.."), run.id, "autopsy_completed", report.suspectedOrigin?.stateVersion, report.suspectedOrigin?.confidence);
      return NextResponse.json({ reportId: report.id, suspectedOrigin: report.suspectedOrigin?.stateVersion });
    }
    return NextResponse.json({ error: "Invalid action" }, { status: 400 });
  } catch (error) { return NextResponse.json({ error: error instanceof Error ? error.message : "Autopsy action failed" }, { status: 409 }); }
}
