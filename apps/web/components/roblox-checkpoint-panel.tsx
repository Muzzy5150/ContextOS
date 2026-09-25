"use client";
import { useRouter } from "next/navigation";
import { useState } from "react";
import type { RobloxDashboardData, RobloxStage } from "../../../scenarios/roblox-checkpoint-demo";

const labels: Record<RobloxStage, string> = {
  empty: "START MISSION", started: "FIX RED SPAWN", prepared: "CREATE SAVEPOINT", saved: "KILL WORKER",
  lost: "START FRESH WORKER / RESTORE", restored: "VERIFY BLUE SPAWN", continued: "CHANGE REQUIREMENT",
  requirement: "INJECT STALE MAP STATE", fault: "RUN SIGHTLINE CHECK", failure: "RUN AUTOPSY", autopsied: "DEMO COMPLETE"
};
const fact = (data: RobloxDashboardData, key: string) => data.state.facts.find((item) => item.key === key && item.status === "active")?.value ?? "—";
const clock = (timestamp: string) => new Date(timestamp).toLocaleTimeString("en-US", { hour12: false, hour: "2-digit", minute: "2-digit", second: "2-digit" });
const timelineLabel = (type: string, detail?: string) => ({
  "roblox-stage:prepared": "RED SPAWN FIXED",
  "roblox-stage:requirement": "CLEARANCE 24 → 32",
  "roblox-stage:fault": "STALE BLUE SPAWN"
})[detail ?? ""] ?? type.replaceAll("_", " ").toUpperCase();

export function RobloxCheckpointPanel({ data }: { data: RobloxDashboardData | null }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  async function act(action: "next" | "reset") {
    setBusy(true); setError(null);
    try {
      const response = await fetch("/api/roblox", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action }) });
      if (!response.ok) { const payload = await response.json().catch(() => null) as { error?: string } | null; throw new Error(payload?.error ?? `Demo action failed (${response.status})`); }
      router.refresh();
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Demo action failed"); }
    finally { setBusy(false); }
  }
  const stage = data?.stage ?? "empty";
  const events = data?.events.filter((entry) => ["scenario_started", "worker_online", "savepoint_created", "worker_lost", "savepoint_restored", "mission_continued", "mission_failure"].includes(entry.type) || entry.detail?.startsWith("roblox-stage:")).slice(-12) ?? [];
  const loop = data?.state.openLoops.find((item) => item.status === "active")?.text;
  const action = data?.state.nextActions.find((item) => item.status === "active")?.text;
  const diff = data?.diffs.at(-1);
  const origin = data?.report?.suspectedOrigin;
  const source = data?.events.find((entry) => entry.id === origin?.sourceEventId);
  return <section className="panel roblox-panel" id="roblox" aria-label="Controlled Roblox checkpoint demo">
    <div className="panel-heading"><div className="panel-title"><span className="panel-code">GAME</span><h2>ROBLOX CHECKPOINT DEMO</h2></div><span className="panel-meta">CONTROLLED WORKLOAD / REAL CONTEXTOS RUNTIME</span></div>
    <div className="roblox-body">
      <div className="roblox-lead"><div><strong>GAMES HAVE CHECKPOINTS. AGENTS SHOULD TOO.</strong><p>Context points are the mission state. Savepoints are durable checkpoints. The transcript remains an audit trail.</p></div><div className="continuity-controls"><button className="roblox-next" disabled={busy || stage === "autopsied"} onClick={() => act("next")}>{busy ? "PROCESSING..." : labels[stage]}</button><button disabled={busy} onClick={() => act("reset")}>RESET DEMO</button></div></div>
      {error ? <p className="autopsy-error" role="alert">{error}</p> : null}
      <div className="roblox-grid">
        <div className="roblox-subwindow"><div className="roblox-subhead">ROBLOX MISSION <span>ATOM TOWN / CONTROLLED FIXTURE</span></div>
          <div className="roblox-rows"><div><span>MAP</span><b>{data ? fact(data, "map_name") : "ATOM TOWN"}</b></div><div><span>RED SPAWN EXPOSED</span><b>{data ? fact(data, "red_spawn_exposed") : "—"}</b></div><div><span>TRAVERSAL</span><b>{data ? `${fact(data, "traversal_tests_passed")} / ${fact(data, "traversal_tests_total")}` : "—"}</b></div><div><span>BLUE SPAWN</span><b className={stage === "fault" || stage === "failure" || stage === "autopsied" ? "fault-text" : ""}>{data ? fact(data, "blue_spawn") : "—"}</b></div><div><span>CLEARANCE</span><b>{data ? fact(data, "spawn_clearance") : "—"}</b></div><div><span>WORKER</span><b className={data?.continuity.status === "OFFLINE" && stage === "lost" ? "fault-text" : ""}>{data ? `${data.continuity.status} / ${data.continuity.pid ?? "—"}` : "OFFLINE"}</b></div></div>
          <p className="roblox-fixture-note">Simulated map observations; no Roblox Studio control or live Roblox API calls.</p>
        </div>
        <div className="roblox-subwindow"><div className="roblox-subhead">CONTEXTOS STATE <span>STRUCTURED CONTEXT POINTS</span></div>
          <div className="roblox-rows"><div><span>CANONICAL STATE</span><b>{data ? `#${data.state.stateVersion}` : "—"}</b></div><div><span>DECISION</span><b>{data?.state.decisions.find((item) => item.status === "active")?.text ?? "—"}</b></div><div><span>CONSTRAINT</span><b>{data?.state.constraints.find((item) => item.status === "active")?.text ?? "—"}</b></div><div><span>OPEN LOOP</span><b>{loop ?? (data ? data.state.openLoops.length ? "RESOLVED" : "NOT SET" : "—")}</b></div><div><span>NEXT ACTION</span><b>{action ?? (data ? data.state.nextActions.length ? "COMPLETED" : "NOT SET" : "—")}</b></div><div><span>LATEST DIFF</span><b>{diff ? `${diff.id} / ${diff.subject}` : "—"}</b></div></div>
          {diff ? <div className="roblox-diff"><span>{diff.mutationType}</span><b>{diff.before ?? "—"} → {diff.after ?? "—"}</b></div> : null}
        </div>
      </div>
      <div className="roblox-proof"><div><span>SAVEPOINT</span><strong>{data?.savepoint?.id.toUpperCase() ?? "—"}</strong><small>{data?.savepoint ? `SAVED STATE #${data.savepoint.stateVersion}` : "AWAITING CHECKPOINT"}</small></div><div><span>OLD WORKER</span><strong>{data?.continuity.oldPid ?? data?.continuity.pid ?? "—"}</strong><small>OWNED PROCESS PID</small></div><div><span>FRESH WORKER</span><strong>{data?.continuity.newPid ?? "—"}</strong><small>SEPARATE PROCESS</small></div><div><span>HISTORY REPLAYED</span><strong>{data?.continuity.historyEventsReplayed ?? "—"}</strong><small>EVENTS AT RESTORE</small></div></div>
      <div className="roblox-timeline"><div className="roblox-subhead">CHECKPOINT / STATE TIMELINE <span>PERSISTED CONTEXTOS EVENTS</span></div><div className="roblox-track">{events.length ? events.map((entry) => <div key={entry.id} className={entry.type === "worker_lost" || entry.type === "mission_failure" ? "roblox-alert-step" : ""}><span>{clock(entry.timestamp)}</span><b>#{entry.stateVersion ?? "—"}</b><strong>{timelineLabel(entry.type, entry.detail)}</strong><small>{entry.savepointId ?? (entry.workerPid ? `PID ${entry.workerPid}` : "")}</small></div>) : <p className="empty-state">Start the mission to create the first state image.</p>}</div></div>
      {data?.failure ? <div className="roblox-fault"><strong>CONTROLLED MISSION FAILURE / STATE #{data.failure.stateVersion}</strong><span>BLUE SPAWN · EXPECTED {data.failure.expected?.blue_spawn} · ACTUAL {data.failure.actual?.blue_spawn}</span></div> : null}
      {origin && data?.report ? <div className="roblox-autopsy"><div className="roblox-subhead">AGENT AUTOPSY <span>DERIVED FROM PERSISTED STATE / DIFF / EVENTS</span></div><div className="roblox-autopsy-grid"><div><span>SUSPECTED ORIGIN</span><strong>STATE #{origin.stateVersion}</strong><small>{origin.diffId} / {origin.mutationType}</small></div><div><span>BAD CONTEXT POINT</span><strong>{origin.key}</strong><small>{origin.before} → {origin.after}</small></div><div><span>SUGGESTED PRE-MUTATION</span><strong>STATE #{data.report.recommendedHealthyVersion}</strong><small>Inspection only</small></div></div><p>SOURCE / {source?.message ?? "Recorded source event unavailable"}</p><div className="roblox-chain">{data.report.causalChain.map((step, index) => <span key={`${step.eventId ?? step.diffId}-${index}`}>#{step.stateVersion} {step.relation.toUpperCase()}{index < data.report!.causalChain.length - 1 ? " → " : ""}</span>)}</div><div className="roblox-before-after"><div>BEFORE / #{data.originBefore?.stateVersion}<strong>{data.originBefore?.facts.find((item) => item.key === "blue_spawn" && item.status === "active")?.value}</strong></div><div>AFTER / #{data.originAfter?.stateVersion}<strong>{data.originAfter?.facts.find((item) => item.key === "blue_spawn" && item.status === "active")?.value}</strong></div></div></div> : null}
    </div>
  </section>;
}
