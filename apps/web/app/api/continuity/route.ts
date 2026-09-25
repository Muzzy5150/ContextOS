import { NextRequest, NextResponse } from "next/server";
import { storage } from "../../../../../packages/agent/runtime";
import { JsonFileStorage } from "../../../../../packages/core/storage";
import { createSavepoint, latestSavepoint } from "../../../../../packages/core/savepoints";
import { WorkerSupervisor } from "../../../../../packages/agent/supervisor";
export const runtime = "nodejs";
const store = storage as JsonFileStorage;
const shared = globalThis as typeof globalThis & { __contextosSupervisor?: WorkerSupervisor };
const supervisor = shared.__contextosSupervisor ?? (shared.__contextosSupervisor = new WorkerSupervisor(store));
export async function POST(request: NextRequest) {
  const body = await request.json().catch(() => null) as { action?: string } | null;
  try {
    let result: unknown;
    switch (body?.action) {
      case "start": result = { pid: await supervisor.start() }; break;
      case "save": result = await createSavepoint(store, "manual"); break;
      case "kill": result = await supervisor.kill(); break;
      case "restore": {
        const id = await latestSavepoint(store);
        if (!id) throw new Error("SAVEPOINT NOT FOUND");
        result = await supervisor.restore(id); break;
      }
      default: return NextResponse.json({ error: "Invalid action" }, { status: 400 });
    }
    return NextResponse.json({ result });
  } catch (error) { return NextResponse.json({ error: error instanceof Error ? error.message : "Continuity action failed" }, { status: 409 }); }
}
