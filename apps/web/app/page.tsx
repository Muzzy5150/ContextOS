import Image from "next/image";
import banner from "../../../docs/assets/contextos-banner.png";
import { loadDashboard } from "../../../packages/agent/runtime";
import { activeFacts, AgentEvent, StateItem } from "../../../packages/core/state";
import { DemoControls } from "../components/demo-controls";
import { ContinuityControls } from "../components/continuity-controls";
import { storage } from "../../../packages/agent/runtime";
import { JsonFileStorage } from "../../../packages/core/storage";
import { latestSavepoint, readVerifiedSavepoint } from "../../../packages/core/savepoints";
import { readContinuityStatus } from "../../../packages/agent/supervisor";
import { loadAutopsyDashboard } from "../../../packages/agent/autopsy-dashboard";
import { AutopsyPanel } from "../components/autopsy-panel";
import { BenchmarkPanel } from "../components/benchmark-panel";
import { latestBenchmark } from "../../../scenarios/long-horizon-benchmark";
import { readTelemetryStatus } from "../../../packages/telemetry";
import { loadRevalidationDashboard, revalidationLiveReady } from "../../../packages/agent/revalidation";
import { nimbleStatus } from "../../../packages/agent/evidence";
import { runtimeDisplay } from "../../../packages/agent/config";
import { RevalidationPanel } from "../components/revalidation-panel";
import { readProviderVerification } from "../../../packages/agent/live-status";
import { loadRobloxDashboard } from "../../../scenarios/roblox-checkpoint-demo";
import { RobloxCheckpointPanel } from "../components/roblox-checkpoint-panel";
export const dynamic = "force-dynamic";
const time = (iso: string) => new Date(iso).toLocaleTimeString("en-US", { hour12: false, hour: "2-digit", minute: "2-digit", second: "2-digit", timeZone: "UTC" });
const compact = (n: number) => n.toLocaleString("en-US");
function PanelHeading({ code, title, meta }: { code: string; title: string; meta?: string }) {
  return <div className="panel-heading"><div className="panel-title"><span className="panel-code">{code}</span><h2>{title}</h2></div>{meta ? <span className="panel-meta">{meta}</span> : null}</div>;
}
function StateList({ title, items, empty }: { title: string; items: Pick<StateItem, "id" | "text">[]; empty: string }) {
  return <div className="state-section"><div className="section-label">{title}<span>{items.length.toString().padStart(2, "0")}</span></div>{items.length ? items.map((item) => <p className="state-line" key={item.id}><span className="line-glyph">›</span>{item.text}</p>) : <p className="empty-state">{empty}</p>}</div>;
}
function BrainEvent({ entry }: { entry: AgentEvent }) {
  const detail = entry.detail ?? (entry.type === "model_request_completed" ? `${entry.latencyMs ?? 0}ms · ${entry.inputTokens ?? entry.estimatedInputTokens ?? 0} input tokens ${entry.inputTokens === undefined ? "(est.)" : "(reported)"}` : undefined);
  return <div className={`terminal-line ${entry.type === "model_request_failed" ? "terminal-error" : ""}`}><span className="terminal-time">{time(entry.timestamp)}</span><span className="terminal-mark">›</span><span className="terminal-copy"><strong>{entry.message}</strong>{detail ? <small>{detail.slice(0, 1800)}</small> : null}</span></div>;
}
export default async function Page() {
  const { state, events, diffs, context, completedTurns, mode, providers, liveReady } = await loadDashboard();
  const autopsy = await loadAutopsyDashboard();
  const store = storage as JsonFileStorage;
  const [continuity, savepointId, rawHistoryBytes, benchmark, telemetryStatus, revalidation, verification, roblox] = await Promise.all([readContinuityStatus(store), latestSavepoint(store), store.rawHistoryBytes(), latestBenchmark(), readTelemetryStatus(store.directoryPath), loadRevalidationDashboard(), readProviderVerification(), loadRobloxDashboard()]);
  const liveSettings = runtimeDisplay();
  const nimble = nimbleStatus();
  const liquidAnalysis = [...events, ...(revalidation?.events ?? [])].reverse().find((entry) => entry.type === "second_brain_analysis" && entry.provider === "liquid");
  const nimbleEvidence = [...(revalidation?.events ?? [])].reverse().find((entry) => entry.type === "external_evidence_received" && entry.provider === "nimble");
  const latest = savepointId ? await readVerifiedSavepoint(store, savepointId).catch(() => null) : null;
  const recoveryEvents = events.filter((entry) => ["savepoint_created", "worker_lost", "recovery_started", "savepoint_verified", "savepoint_restored", "worker_online", "worker_recovered", "mission_continued"].includes(entry.type)).slice(-8);
  const workerEvents = events.filter((entry) => entry.type === "first_brain_output" || (entry.role === "first" && ["model_request_started", "model_request_completed", "model_request_failed"].includes(entry.type))).slice(-12);
  const featuredDiff = [...diffs].reverse().find((entry) => entry.mutationType === "SUPERSEDE_FACT") ?? diffs.at(-1);
  const featuredAnalysis = featuredDiff?.mutationType === "SUPERSEDE_FACT" ? events.find((entry) => entry.type === "second_brain_analysis" && entry.turn === 2) : [...events].reverse().find((entry) => entry.type === "second_brain_analysis");
  const lastCompletedIndex = events.map((entry) => entry.type).lastIndexOf("turn_completed");
  const pendingFailure = [...events.slice(lastCompletedIndex + 1)].reverse().find((entry) => ["model_request_failed", "second_brain_parse_failed", "mutation_validation_failed"].includes(entry.type));
  const latestContext = [...events].reverse().find((entry) => entry.type === "context_compiled");
  const rawTokens = latestContext?.rawHistoryTokensEstimate ?? context.rawHistoryTokens;
  const compiledTokens = latestContext?.compiledContextTokensEstimate ?? context.compiledTokens;
  const notSent = rawTokens >= compiledTokens ? rawTokens - compiledTokens : null;
  const retained = rawTokens >= compiledTokens && rawTokens > 0 ? Math.round(compiledTokens / rawTokens * 100) : null;
  const firstResult = [...events].reverse().find((entry) => entry.type === "model_request_completed" && entry.role === "first");
  const secondResult = [...events].reverse().find((entry) => entry.type === "model_request_completed" && entry.role === "second");
  const lastLatency = firstResult && secondResult && firstResult.turn === secondResult.turn ? (firstResult.latencyMs ?? 0) + (secondResult.latencyMs ?? 0) : firstResult?.latencyMs;
  const modelTokens = firstResult?.inputTokens ?? firstResult?.estimatedInputTokens;
  const modelTokensLabel = firstResult?.inputTokens === undefined ? "EST." : "REPORTED";
  const versionSequence = Array.from({ length: state.stateVersion }, (_, index) => index + 1);
  const active = activeFacts(state);
  return <>
    <nav className="menu-bar" aria-label="Application menu">
      <a className="menu-glyph" href="#top" aria-label="ContextOS desktop"><span /><span /><span /><span /></a>
      <a className="menu-app" href="#top">ContextOS</a>
      <a href="#mission">Mission</a>
      <a href="#state">State</a>
      <a href="#ledger">Ledger</a>
      <a href="#revalidate">Evidence</a>
      <a href="#recovery">Continuity</a>
      <a href="#roblox">Checkpoint Demo</a>
      <a href="#autopsy">Autopsy</a>
      <a href="#benchmark">Benchmark</a>
      <span className="menu-clock">{new Date().toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit", hour12: false, timeZone: "America/Los_Angeles" })} · LOCAL</span>
    </nav>
    <main className="shell" id="top">
      <header className="desktop-header">
        <div className="desktop-brand"><Image src={banner} alt="ContextOS — Agent Context Checkpoint System" priority /></div>
        <div className="desktop-session"><span>WORKSTATION 01</span><strong>{mode} SESSION</strong></div>
      </header>
      <div className="desktop-top">
        <section className="panel system-window" id="context" aria-label="ContextOS system status">
          <PanelHeading code="SYS" title="CONTEXTOS SYSTEM" meta="CONTROL PANEL" />
          <div className="system-rows">
            <div><span>Mode</span><strong>{mode}</strong></div>
            <div><span>Mission</span><strong><i className="status-led led-green" />{completedTurns >= 3 ? "COMPLETE" : "ACTIVE"}</strong></div>
            <div><span>State</span><strong>#{String(state.stateVersion).padStart(2, "0")}</strong></div>
            <div><span>Worker</span><strong className={continuity.status === "OFFLINE" || continuity.status === "ERROR" ? "fault-text" : ""}><i className={`status-led ${continuity.status === "OFFLINE" || continuity.status === "ERROR" ? "led-red" : continuity.status === "RESTORING" || continuity.status === "STOPPING" ? "led-amber" : "led-green"}`} />{continuity.status}</strong></div>
            <div className="system-rule"><span>History</span><strong>{compact(rawTokens)} <small>t est.</small></strong></div>
            <div><span>Context</span><strong>{compact(compiledTokens)} <small>t est.</small></strong></div>
            <div><span>Ratio</span><strong>{retained === null ? "—" : `${retained}%`}</strong></div>
          </div>
        </section>
        <section className="panel control-window" aria-label="Mission control">
          <PanelHeading code="RUN" title="MISSION CONTROL" meta={`STATE IMAGE #${String(state.stateVersion).padStart(2, "0")}`} />
          <div className="control-body">
            <div className="control-intro"><div><span className="section-label">ACTIVE MISSION</span><strong>{state.mission}</strong></div><span className="control-version">{completedTurns.toString().padStart(2, "0")} / 03 TURNS</span></div>
            <div className="provider-strip"><div><span>FIRST BRAIN</span><strong>{providers.first.provider} / {providers.first.model}</strong></div><div><span>SECOND BRAIN</span><strong>{providers.second.provider} / {providers.second.model}</strong></div><div><span>LAST TURN</span><strong>{lastLatency === undefined ? "—" : `${compact(lastLatency)} ms`}</strong></div><div><span>MODEL INPUT</span><strong>{modelTokens === undefined ? "—" : `${compact(modelTokens)} ${modelTokensLabel}`}</strong></div></div>
            <div className="process-strip"><span>FIRST BRAIN</span><b>→</b><span>SECOND BRAIN</span><b>→</b><span>VALIDATED STATE</span><em>{notSent === null ? "" : `${compact(notSent)} EST. TOKENS EXCLUDED`}</em></div>
            <div className="action-bar"><DemoControls completedTurns={completedTurns} mode={mode} liveReady={liveReady} /></div>
          </div>
        </section>
      </div>
      {pendingFailure ? <div className="runtime-alert" role="status"><strong>{pendingFailure.errorCode ?? "VALIDATION FAILED"}</strong><span>{pendingFailure.message}. Canonical state preserved; advance to retry this turn.</span></div> : null}
    <div className="dashboard-grid">
      <section className="panel first-panel" id="mission"><PanelHeading code="01" title="FIRST BRAIN" meta={`${providers.first.provider.toUpperCase()} / ${providers.first.model}`} /><div className="panel-body first-body"><div className="micro-head"><span><span className="live-pip" /> ACTIVITY STREAM</span><span>{String(completedTurns).padStart(2, "0")} / 03 TURNS</span></div><div className="terminal-stream">{workerEvents.length ? workerEvents.map((entry) => <BrainEvent key={entry.id} entry={entry} />) : <div className="terminal-line"><span className="terminal-time">READY</span><span className="terminal-mark">›</span><span className="terminal-copy"><strong>SCENARIO INITIALIZED</strong><small>Awaiting first worker turn.</small></span></div>}<div className="prompt-line"><span>contextos@worker</span>:~$ <i className="block-cursor" /></div></div><div className="input-preview"><span className="section-label">NEXT TASK INPUT</span><p>{completedTurns < 3 ? ["Inspect the current API integration and locate the generation endpoint.", "New evidence: the required endpoint exists only in API v2.", "Continue from the newly compiled canonical state."][completedTurns] : "Scenario complete. Reset to replay the state transition."}</p></div></div></section>
      <section className="panel state-panel" id="state"><PanelHeading code="03" title="CURRENT STATE" meta={`CANONICAL / #${String(state.stateVersion).padStart(2, "0")}`} /><div className="panel-body state-body"><div className="state-section"><div className="section-label">MISSION</div><p className="mission-text">{state.mission}</p></div><div className="state-section"><div className="section-label">CURRENT GOAL</div><p className="state-line">{state.currentGoal}</p></div><div className="state-section facts-section"><div className="section-label">ACTIVE FACTS<span>{String(active.length).padStart(2, "0")}</span></div>{active.map((fact) => <div className="fact-row" key={fact.id}><span>{fact.key}</span><span className="fact-value"><span className="fact-led" />{fact.value}</span></div>)}</div><StateList title="CONSTRAINTS" items={state.constraints.filter((entry) => entry.status === "active")} empty="No active constraints" /><StateList title="DECISIONS" items={state.decisions.filter((entry) => entry.status === "active")} empty="No decisions recorded" /><StateList title="OPEN LOOPS" items={state.openLoops.filter((entry) => entry.status === "active")} empty="All loops resolved" /><StateList title="NEXT ACTIONS" items={state.nextActions.filter((entry) => entry.status === "active")} empty="No next action recorded" /><RevalidationPanel data={revalidation} liveReady={revalidationLiveReady()} /></div></section>
      <section className="panel second-panel"><PanelHeading code="02" title="SECOND BRAIN" meta={`${providers.second.provider.toUpperCase()} / ${providers.second.model}`} /><div className="panel-body second-body"><div className="analysis-status"><span className="analysis-orbit">◎</span><div><span className="section-label">{pendingFailure ? "RUNTIME STATUS" : "CLASSIFICATION"}</span><strong className={pendingFailure ? "error-text" : ""}>{pendingFailure ? pendingFailure.errorCode ?? "REJECTED" : featuredAnalysis?.message ?? "STANDBY"}</strong></div></div><div className="analysis-copy">{pendingFailure ? pendingFailure.message : featuredAnalysis?.detail ?? "Waiting for a worker event to analyze. Durable changes will be proposed as structured mutations."}</div><div className="analysis-fields">{pendingFailure ? <><div><span>VALIDATION</span><strong className="error-text">FAILED</strong></div><div><span>STATE</span><strong>PRESERVED</strong></div><div><span>NEXT</span><strong className="cyan-text">RETRY TURN</strong></div></> : featuredDiff?.mutationType === "SUPERSEDE_FACT" ? <><div><span>CONFLICT</span><strong>API_VERSION</strong></div><div><span>ACTION</span><strong>SUPERSEDE</strong></div><div><span>TRANSITION</span><strong className="cyan-text">V1 → V2</strong></div></> : <><div><span>OBSERVES</span><strong>WORKER EVENT</strong></div><div><span>OUTPUT</span><strong>STRUCTURED MUTATIONS</strong></div><div><span>AUTHORITY</span><strong className="cyan-text">PROPOSE ONLY</strong></div></>}</div><div className="analysis-footer"><span className="little-square" /> {pendingFailure ? "NO CANONICAL STATE CHANGE" : featuredDiff ? `VALIDATED / APPLIED TO STATE #${featuredDiff.stateVersion}` : "CORE VALIDATION REQUIRED BEFORE APPLY"}</div></div></section>
      <section className="panel diff-panel"><PanelHeading code="04" title="STATE DIFF" meta={featuredDiff ? `CHANGE ${String(featuredDiff.stateVersion).padStart(2, "0")}` : "AWAITING CHANGE"} /><div className="panel-body diff-body">{featuredDiff ? <><div className="diff-kind"><span className="diff-icon">±</span><div><span className="section-label">{featuredDiff.mutationType.replaceAll("_", " ")}</span><strong>{featuredDiff.subject}</strong></div><span className="diff-version">#{String(featuredDiff.stateVersion).padStart(2, "0")}</span></div><div className="diff-code">{featuredDiff.before ? <div className="diff-removed"><span>−</span>{featuredDiff.before}</div> : null}{featuredDiff.after ? <div className="diff-added"><span>+</span>{featuredDiff.after}</div> : null}</div><div className="diff-reason"><span>REASON /</span><p>{featuredDiff.reason}</p></div></> : <div className="diff-empty"><span>±</span><strong>NO MUTATIONS YET</strong><p>The first accepted change will appear here as a semantic state diff.</p></div>}</div></section>
    </div>
    <section className="panel system-bus" aria-label="System bus"><PanelHeading code="I/O" title="SYSTEM BUS" meta="CONFIGURED DEVICES" /><div className="bus-grid"><div><span>FIRST BRAIN / CURRENT</span><strong>{providers.first.provider.toUpperCase()} · {providers.first.model}</strong><small>OPENAI LIVE: {verification.openai.status === "LAST TEST FAILED" ? `LAST TEST ${verification.openai.errorCode ?? "FAILED"}` : verification.openai.status}</small></div><div><span>SECOND BRAIN / CURRENT</span><strong>{providers.second.provider.toUpperCase()} · {providers.second.model}</strong><small>LIQUID LIVE: {verification.liquid.status === "LIVE VERIFIED" ? `VERIFIED / ${verification.liquid.model}` : liquidAnalysis ? `USED / ${liquidAnalysis.model ?? "MODEL"}` : liveSettings.second.provider === "liquid" && liveSettings.second.ready ? `CONFIGURED / ${liveSettings.second.model}` : "NOT CONFIGURED"}</small></div><div><span>EVIDENCE / NIMBLE</span><strong>{verification.nimble.status === "LIVE VERIFIED" ? "LIVE VERIFIED" : nimbleEvidence ? "EVIDENCE RECEIVED" : nimble.configured ? "CONFIGURED · UNVERIFIED" : !process.env.NIMBLE_SOURCE_URL ? "SOURCE URL MISSING" : "NOT CONFIGURED"}</strong></div><div><span>TELEMETRY / RAWTREE</span><strong>{telemetryStatus.status}</strong><small>LOCAL SAVEPOINTS: ACTIVE</small></div></div></section>
    <RobloxCheckpointPanel data={roblox} />
    <section className="bottom-panel" id="ledger"><div className="bottom-heading"><div><span className="panel-code">08</span><h2>STATE LEDGER</h2></div><span>APPEND-ONLY DIFF HISTORY <span className="muted-slash">/</span> {diffs.length} ENTRIES</span></div><div className="ledger-track">{versionSequence.map((version) => <div className="ledger-node" key={version}><div className={`ledger-badge ${version === state.stateVersion ? "ledger-current" : ""}`}>{String(version).padStart(2, "0")}</div><span>{version === state.stateVersion ? "CURRENT" : version === 1 ? "SEEDED" : diffs.some((diff) => diff.stateVersion === version && diff.mutationType === "RESTORE_SAVEPOINT") ? "RESTORED" : "APPLIED"}</span>{latest?.savepoint.stateVersion === version ? <em className="ledger-savepoint">{savepointId?.toUpperCase()}</em> : null}{recoveryEvents.some((entry) => entry.type === "worker_lost" && entry.stateVersion === version) ? <em className="ledger-lost">WORKER LOST</em> : null}</div>)}</div><div className="ledger-foot"><div><span className="tiny-dot" /> CANONICAL STATE IS AUTHORITATIVE</div><div>HISTORICAL VALUES REMAIN IN EVENTS + DIFFS</div></div></section>
    <section className="panel continuity-panel" id="recovery" aria-label="Continuity subsystem"><PanelHeading code="05" title="CONTINUITY SUBSYSTEM" meta="SAVEPOINT / PROCESS RECOVERY" /><div className="continuity-body"><div className="continuity-grid"><div><span>WORKER SIGNAL</span><strong className={`status-${continuity.status.toLowerCase()}`}>{continuity.status}</strong></div><div><span>PID</span><strong>{continuity.pid ?? "—"}</strong></div><div><span>LATEST SAVEPOINT</span><strong className="cyan-text">{savepointId?.toUpperCase() ?? "—"}</strong></div><div><span>SAVED STATE</span><strong>{latest ? `#${String(latest.savepoint.stateVersion).padStart(2, "0")}` : "—"}</strong></div><div><span>CREATED / UTC</span><strong>{latest ? time(latest.savepoint.createdAt) : "—"}</strong></div><div><span>RECOVERY</span><strong className={continuity.recoveredAt && continuity.latestSavepoint === savepointId ? "telemetry-green" : ""}>{continuity.recoveredAt && continuity.latestSavepoint === savepointId ? "VERIFIED" : latest ? "READY" : "AWAITING SAVEPOINT"}</strong></div></div><div className="continuity-lower"><div className="continuity-feed"><span className="section-label">RECOVERY EVENT FEED</span>{recoveryEvents.length ? recoveryEvents.map((entry) => <div key={entry.id}><time>{time(entry.timestamp)}</time><span>{entry.message}</span></div>) : <p className="empty-state">No recovery events yet.</p>}</div><div className="continuity-metrics"><span className="section-label">STATE IMAGE / CONTEXT</span><div><span>SAVEPOINT SIZE</span><strong>{latest ? `${compact(latest.bytes)} BYTES` : "—"}</strong></div><div><span>RAW HISTORY SIZE</span><strong>{compact(rawHistoryBytes)} BYTES</strong></div><div><span>RESTORED CONTEXT</span><strong>{continuity.restoredContextTokens === undefined ? "—" : `${compact(continuity.restoredContextTokens)} EST. TOKENS`}</strong></div><div><span>HISTORY REPLAYED</span><strong>{continuity.historyEventsReplayed === undefined ? "—" : `${continuity.historyEventsReplayed} EVENTS`}</strong></div><ContinuityControls hasSavepoint={!!latest} workerOnline={continuity.status === "ONLINE" || continuity.status === "RECOVERED"} /></div></div></div></section>
    <AutopsyPanel key={`${autopsy?.runId ?? "empty"}-${autopsy?.report?.id ?? "pending"}`} data={autopsy} />
    <BenchmarkPanel result={benchmark} telemetry={telemetryStatus} />
    <footer><span>CONTEXTOS / LOCAL WORKSTATION</span><span>TRANSCRIPT ≠ STATE</span><span>ESTIMATED TOKENS = CHARACTERS ÷ 4</span></footer>
    </main>
  </>;
}
