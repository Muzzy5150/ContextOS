"use client";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { RuntimeMode } from "../../../packages/agent/provider";
export function DemoControls({ completedTurns, mode, liveReady }: { completedTurns: number; mode: RuntimeMode; liveReady: boolean }) {
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  async function act(action: "advance" | "reset" | "run", targetMode: RuntimeMode = mode) {
    setBusy(action); setError(null);
    try {
      const response = await fetch("/api/demo", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action, mode: targetMode }) });
      if (!response.ok) { const data = await response.json().catch(() => null) as { error?: string } | null; throw new Error(data?.error ?? `Scenario action failed (${response.status})`); }
      router.refresh();
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Action failed"); }
    finally { setBusy(null); }
  }
  return <div className="controls"><div className="mode-controls"><button className={mode === "DEMO" ? "mode-active" : ""} onClick={() => act("reset", "DEMO")} disabled={busy !== null}>DEMO</button><button className={mode === "LIVE" ? "mode-active" : ""} onClick={() => act("reset", "LIVE")} disabled={busy !== null || !liveReady} title={liveReady ? "Start LIVE scenario" : "Configure both live brain providers to enable"}>LIVE</button></div><button className="control-primary" onClick={() => act("advance")} disabled={busy !== null || completedTurns >= 3}><span className="control-icon">▶</span>{busy === "advance" ? "PROCESSING" : "ADVANCE TURN"}</button><button onClick={() => act("run")} disabled={busy !== null}>{busy === "run" ? "RUNNING" : "RUN SCENARIO"}</button><button onClick={() => act("reset")} disabled={busy !== null}>{busy === "reset" ? "RESETTING" : "RESET"}</button>{error ? <span className="control-error" role="alert">{error}</span> : null}</div>;
}
