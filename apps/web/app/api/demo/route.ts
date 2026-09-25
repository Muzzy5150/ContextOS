import { NextRequest, NextResponse } from "next/server";
import { advanceCurrent, resetScenario, runFullDemo, runFullLive } from "../../../../../packages/agent/runtime";
import { RuntimeMode } from "../../../../../packages/agent/provider";
export const runtime = "nodejs";
export const maxDuration = 300;
export async function POST(request: NextRequest) {
  const body: unknown = await request.json().catch(() => null);
  const action = typeof body === "object" && body !== null && "action" in body ? body.action : null;
  const mode = typeof body === "object" && body !== null && "mode" in body ? body.mode : null;
  if (action !== "advance" && action !== "reset" && action !== "run") return NextResponse.json({ error: "Invalid action" }, { status: 400 });
  if (mode !== null && mode !== "DEMO" && mode !== "LIVE") return NextResponse.json({ error: "Invalid mode" }, { status: 400 });
  try {
    const selectedMode: RuntimeMode = mode === "LIVE" ? "LIVE" : "DEMO";
    const data = action === "reset" ? await resetScenario(selectedMode) : action === "run" ? selectedMode === "LIVE" ? await runFullLive() : await runFullDemo() : await advanceCurrent();
    return NextResponse.json({ mode: data.mode, stateVersion: data.state.stateVersion, completedTurns: data.completedTurns });
  } catch (error) { return NextResponse.json({ error: error instanceof Error ? error.message : "Scenario action failed" }, { status: 500 }); }
}
