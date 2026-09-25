import { NextRequest, NextResponse } from "next/server";
import { RobloxPresentationSession } from "../../../../../scenarios/roblox-presentation";

export const runtime = "nodejs";
const shared = globalThis as typeof globalThis & { __contextosPresentation?: RobloxPresentationSession };
function session() { return shared.__contextosPresentation ??= new RobloxPresentationSession(); }

export async function POST(request: NextRequest) {
  const body = await request.json().catch(() => null) as { action?: string } | null;
  if (body?.action !== "reset" && body?.action !== "next") return NextResponse.json({ error: "Invalid action" }, { status: 400 });
  try {
    const data = body.action === "reset" ? await session().reset() : await session().next();
    return NextResponse.json(data, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Presentation action failed" }, { status: 409 });
  }
}
