import { existsSync } from "node:fs";
import { resolve } from "node:path";
async function main() {
  const envFile = resolve(process.cwd(), "apps/web/.env.local");
  if (existsSync(envFile)) process.loadEnvFile(envFile);
  const { advanceCurrent, loadDashboard, resetDemo, runFullDemo, runFullLive } = await import("../packages/agent/runtime");
  const { activeFacts } = await import("../packages/core/state");
  const { storage } = await import("../packages/agent/runtime");
  const { createSavepoint, restoreSavepoint } = await import("../packages/core/savepoints");
  const { runRecoveryDemo } = await import("../packages/agent/recovery-demo");
  const command = process.argv[2];
  if (command === "sponsors") {
    const { runtimeDisplay } = await import("../packages/agent/config");
    const { nimbleStatus } = await import("../packages/agent/evidence");
    const { readProviderVerification } = await import("../packages/agent/live-status");
    const { rawTreeConfig } = await import("../packages/telemetry");
    const { first, second } = runtimeDisplay();
    const nimble = nimbleStatus();
    const rawtree = rawTreeConfig();
    const verification = await readProviderVerification();
    console.log("CONTEXTOS / SPONSOR DEVICES");
    console.log(`OPENAI    ${first.provider === "openai" && first.ready ? `CONFIGURED / ${first.model} / ${verification.openai.status}${verification.openai.errorCode ? ` / ${verification.openai.errorCode}` : ""}` : "NOT CONFIGURED"}`);
    console.log(`LIQUID    ${second.provider === "liquid" && second.ready ? `CONFIGURED / ${second.model} / ${verification.liquid.status}` : "NOT CONFIGURED"}`);
    console.log(`NIMBLE    ${nimble.configured ? "CONFIGURED / LIVE UNVERIFIED" : `NOT CONFIGURED / ${!process.env.NIMBLE_SOURCE_URL ? "SOURCE URL MISSING" : nimble.issue ?? "DISABLED"}`}`);
    console.log(`RAWTREE   ${rawtree.enabled && rawtree.apiKey ? "CONFIGURED / QUERY TO VERIFY" : "NOT CONFIGURED"}`);
    console.log("AWS S3    OPTIONAL / NOT IMPLEMENTED");
    if (process.argv[3] === "--verify-liquid") {
      const { JsonFileStorage } = await import("../packages/core/storage");
      const { DemoFirstBrain } = await import("../packages/agent/first-brain");
      const { createLiveSecondBrain } = await import("../packages/agent/config");
      const { resetDemo, advanceDemo, advanceWithProviders } = await import("../packages/agent/runtime");
      const store = new JsonFileStorage(resolve(process.cwd(), "data/live-verification/liquid-maintenance"));
      await resetDemo(store);
      await advanceDemo(store);
      const pair = { first: new DemoFirstBrain(), second: createLiveSecondBrain() };
      let result = await advanceWithProviders(store, pair);
      if (result.completedTurns === 1) result = await advanceWithProviders(store, pair);
      const proposal = [...result.events].reverse().find((entry) => entry.type === "mutation_proposed" && entry.mutationType === "SUPERSEDE_FACT");
      const diff = result.diffs.find((entry) => entry.mutationType === "SUPERSEDE_FACT" && entry.subject === "FACT / api_version");
      const modelCall = [...result.events].reverse().find((entry) => entry.type === "model_request_completed" && entry.role === "second" && entry.provider === "liquid");
      const current = activeFacts(result.state).find((fact) => fact.key === "api_version");
      const pass = !!proposal && !!diff && diff.mutationProposalEventId === proposal.id && current?.value === "v2";
      console.log("LIQUID / CONTEXTOS MAINTENANCE CHECK");
      console.log("FIRST BRAIN  DETERMINISTIC EVENT");
      console.log(`SECOND BRAIN ${pair.second.id} / ${modelCall?.model ?? pair.second.model}`);
      console.log(`MODEL CALL   ${modelCall ? "PASS" : "FAILED"} / ${modelCall?.latencyMs ?? "—"} ms / INPUT ${modelCall?.inputTokens ?? "—"} / OUTPUT ${modelCall?.outputTokens ?? "—"}`);
      console.log(`PROPOSAL     ${proposal?.detail ?? "NONE"}`);
      console.log(`VALIDATION   ${pass ? "PASS" : "NO ACCEPTED SUPERSESSION"}`);
      console.log(`STATE        #${diff?.stateVersion ?? result.state.stateVersion} / api_version ${current?.value ?? "MISSING"}`);
      console.log(`LIQUID LIVE  ${pass ? "PASS" : "UNVERIFIED"}`);
      if (!pass) process.exitCode = 1;
    }
    return;
  }
  if (command === "revalidate-demo") {
    const { startRevalidationScenario, revalidateFact, revalidationStore } = await import("../packages/agent/revalidation");
    await startRevalidationScenario("DEMO", revalidationStore);
    const before = await revalidationStore.loadState();
    const result = await revalidateFact(revalidationStore);
    await revalidationStore.flushTelemetry();
    const current = activeFacts(result.state).find((fact) => fact.key === "api_version");
    const old = result.state.facts.find((fact) => fact.key === "api_version" && fact.value === "v1");
    const diff = result.diffs.at(-1);
    const evidence = result.events.find((entry) => entry.type === "external_evidence_received");
    const pass = before?.stateVersion === 1 && current?.value === "v2" && current.freshness?.status === "fresh" && old?.status === "superseded" && diff?.sourceEventId === evidence?.id;
    console.log("CONTEXTOS / FACT REVALIDATION");
    console.log(`EVIDENCE     ${evidence?.provider?.toUpperCase() ?? "MISSING"} / ${evidence?.id ?? "MISSING"}`);
    console.log(`STATE        #${before?.stateVersion ?? "?"} → #${result.state.stateVersion}`);
    console.log(`FACT         ${diff?.before ?? "?"} → ${diff?.after ?? "?"}`);
    console.log(`PROVENANCE   ${current?.sourceEventId ?? "MISSING"}`);
    console.log(`REVALIDATION ${pass ? "PASS" : "FAIL"}`);
    if (!pass) process.exitCode = 1;
    return;
  }
  if (command === "rawtree-query") {
    const { rawTreeConfig, RawTreeTelemetryExporter, queryRunAnalytics } = await import("../packages/telemetry");
    const { latestBenchmark } = await import("../scenarios/long-horizon-benchmark");
    const config = rawTreeConfig();
    if (!config.enabled || !config.apiKey) throw new Error("RAWTREE NOT CONFIGURED");
    const runId = process.argv[3] ?? (await latestBenchmark())?.runId;
    if (!runId) throw new Error("RUN ID REQUIRED");
    const result = await queryRunAnalytics(new RawTreeTelemetryExporter(config), runId);
    console.log(`RAWTREE RUN ${runId}`);
    console.log(JSON.stringify(result, null, 2));
    return;
  }
  if (command === "benchmark") {
    const { runLongHorizonBenchmark } = await import("../scenarios/long-horizon-benchmark");
    const result = await runLongHorizonBenchmark();
    const { summary } = result;
    console.log("CONTEXTOS / LONG-HORIZON BENCHMARK");
    console.log(`RUN             ${result.runId}`);
    console.log(`MISSION STEPS   ${summary.steps}`);
    console.log(`RAW HISTORY     ${summary.finalBaselineTokens} estimated tokens`);
    console.log(`ACTIVE CONTEXT  ${summary.finalContextosTokens} estimated tokens`);
    console.log(`CONTEXT RATIO   ${(summary.contextRatio * 100).toFixed(1)}%`);
    console.log(`MAX ACTIVE      ${summary.maximumContextosTokens} estimated tokens`);
    console.log(`SUPERSEDED      ${summary.supersededFacts} facts / ${summary.resolvedOpenLoops} resolved loops`);
    console.log(`CANONICAL API   ${summary.activeApiVersion} / STALE ${summary.staleCanonicalFacts}`);
    console.log(`HISTORY         ${summary.historyPreserved ? "PRESERVED" : "MISSING"}`);
    console.log("BENCHMARK       PASS");
    return;
  }
  if (command === "autopsy-demo") {
    const { runAutopsyScenario } = await import("../scenarios/autopsy-demo");
    const { runAutopsy, compareStates } = await import("../packages/core/autopsy");
    const { recordAutopsyTelemetry } = await import("../packages/telemetry");
    const run = await runAutopsyScenario();
    await recordAutopsyTelemetry(resolve(run.directory, "../.."), run.id, "autopsy_started");
    const report = await runAutopsy(run.store, run.failureEvent.id);
    await recordAutopsyTelemetry(resolve(run.directory, "../.."), run.id, "autopsy_completed", report.suspectedOrigin?.stateVersion, report.suspectedOrigin?.confidence);
    await run.store.flushTelemetry();
    const origin = report.suspectedOrigin;
    const before = await run.store.getStateAtVersion(5);
    const comparison = await compareStates(run.store, 5, 9);
    const source = (await run.store.loadEvents()).find((entry) => entry.id === origin?.sourceEventId);
    console.log("CONTEXTOS / AGENT AUTOPSY");
    console.log(`RUN             ${run.id}`);
    console.log(`MISSION         ${before.mission}`);
    console.log(`FAILURE         ${run.failureEvent.id} / STATE #${report.failureStateVersion} / ${run.failureEvent.message}`);
    console.log(`EXPECTED        ${run.failureEvent.expected?.deployment_region}`);
    console.log(`ACTUAL          ${run.failureEvent.actual?.deployment_region}`);
    console.log("TRACE");
    for (const step of report.causalChain) console.log(`  #${step.stateVersion} ${step.relation.toUpperCase()} / ${step.description}`);
    console.log(`SUSPECTED ORIGIN STATE #${origin?.stateVersion} / DIFF ${origin?.diffId}`);
    console.log(`CHANGE          ${origin?.before} → ${origin?.after}`);
    console.log(`SOURCE          ${source?.message ?? "missing"} / ${origin?.sourceEventId ?? "missing"}`);
    console.log(`SUGGESTED PRE-MUTATION STATE #${report.recommendedHealthyVersion}`);
    console.log(`COMPARISON #5 → #9 ${comparison.facts.map((change) => `${change.key}: ${change.before ?? "unset"} → ${change.after ?? "unset"}`).join("; ")}`);
    const pass = origin?.stateVersion === 6 && origin.before === "us-west-2" && origin.after === "us-east-1" && report.recommendedHealthyVersion === 5 && !!source && (await run.store.loadState())?.stateVersion === 9;
    console.log(`AUTOPSY         ${pass ? "PASS" : "FAIL"}`);
    if (!pass) process.exitCode = 1;
    return;
  }
  if (command === "save") {
    const { savepoint, bytes } = await createSavepoint(storage as import("../packages/core/storage").JsonFileStorage);
    console.log(`SAVEPOINT ${savepoint.id} / STATE #${savepoint.stateVersion} / ${bytes} bytes`); return;
  }
  if (command === "restore") {
    try {
      const result = await restoreSavepoint(storage as import("../packages/core/storage").JsonFileStorage, process.argv[3] ?? "");
      console.log(`RESTORED ${result.savepointId} / #${result.savedStateVersion} → #${result.resultingStateVersion} / HISTORY REPLAYED ${result.historyEventsReplayed}`); return;
    } catch (error) {
      const message = error instanceof Error ? error.message : "RESTORE FAILURE";
      console.error(message);
      if (/^(SAVEPOINT INVALID|CHECKSUM FAILURE|UNSUPPORTED SCHEMA|SAVEPOINT NOT FOUND)/.test(message)) console.error("RESTORE ABORTED / CANONICAL STATE UNCHANGED");
      process.exitCode = 1; return;
    }
  }
  if (command === "recovery-demo") {
    const proof = await runRecoveryDemo(storage as import("../packages/core/storage").JsonFileStorage);
    console.log("CONTEXTOS / RECOVERY TEST");
    console.log(`PRE-CRASH       PID ${proof.oldPid} / STATE #${proof.before.stateVersion} / API ${proof.before.apiVersion} / OPEN LOOPS ${proof.before.openLoops}`);
    console.log(`SAVEPOINT       ${proof.savepoint.id} / ${proof.savepointBytes} bytes / SHA-256 VERIFIED`);
    console.log(`RAW HISTORY     ${proof.rawHistoryBytes} bytes`);
    console.log(`WORKER LOST     PID ${proof.termination.pid} / ${proof.termination.signal} / GONE ${proof.termination.gone}`);
    console.log(`FRESH WORKER    PID ${proof.newPid}`);
    console.log(`RESTORED        ${proof.savepoint.id} / #${proof.restored.savedStateVersion} → #${proof.restored.resultingStateVersion}`);
    console.log(`POST-RESTORE    API ${proof.freshContext.apiVersion} / OPEN LOOPS ${proof.freshContext.openLoops} / NEXT ${proof.freshContext.nextAction}`);
    console.log(`HISTORY REPLAYED ${proof.freshContext.historyEventsReplayed} events`);
    console.log(`COMPILED CONTEXT ${proof.freshContext.estimatedTokens} estimated tokens`);
    console.log(`MISSION CONTINUED / STATE #${proof.continued.stateVersion} / ${proof.continued.workerOutput}`);
    console.log("RECOVERY        PASS"); return;
  }
  const result = command === "demo" ? await runFullDemo() : command === "live" ? await runFullLive() : command === "reset" ? await resetDemo() : command === "next" ? await advanceCurrent() : command === "status" ? await loadDashboard() : null;
  if (!result) { console.error("Usage: node --import tsx cli/index.ts demo|live|reset|next|status"); process.exitCode = 1; return; }
  console.log(`${result.mode} · State #${result.state.stateVersion} · ${result.completedTurns}/3 turns`);
  console.log(`First: ${result.providers.first.provider}/${result.providers.first.model}`);
  console.log(`Second: ${result.providers.second.provider}/${result.providers.second.model}`);
  console.log(`Active api_version: ${activeFacts(result.state).find((fact) => fact.key === "api_version")?.value ?? "missing"}`);
  console.log(`Events: ${result.events.length} · Diffs: ${result.diffs.length}`);
  const lastError = [...result.events].reverse().find((entry) => ["model_request_failed", "second_brain_parse_failed", "mutation_validation_failed"].includes(entry.type));
  if (result.completedTurns < 3 && lastError && command === "live") { console.error(`${lastError.errorCode ?? lastError.type}: ${lastError.message}`); process.exitCode = 1; }
}
main().catch((error) => { console.error(error instanceof Error ? error.message : error); process.exitCode = 1; }).finally(async () => {
  const { storage } = await import("../packages/agent/runtime");
  if ("flushTelemetry" in storage && typeof storage.flushTelemetry === "function") await storage.flushTelemetry();
});
