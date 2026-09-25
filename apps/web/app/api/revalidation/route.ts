import { NextRequest, NextResponse } from "next/server";
import { revalidateFact, revalidationStore, startRevalidationScenario } from "../../../../../packages/agent/revalidation";
export const runtime = "nodejs";
export async function POST(request: NextRequest) {
  const body: unknown = await request.json().catch(() => null);
  const action = body && typeof body === "object" && "action" in body ? body.action : null;
  const mode = body && typeof body === "object" && "mode" in body ? body.mode : null;
  if (action !== "start" && action !== "revalidate") return NextResponse.json({ error: "Invalid action" }, { status: 400 });
  if (mode !== null && mode !== "DEMO" && mode !== "LIVE") return NextResponse.json({ error: "Invalid mode" }, { status: 400 });
  try {
    const result = action === "start" ? await startRevalidationScenario(mode === "LIVE" ? "LIVE" : "DEMO") : await revalidateFact();
    await revalidationStore.flushTelemetry();
    return NextResponse.json({ stateVersion: result.state.stateVersion, mode: result.mode });
  } catch (cause) { return NextResponse.json({ error: cause instanceof Error ? cause.message : "Revalidation failed" }, { status: 500 }); }
}
