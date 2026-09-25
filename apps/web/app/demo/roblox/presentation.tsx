"use client";

import { useEffect, useRef, useState } from "react";
import type { AgentState, StateDiff } from "../../../../../packages/core/state";
import type { PresentationData, PresentationFrame } from "../../../../../scenarios/roblox-presentation";
import { presentationMapState } from "../../../../../scenarios/roblox-presentation-view";

const steps = [
  { title: "MISSION START", line: "A map task begins. ContextOS will track the state of the mission.", say: "Video games use checkpoints so you do not replay the whole game. Long-running agents should too.", ms: 4000 },
  { title: "MAP INSPECTED", line: "Red spawn has a direct sightline to Mid Lane. A repair task enters state.", say: "A controlled map observation becomes a fact and an open task.", ms: 5000 },
  { title: "RED SPAWN CORRECTED", line: "The spawn moves behind House B. ContextOS records the decision and state diff.", say: "The transcript is not the state. The decision and current fact are what matter.", ms: 5000 },
  { title: "PROGRESS RECORDED", line: "Traversal passes 42 of 48 checks. Blue spawn remains unresolved.", say: "The checkpoint will preserve completed work and the exact next action.", ms: 5000 },
  { title: "CHECKPOINT CREATED", line: "A real, verified savepoint now contains the mission state, not the full conversation.", say: "This checkpoint contains the state of the mission, not the entire conversation.", ms: 6000 },
  { title: "WORKER ONLINE", line: "A disposable ContextOS worker is running with its own process ID.", say: "The worker is a real child process. Watch its PID.", ms: 3000 },
  { title: "WORKER SIGNAL LOST", line: "The exact owned worker process has been forcibly terminated.", say: "I am actually killing the worker process now. The saved mission remains on disk.", ms: 5000 },
  { title: "FRESH WORKER / SAME MISSION", line: "A new PID restores the verified savepoint. Historical events replayed: zero.", say: "This is a fresh process. ContextOS replayed zero historical events.", ms: 8000 },
  { title: "MISSION CONTINUES", line: "The fresh worker verifies Blue spawn and resolves the saved open task.", say: "The new worker knew what remained and continued from the checkpoint.", ms: 5000 },
  { title: "REQUIREMENT CHANGED", line: "Spawn clearance 24 is superseded by 32. Only 32 remains current.", say: "ContextOS is mutable. Old values remain in history but leave active context.", ms: 5000 },
  { title: "STALE CONTEXT ENTERS", line: "An intentionally wrong map observation promotes Blue spawn north → east.", say: "A stale context point can enter canonical state. The ledger records exactly where.", ms: 5000 },
  { title: "MISSION FAILURE", line: "The controlled sightline check fails because the worker used the bad state.", say: "The failure used the incorrect Blue spawn value from canonical state.", ms: 5000 },
  { title: "AGENT AUTOPSY", line: "Persisted events and diffs trace the failure to its introducing mutation.", say: "ContextOS traces a later failure back to the state mutation that introduced it.", ms: 10000 },
  { title: "LONG-HORIZON BENCHMARK", line: "Full history grows. Active context remains compact. The transcript is not the state.", say: "Across 120 steps, full history reached 20,603 estimated tokens. ContextOS represented the active mission in 210.", ms: 0 }
] as const;
const active = (items: AgentState["openLoops"]) => items.filter((item) => item.status === "active");
const fmt = (value: number) => value.toLocaleString("en-US");

function MapSchematic({ state, step }: { state: AgentState | null; step: number }) {
  const map = presentationMapState(state, step);
  const redIssue = step >= 1 && map.redExposed;
  const blueBad = map.blueSpawn === "east";
  return <div className="presentation-map-wrap">
    <div className="presentation-map-label">ATOM TOWN / CONTROLLED ROBLOX WORKLOAD</div>
    <svg className="presentation-map" viewBox="0 0 560 310" role="img" aria-label={`Top-down ATOM TOWN map. Red spawn ${step === 0 ? "pending inspection" : redIssue ? "exposed" : "corrected"}. Blue spawn ${blueBad ? "incorrectly east" : map.blueVerified ? "verified north" : "pending north"}.`}>
      <defs><pattern id="map-grid" width="16" height="16" patternUnits="userSpaceOnUse"><path d="M 16 0 L 0 0 0 16" fill="none" stroke="#d4d0c6" strokeWidth="1" /></pattern></defs>
      <rect x="2" y="2" width="556" height="306" fill="#ebe8dc" stroke="#222" strokeWidth="2" />
      <rect x="3" y="3" width="554" height="304" fill="url(#map-grid)" />
      <path d="M 30 152 H 530" stroke="#615f59" strokeWidth="45" /><path d="M 30 152 H 530" stroke="#e7e3d8" strokeWidth="39" strokeDasharray="12 7" />
      <text x="280" y="157" textAnchor="middle" className="map-lane">MID LANE</text>
      <rect x="176" y="33" width="112" height="72" className="map-building" /><text x="232" y="72" textAnchor="middle">HOUSE A</text>
      <rect x="278" y="215" width="122" height="67" className="map-building" /><text x="339" y="253" textAnchor="middle">HOUSE B</text>
      {redIssue ? <path className="map-sightline" d="M 90 70 L 250 151" /> : step >= 2 ? <path className="map-cover" d="M 90 70 L 294 214" /> : null}
      <circle cx="90" cy="70" r="17" className={redIssue ? "map-marker map-red" : step >= 2 ? "map-marker map-green" : "map-marker map-amber"} /><text x="90" y="76" textAnchor="middle" className="map-marker-text">R</text><text x="28" y="32">RED SPAWN</text>
      {blueBad ? <><path className="map-bad-path" d="M 455 258 L 494 162" /><circle cx="494" cy="162" r="18" className="map-marker map-red" /><text x="494" y="168" textAnchor="middle" className="map-marker-text">B</text><text x="427" y="201" className="map-fault-label">EAST / STALE</text><circle cx="455" cy="258" r="11" fill="none" stroke="#555" strokeDasharray="3 3" /></> : <><circle cx="455" cy="258" r="18" className={`map-marker ${map.blueVerified ? "map-green" : "map-amber"}`} /><text x="455" y="264" textAnchor="middle" className="map-marker-text">B</text></>}
      <text x="403" y="296">BLUE SPAWN / {blueBad ? "EAST" : "NORTH"}</text>
    </svg>
    <div className="presentation-map-readout"><span>RED SPAWN <b className={redIssue ? "tone-red" : step >= 2 ? "tone-green" : "tone-amber"}>{redIssue ? "EXPOSED" : step >= 2 ? "FIXED" : "PENDING"}</b></span><span>BLUE SPAWN <b className={blueBad ? "tone-red" : map.blueVerified ? "tone-green" : "tone-amber"}>{blueBad ? "STALE / EAST" : map.blueVerified ? "VERIFIED" : "PENDING"}</b></span><span>TRAVERSAL <b>{map.traversalPassed} / {map.traversalTotal}</b></span></div>
    <div className="presentation-progress"><i style={{ width: `${Math.min(100, map.traversalPassed / map.traversalTotal * 100)}%` }} /></div>
  </div>;
}

function StateInspector({ state }: { state: AgentState | null }) {
  if (!state) return <div className="presentation-empty">RUN DEMO to initialize the isolated mission state.</div>;
  return <div className="presentation-inspector">
    <div className="presentation-inspector-top"><span>STATE IMAGE #{state.stateVersion}</span><span>CANONICAL / CURRENT</span></div>
    <div className="presentation-state-block"><small>MISSION</small><strong>{state.mission}</strong></div>
    <div className="presentation-state-block"><small>CURRENT GOAL</small><span>{state.currentGoal}</span></div>
    <div className="presentation-state-block"><small>FACTS</small><div className="presentation-facts">{state.facts.filter((item) => item.status === "active").map((item) => <div key={item.id}><span>{item.key}</span><b>{item.value}</b></div>)}</div></div>
    <div className="presentation-state-columns"><div className="presentation-state-block"><small>DECISIONS</small>{active(state.decisions).map((item) => <p key={item.id}>{item.text}</p>)}{!active(state.decisions).length && <em>NONE YET</em>}</div><div className="presentation-state-block"><small>CONSTRAINTS</small>{active(state.constraints).map((item) => <p key={item.id}>{item.text}</p>)}</div></div>
    <div className="presentation-state-columns"><div className="presentation-state-block"><small>OPEN LOOPS</small>{active(state.openLoops).map((item) => <p key={item.id}>□ {item.text}</p>)}{!active(state.openLoops).length && <em>NONE OPEN</em>}</div><div className="presentation-state-block"><small>NEXT ACTION</small>{active(state.nextActions).map((item) => <p key={item.id}>→ {item.text}</p>)}{!active(state.nextActions).length && <em>NONE QUEUED</em>}</div></div>
  </div>;
}

function DiffReadout({ diffs, step }: { diffs: StateDiff[]; step: number }) {
  const featured = step === 10 ? diffs.find((diff) => diff.subject === "FACT / blue_spawn") : step === 9 ? diffs.find((diff) => diff.subject === "FACT / spawn_clearance") : step === 2 ? diffs.find((diff) => diff.subject === "FACT / red_spawn_exposed") : [...diffs].reverse().find((diff) => diff.mutationType !== "RESTORE_SAVEPOINT") ?? diffs.at(-1);
  if (!featured) return <span className="presentation-no-diff">NO STATE CHANGE THIS STEP</span>;
  return <div className="presentation-diff"><span>{featured.mutationType.replaceAll("_", " ")} / #{featured.stateVersion}</span><strong>{featured.subject}</strong><div><em>− {featured.before ?? "none"}</em><b>+ {featured.after ?? "none"}</b></div><small>DIFF {featured.id} · SOURCE {featured.sourceEventId ?? "SAVEPOINT"}</small></div>;
}

function BenchmarkGraph({ data }: { data: NonNullable<PresentationData["benchmark"]> }) {
  const points = data.perStep;
  const max = Math.max(...points.map((item) => item.baseline_context_estimated_tokens));
  const make = (key: "baseline_context_estimated_tokens" | "contextos_context_estimated_tokens") => points.map((item, index) => `${36 + index / (points.length - 1) * 690},${206 - item[key] / max * 177}`).join(" ");
  return <div className="presentation-benchmark"><div className="presentation-benchmark-head"><strong>THE TRANSCRIPT IS NOT THE STATE.</strong><span>120-STEP DETERMINISTIC MEASUREMENT</span></div><svg viewBox="0 0 760 245" role="img" aria-label="Raw history estimated tokens rise across 120 steps while ContextOS active context remains comparatively bounded"><path d="M36 22 V206 H735" stroke="#222" strokeWidth="2" fill="none" /><path d="M36 116 H735" stroke="#ccc7ba" strokeWidth="1" strokeDasharray="3 4" /><polyline points={make("baseline_context_estimated_tokens")} fill="none" stroke="#c15343" strokeWidth="3" /><polyline points={make("contextos_context_estimated_tokens")} fill="none" stroke="#238a57" strokeWidth="3" /><text x="36" y="226">STEP 1</text><text x="690" y="226">STEP 120</text><text x="50" y="35">RAW HISTORY</text><text x="475" y="195">CONTEXTOS ACTIVE</text></svg><div className="presentation-benchmark-numbers"><div><span>FULL HISTORY</span><strong>{fmt(data.summary.finalBaselineTokens)} <small>EST. TOKENS</small></strong></div><div><span>ACTIVE CONTEXT</span><strong>{fmt(data.summary.finalContextosTokens)} <small>EST. TOKENS</small></strong></div><div><span>CONTEXT RATIO</span><strong>{(data.summary.contextRatio * 100).toFixed(1)}%</strong></div><div><span>MAX ACTIVE</span><strong>{fmt(data.summary.maximumContextosTokens)}</strong></div></div><p>Agents should not have to replay their entire past to know what they are doing next.</p></div>;
}

export function RobloxPresentation({ initial }: { initial: PresentationData | null }) {
  const [data, setData] = useState<PresentationData | null>(initial);
  const [viewed, setViewed] = useState(initial?.completedStep ?? 0);
  const [busy, setBusy] = useState(false);
  const [playing, setPlaying] = useState(false);
  const [notes, setNotes] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const playingRef = useRef(false);
  const mounted = useRef(true);
  useEffect(() => () => { mounted.current = false; playingRef.current = false; }, []);
  const frame: PresentationFrame | undefined = data?.frames.find((item) => item.step === viewed);
  const state = frame?.state ?? null;
  const current = steps[viewed];
  const call = async (action: "reset" | "next") => {
    setBusy(true); setError(null);
    try {
      const response = await fetch("/api/presentation", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action }) });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error ?? "Presentation action failed");
      if (mounted.current) { setData(result as PresentationData); setViewed((result as PresentationData).completedStep); }
      return result as PresentationData;
    } catch (cause) { if (mounted.current) setError(cause instanceof Error ? cause.message : "Presentation action failed"); throw cause; }
    finally { if (mounted.current) setBusy(false); }
  };
  const pause = () => { playingRef.current = false; setPlaying(false); };
  const reset = async () => { pause(); try { await call("reset"); } catch { /* status is shown */ } };
  const next = async () => {
    if (viewed < (data?.completedStep ?? -1)) { setViewed(viewed + 1); return; }
    if (viewed >= 13) return;
    try { if (!data) await call("reset"); else await call("next"); } catch { /* status is shown */ }
  };
  const full = async () => {
    if (playingRef.current) return;
    playingRef.current = true; setPlaying(true);
    try {
      await call("reset");
      for (let step = 1; step <= 13 && playingRef.current; step++) {
        const delay = steps[step - 1].ms;
        for (let waited = 0; waited < delay && playingRef.current; waited += 100) await new Promise((resolve) => setTimeout(resolve, 100));
        if (!playingRef.current) break;
        await call("next");
      }
    } catch { /* status is shown */ }
    finally { playingRef.current = false; if (mounted.current) setPlaying(false); }
  };
  const checkpoint = data?.savepoint;
  const isBenchmark = viewed === 13 && data?.benchmark;
  return <div className="presentation-app">
    <header className="presentation-menu"><span className="presentation-system-glyph">▣</span><strong>ContextOS</strong><span>CHECKPOINT DEMO</span><span className="presentation-menu-right">PRESENTATION MODE · CONTROLLED ROBLOX WORKLOAD</span></header>
    <div className="presentation-heading"><div><span className="presentation-kicker">CONTEXTOS / ATOM TOWN</span><h1>{current.title}</h1><p>{current.line}</p></div><div className="presentation-step-number">STEP {String(viewed).padStart(2, "0")} / 13</div></div>
    <div className="presentation-main">
      <section className="presentation-window presentation-workload"><div className="presentation-titlebar"><span>01</span><strong>{isBenchmark ? "LONG-HORIZON BENCHMARK" : "ROBLOX WORKLOAD"}</strong><i>{isBenchmark ? "PERSISTED API MISSION METRICS" : "DETERMINISTIC MAP INPUT"}</i></div>{isBenchmark ? <BenchmarkGraph data={data.benchmark!} /> : <MapSchematic state={state} step={viewed} />}</section>
      <section className="presentation-window presentation-context"><div className="presentation-titlebar"><span>02</span><strong>CONTEXT POINTS</strong><i>REAL AGENTSTATE #{state?.stateVersion ?? "—"}</i></div><StateInspector state={state} /></section>
    </div>
    <div className="presentation-lower">
      <section className="presentation-window presentation-proof"><div className="presentation-titlebar"><span>03</span><strong>CHECKPOINT / WORKER / AUTOPSY</strong><i>PERSISTED EVIDENCE</i></div><div className="presentation-proof-grid"><div><small>SAVEPOINT</small><strong className={checkpoint && viewed >= 4 ? "tone-amber" : ""}>{checkpoint && viewed >= 4 ? checkpoint.id.toUpperCase() : "—"}</strong><span>{checkpoint && viewed >= 4 ? `STATE #${checkpoint.stateVersion} · ${fmt(checkpoint.bytes)} BYTES` : "AWAITING CHECKPOINT"}</span></div><div><small>WORKER SIGNAL</small><strong className={viewed === 6 ? "tone-red" : viewed >= 7 ? "tone-green" : ""}>{viewed < 5 ? "NOT STARTED" : viewed === 5 ? "ONLINE" : viewed === 6 ? "LOST" : "RECOVERED"}</strong><span>{viewed >= 5 ? `OLD PID ${data?.oldPid ?? "—"}` : "OWNED CHILD PROCESS"}{viewed >= 7 ? ` · NEW PID ${data?.newPid ?? "—"}` : ""}</span></div><div><small>HISTORY REPLAYED</small><strong className={viewed >= 7 ? "tone-green" : ""}>{viewed >= 7 ? `${data?.historyEventsReplayed ?? "—"} EVENTS` : "—"}</strong><span>{viewed >= 7 ? data?.restoredNextAction ?? "RESTORED CONTEXT" : "SAVED MISSION STATE"}</span></div></div><div className="presentation-timeline">{[0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13].map((index) => <button key={index} type="button" disabled={!data || index > data.completedStep || busy || playing} className={`${index === viewed ? "selected" : ""} ${index === 6 || index === 11 ? "fault" : ""}`} onClick={() => setViewed(index)} title={steps[index].title}>{String(index).padStart(2, "0")}</button>)}</div></section>
      <section className="presentation-window presentation-detail"><div className="presentation-titlebar"><span>04</span><strong>{viewed === 12 ? "AGENT AUTOPSY" : viewed === 11 ? "MISSION FAILURE" : "STATE DIFF"}</strong><i>CHANGE LEDGER</i></div><div className="presentation-detail-body">{viewed === 12 && data?.report ? <div className="presentation-autopsy"><div><span>FAILURE STATE</span><b>#{data.report.failureStateVersion}</b></div><div><span>SUSPECTED ORIGIN</span><b className="tone-red">#{data.report.suspectedOrigin?.stateVersion ?? "—"}</b></div><div><span>STATE KEY</span><b>{data.report.suspectedOrigin?.key ?? "—"}</b></div><div><span>BAD CHANGE</span><b>{data.report.suspectedOrigin?.before} → {data.report.suspectedOrigin?.after}</b></div><div><span>RECOVERY POINT</span><b>#{data.report.recommendedHealthyVersion ?? "—"}</b></div><p>{data.report.causalChain.map((item) => `#${item.stateVersion} ${item.relation.toUpperCase()}`).join("  →  ")}</p></div> : viewed === 11 && data?.failure ? <div className="presentation-failure"><strong>BLUE SPAWN VERIFICATION FAILED</strong><p>EXPECTED <b>{data.failure.expected?.blue_spawn}</b> · ACTUAL <b>{data.failure.actual?.blue_spawn}</b></p><span>STATE #{data.failure.stateVersion} · KEY blue_spawn</span></div> : <DiffReadout diffs={frame?.diffs ?? []} step={viewed} />}</div></section>
    </div>
    <div className="presentation-controls"><button type="button" onClick={reset} disabled={busy || playing}>RESET</button><button type="button" onClick={() => setViewed(Math.max(0, viewed - 1))} disabled={busy || playing || viewed === 0}>PREVIOUS</button><button type="button" onClick={next} disabled={busy || playing || viewed >= 13}>NEXT STEP</button>{playing ? <button className="presentation-run" type="button" onClick={pause}>Ⅱ PAUSE</button> : <button className="presentation-run" type="button" onClick={full} disabled={busy}>▶ RUN FULL DEMO</button>}<button type="button" onClick={() => setNotes(!notes)} aria-pressed={notes}>PRESENTER NOTES {notes ? "ON" : "OFF"}</button><div className="presentation-legend"><span><i className="dot-green" /> VERIFIED</span><span><i className="dot-amber" /> PENDING</span><span><i className="dot-red" /> STALE / FAILURE</span></div></div>
    {notes && <div className="presentation-notes"><strong>SAY / STEP {String(viewed).padStart(2, "0")}</strong><span>{current.say}</span></div>}
    {error && <div className="presentation-error" role="alert">ACTION FAILED / {error}</div>}
    <footer className="presentation-footer"><span>CONTEXTOS SYSTEMS: REAL · ROBLOX OBSERVATIONS: CONTROLLED DEMO</span><span>CONTEXT POINTS ARE THE GAME STATE. SAVEPOINTS ARE THE CHECKPOINTS.</span></footer>
  </div>;
}
