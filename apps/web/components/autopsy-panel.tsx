"use client";
import { useRouter } from "next/navigation";
import { useState } from "react";
import type { AutopsyDashboardData } from "../../../packages/agent/autopsy-dashboard";
import type { AgentState } from "../../../packages/core/state";

function activeItems(items: { text: string; status: string }[]) { return items.filter((item) => item.status === "active").map((item) => item.text); }
function StateImage({ state, label }: { state: AgentState; label: string }) {
  const facts = state.facts.filter((fact) => fact.status === "active");
  const field = (name: string, values: string[]) => <div className="autopsy-state-row"><span>{name}</span><div>{values.length ? values.map((value) => <strong key={value}>{value}</strong>) : <em>None</em>}</div></div>;
  return <div className="autopsy-state-image"><div className="autopsy-subhead">{label} <b>#{String(state.stateVersion).padStart(2, "0")}</b></div>{field("MISSION", [state.mission])}{field("CURRENT GOAL", [state.currentGoal])}{field("ACTIVE FACTS", facts.map((fact) => `${fact.key} = ${fact.value}`))}{field("CONSTRAINTS", activeItems(state.constraints))}{field("DECISIONS", activeItems(state.decisions))}{field("OPEN LOOPS", activeItems(state.openLoops))}{field("NEXT ACTIONS", activeItems(state.nextActions))}{field("ARTIFACTS", state.artifacts.map((item) => `${item.label} / ${item.uri}`))}{state.restoredFromSavepoint ? field("RESTORED FROM", [`${state.restoredFromSavepoint} / #${state.restoredFromStateVersion}`]) : null}</div>;
}
export function AutopsyPanel({ data }: { data: AutopsyDashboardData | null }) {
  const router = useRouter();
  const [busy, setBusy] = useState<"scenario" | "analyze" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [selectedVersion, setSelectedVersion] = useState(data?.report?.suspectedOrigin?.stateVersion ?? data?.failure.stateVersion ?? 1);
  async function act(action: "scenario" | "analyze") {
    setBusy(action); setError(null);
    try {
      const response = await fetch("/api/autopsy", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action }) });
      if (!response.ok) { const body = await response.json() as { error?: string }; throw new Error(body.error ?? "Autopsy action failed"); }
      router.refresh();
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Autopsy action failed"); }
    finally { setBusy(null); }
  }
  const report = data?.report;
  const origin = report?.suspectedOrigin;
  const key = data?.failure.relatedStateKeys?.[0];
  const source = data?.events.find((entry) => entry.id === origin?.sourceEventId);
  const selected = data?.states.find((state) => state.stateVersion === selectedVersion);
  const previous = data?.states.find((state) => state.stateVersion === selectedVersion - 1);
  const selectedDiffs = data?.diffs.filter((diff) => diff.stateVersion === selectedVersion) ?? [];
  const comparison = data?.comparisons.find((item) => item.toVersion === selectedVersion);
  const healthy = data?.states.find((state) => state.stateVersion === report?.recommendedHealthyVersion);
  const suspicious = data?.states.find((state) => state.stateVersion === origin?.stateVersion);
  return <section className="panel autopsy-panel" id="autopsy" aria-label="Agent autopsy and state history"><div className="panel-heading"><div className="panel-title"><span className="panel-code">06</span><h2>AGENT AUTOPSY / STATE HISTORY</h2></div><span className="panel-meta">FORENSIC WORKSPACE / DEPLOYMENT</span></div><div className="autopsy-body">
    <div className="autopsy-toolbar"><div><span className="section-label">CONTEXTOS // FAILURE ANALYSIS</span><p>{data ? `RUN ${data.runId} / CANONICAL STATE #${data.canonicalVersion}` : "Run the controlled deployment failure in an isolated workspace."}</p></div><div className="continuity-controls"><button onClick={() => act("scenario")} disabled={busy !== null}>{busy === "scenario" ? "RUNNING" : "RUN FAILURE SCENARIO"}</button><button className="autopsy-run-button" onClick={() => act("analyze")} disabled={busy !== null || !data || !!report}>{busy === "analyze" ? "TRACING" : "RUN AUTOPSY"}</button></div></div>
    {error ? <p className="autopsy-error" role="alert">{error}</p> : null}
    {data ? <><div className="autopsy-failure" role="status"><div><span>MISSION FAILURE / STATE #{data.failure.stateVersion}</span><strong>{data.failure.message}</strong></div><div><span>AFFECTED KEY</span><strong>{key ?? "—"}</strong></div><div><span>EXPECTED</span><strong>{key ? data.failure.expected?.[key] : "—"}</strong></div><div><span>ACTUAL</span><strong>{key ? data.failure.actual?.[key] : "—"}</strong></div></div>
      <div className="autopsy-timeline"><div className="autopsy-subhead">STATE TIMELINE <span>SELECT A VERSION TO INSPECT</span></div><div className="autopsy-track">{data.states.map((state) => <button key={state.stateVersion} className={`${selectedVersion === state.stateVersion ? "selected" : ""} ${origin?.stateVersion === state.stateVersion ? "suspect" : ""} ${data.failure.stateVersion === state.stateVersion ? "failed" : ""}`} onClick={() => setSelectedVersion(state.stateVersion)} aria-pressed={selectedVersion === state.stateVersion}><strong>#{String(state.stateVersion).padStart(2, "0")}</strong><span>{origin?.stateVersion === state.stateVersion ? "SUSPECT" : data.failure.stateVersion === state.stateVersion ? "FAILURE" : "STATE"}</span></button>)}</div></div>
      {report && origin ? <div className="autopsy-result"><div className="autopsy-result-top"><div><span>FAULT TRACED</span><strong>STATE #{String(origin.stateVersion).padStart(2, "0")}</strong></div><div><span>STATE KEY</span><strong>{origin.key}</strong></div><div><span>CHANGE</span><strong>{origin.before} → {origin.after}</strong></div><div><span>CONFIDENCE</span><strong>{origin.confidence.toFixed(2)}</strong></div><div><span>SUGGESTED PRE-MUTATION STATE</span><strong>#{String(report.recommendedHealthyVersion).padStart(2, "0")}</strong></div></div><div className="autopsy-analysis-grid"><div><span className="section-label">MUTATION / {origin.mutationType}</span><p><b>{origin.diffId}</b> / {origin.reason}</p><span className="section-label">SOURCE EVENT</span><p>{source?.message ?? "Source event unavailable"} <small>{origin.sourceEventId}</small></p><span className="section-label">MUTATION PROPOSAL</span><p>{origin.mutationProposalEventId}</p><div className="continuity-controls"><button onClick={() => setSelectedVersion(report.recommendedHealthyVersion ?? 1)}>INSPECT #{report.recommendedHealthyVersion}</button><button onClick={() => setSelectedVersion(origin.stateVersion)}>INSPECT #{origin.stateVersion}</button></div></div><div className="autopsy-chain"><span className="section-label">CAUSAL CHAIN / RECORDED EVIDENCE</span>{report.causalChain.map((step, index) => <div key={`${step.eventId ?? step.diffId}-${index}`}><b>#{String(step.stateVersion).padStart(2, "0")}</b><span>{step.relation.toUpperCase()}</span><p>{step.description}</p></div>)}</div></div></div> : <div className="autopsy-pending"><strong>FAULT DETECTED</strong><p>Run Autopsy to trace the recorded state mutations behind this failure.</p></div>}
      {report && healthy && suspicious ? <div className="autopsy-before-after"><div className="autopsy-subhead">SUGGESTED PRE-MUTATION STATE <b>#{healthy.stateVersion}</b></div><div className="autopsy-pair"><StateImage state={healthy} label="BEFORE" /><StateImage state={suspicious} label="AFTER / SUSPECTED MUTATION" /></div></div> : null}
      <div className="autopsy-inspector"><div className="autopsy-subhead">READ-ONLY STATE INSPECTOR <b>#{String(selectedVersion).padStart(2, "0")}</b></div>{selected ? <div className="autopsy-inspector-grid"><StateImage state={selected} label="HISTORICAL STATE IMAGE" /><div className="autopsy-diff-detail"><span className="section-label">SEMANTIC DIFF / #{String(previous?.stateVersion ?? selectedVersion).padStart(2, "0")} → #{String(selectedVersion).padStart(2, "0")}</span>{selectedDiffs.length ? selectedDiffs.map((diff) => <div key={diff.id} className="autopsy-diff-entry"><b>{diff.mutationType} / {diff.subject}</b>{diff.before !== undefined ? <span className="diff-removed">− {diff.before}</span> : null}{diff.after !== undefined ? <span className="diff-added">+ {diff.after}</span> : null}<small>DIFF {diff.id} / SOURCE {diff.sourceEventId ?? "—"}</small><p>{diff.reason}</p></div>) : <p className="empty-state">Seed state; no preceding mutation.</p>}{comparison?.facts.length ? <div className="autopsy-comparison"><span className="section-label">FACT COMPARISON</span>{comparison.facts.map((change) => <p key={change.key}>{change.key}: {change.before ?? "unset"} → {change.after ?? "unset"}</p>)}</div> : null}</div></div> : null}</div>
    </> : <div className="autopsy-pending"><strong>AWAITING FAILURE EVENT</strong><p>The existing API mission and recovery ledger remain available above.</p></div>}
  </div></section>;
}
