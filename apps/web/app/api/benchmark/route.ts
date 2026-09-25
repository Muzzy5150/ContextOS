import { NextResponse } from "next/server";
import { runLongHorizonBenchmark } from "../../../../../scenarios/long-horizon-benchmark";
export const runtime = "nodejs";
export async function POST() {
  try {
    const result = await runLongHorizonBenchmark();
    return NextResponse.json({ runId: result.runId, summary: result.summary });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Benchmark failed" }, { status: 500 });
  }
}
