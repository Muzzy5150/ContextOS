"use client";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { BenchmarkResult, BenchmarkStep } from "../../../scenarios/long-horizon-benchmark";
import { TelemetryStatus } from "../../../packages/telemetry";
function path(points: BenchmarkStep[], field: "baseline_context_estimated_tokens" | "contextos_context_estimated_tokens", maximum: number) {
  return points.map((point, index) => `${index ? "L" : "M"}${(45 + (point.step - 1) / (points.length - 1) * 900).toFixed(1)},${(246 - point[field] / maximum * 210).toFixed(1)}`).join(" ");
}
const fmt = (value: number) => value.toLocaleString("en-US");
export function BenchmarkPanel({ result, telemetry }: { result: BenchmarkResult | null; telemetry: TelemetryStatus }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  async function run() {
    setBusy(true); setError(null);
    try {
      const response = await fetch("/api/benchmark", { method: "POST" });
      if (!response.ok) { const body = await response.json() as { error?: string }; throw new Error(body.error ?? "Benchmark failed"); }
      router.refresh();
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Benchmark failed"); }
    finally { setBusy(false); }
  }
  const summary = result?.summary;
  const maximum = result ? Math.max(...result.perStep.map((point) => point.baseline_context_estimated_tokens), 1) : 1;
  return <section className="panel benchmark-panel" id="benchmark" aria-label="Long-horizon benchmark">
    <div className="panel-heading"><div className="panel-title"><span className="panel-code">07</span><h2>LONG-HORIZON BENCHMARK</h2></div><span className="panel-meta">DETERMINISTIC / SAME EVENT STREAM</span></div>
    <div className="benchmark-body">
      <div className="benchmark-toolbar"><div><span className="section-label">CONTEXT GROWTH / {summary ? `${summary.steps} MISSION STEPS` : "READY"}</span><p>Full history sent each turn versus canonical state compiled with the ContextOS runtime.</p></div><button type="button" onClick={run} disabled={busy}>{busy ? "RUNNING…" : summary ? "RUN AGAIN" : "RUN BENCHMARK"}</button></div>
      {summary && result ? <>
        <div className="benchmark-metrics"><div><span>RAW HISTORY</span><strong className="benchmark-raw">{fmt(summary.finalBaselineTokens)}</strong><small>EST. TOKENS</small></div><div><span>ACTIVE CONTEXT</span><strong className="telemetry-cyan">{fmt(summary.finalContextosTokens)}</strong><small>EST. TOKENS</small></div><div><span>CONTEXT RATIO</span><strong className="telemetry-green">{(summary.contextRatio * 100).toFixed(1)}%</strong><small>FINAL STEP</small></div><div><span>SUPERSEDED FACTS</span><strong>{summary.supersededFacts}</strong><small>HISTORY PRESERVED</small></div></div>
        <div className="benchmark-chart"><svg viewBox="0 0 970 285" role="img" aria-label="Raw history grows over 120 steps while ContextOS active context stays comparatively bounded" preserveAspectRatio="none"><g className="benchmark-grid">{[0, .25, .5, .75, 1].map((fraction) => <g key={fraction}><line x1="45" x2="945" y1={246 - fraction * 210} y2={246 - fraction * 210} /><text x="39" y={250 - fraction * 210} textAnchor="end">{Math.round(maximum * fraction).toLocaleString("en-US")}</text></g>)}</g><path className="benchmark-series-raw" d={path(result.perStep, "baseline_context_estimated_tokens", maximum)} /><path className="benchmark-series-active" d={path(result.perStep, "contextos_context_estimated_tokens", maximum)} /><g className="benchmark-axis"><text x="45" y="273">1</text><text x="470" y="273">{Math.round(summary.steps / 2)}</text><text x="930" y="273">{summary.steps}</text></g></svg><div className="benchmark-legend"><span><i className="raw-line" /> RAW HISTORY</span><span><i className="active-line" /> CONTEXTOS ACTIVE CONTEXT</span><span>Y / EST. TOKENS · X / STEP</span></div></div>
        <div className="benchmark-foot"><span>API_VERSION <strong>V1 → V2</strong></span><span>STALE CANONICAL FACTS <strong>{summary.staleCanonicalFacts}</strong></span><span>MAX ACTIVE CONTEXT <strong>{fmt(summary.maximumContextosTokens)} TOKENS</strong></span><span>RUN <strong>{result.runId.slice(0, 18)}…</strong></span></div>
      </> : <div className="benchmark-empty">Run the 120-step deterministic benchmark to plot the measured context payloads.</div>}
      {error ? <p className="benchmark-error" role="alert">{error}</p> : null}
    </div>
    <div className="rawtree-bar"><div><span className="section-label">RAWTREE / ANALYTICAL MIRROR</span><strong className={telemetry.status === "CONNECTED" ? "telemetry-green" : telemetry.status === "ERROR" ? "error-text" : ""}>{telemetry.status}</strong></div><div><span>EXPORTED EVENTS</span><strong>{telemetry.status === "NOT CONFIGURED" ? "—" : fmt(telemetry.exportedEvents)}</strong></div><div><span>LAST EXPORT</span><strong>{telemetry.lastExport ? new Date(telemetry.lastExport).toLocaleTimeString("en-US", { hour12: false }) : "—"}</strong></div><div><span>RUN</span><strong>{telemetry.lastRunId?.slice(0, 22) ?? "—"}</strong></div>{telemetry.lastError && telemetry.status === "ERROR" ? <p>{telemetry.lastError}</p> : null}</div>
  </section>;
}
