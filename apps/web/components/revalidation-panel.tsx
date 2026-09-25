"use client";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { RevalidationDashboard } from "../../../packages/agent/revalidation";
import { activeFacts } from "../../../packages/core/state";

export function RevalidationPanel({ data, liveReady }: { data: RevalidationDashboard | null; liveReady: boolean }) {
  const router = useRouter();
  const [busy, setBusy] = useState<"start" | "revalidate" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const fact = data ? activeFacts(data.state).find((entry) => entry.key === "api_version") : null;
  const evidence = [...(data?.events ?? [])].reverse().find((entry) => entry.type === "external_evidence_received");
  const lastDiff = data?.diffs.at(-1);
  async function act(action: "start" | "revalidate", mode: "DEMO" | "LIVE" = "DEMO") {
    setBusy(action); setError(null);
    try {
      const response = await fetch("/api/revalidation", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action, mode }) });
      if (!response.ok) { const json = await response.json().catch(() => null) as { error?: string } | null; throw new Error(json?.error ?? "Revalidation failed"); }
      router.refresh();
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Revalidation failed"); }
    finally { setBusy(null); }
  }
  return <div className="revalidation-inspector" id="revalidate">
    <div className="section-label">FACT INSPECTOR / REVALIDATION WORKSPACE <span>{data?.mode ?? "STANDBY"}</span></div>
    {fact ? <>
      <div className="inspector-row"><span>Key</span><strong>{fact.key}</strong></div>
      <div className="inspector-row"><span>Value</span><strong>{fact.value}</strong></div>
      <div className="inspector-row"><span>Freshness</span><strong className={fact.freshness?.status === "stale" ? "status-stopping" : "telemetry-green"}>{fact.freshness?.status?.toUpperCase() ?? "UNKNOWN"}</strong></div>
      <div className="inspector-row"><span>Evidence</span><strong>{evidence ? evidence.provider === "nimble" ? "NIMBLE LIVE" : "DEMO EVIDENCE" : "AWAITING"}</strong></div>
      {lastDiff ? <div className="inspector-diff"><span>− {lastDiff.before}</span><strong>+ {lastDiff.after}</strong></div> : null}
    </> : <p className="empty-state">Seed a stale fact to inspect its revalidation path.</p>}
    <div className="inspector-actions"><button onClick={() => act("start")} disabled={busy !== null}>{busy === "start" ? "STARTING" : "SEED DEMO FACT"}</button><button onClick={() => act("start", "LIVE")} disabled={busy !== null || !liveReady} title={liveReady ? "Start with Nimble and configured LIVE Second Brain" : "Configure Nimble and a LIVE Second Brain"}>SEED LIVE FACT</button><button onClick={() => act("revalidate")} disabled={busy !== null || !fact || fact.freshness?.status !== "stale"}>{busy === "revalidate" ? "CHECKING" : "REVALIDATE"}</button></div>
    {error ? <p className="inspector-error" role="alert">{error}</p> : null}
  </div>;
}
