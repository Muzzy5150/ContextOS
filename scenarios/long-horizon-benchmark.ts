import { randomUUID } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { compileContext } from "../packages/core/compiler";
import { applyMutation } from "../packages/core/mutations";
import { activeFacts, AgentEvent, AgentState } from "../packages/core/state";
import { JsonFileStorage } from "../packages/core/storage";
import { createTelemetryPipeline, TelemetryEvent } from "../packages/telemetry";

export interface BenchmarkStep {
  step: number; baseline_context_characters: number; baseline_context_estimated_tokens: number;
  contextos_context_characters: number; contextos_context_estimated_tokens: number; context_ratio: number;
  active_facts: number; superseded_facts: number; open_loops: number; raw_event_count: number; state_version: number;
}
export interface BenchmarkSummary {
  runId: string; steps: number; finalBaselineTokens: number; finalContextosTokens: number; contextRatio: number;
  percentageReduction: number; maximumContextosTokens: number; payloadCharactersExcluded: number;
  supersededFacts: number; resolvedOpenLoops: number; staleCanonicalFacts: number;
  baselineContainsV1: boolean; baselineContainsV2: boolean; activeApiVersion: string; historyPreserved: boolean;
}
export interface BenchmarkResult { runId: string; summary: BenchmarkSummary; perStep: BenchmarkStep[]; directory: string }
const fixedTime = (step: number) => new Date(Date.UTC(2026, 0, 1, 0, step, 0)).toISOString();
const estimate = (value: string) => Math.ceil(value.length / 4);
const task = "Continue the API integration mission using the current requirements.";
function event(step: number, message: string, detail: string, type: AgentEvent["type"] = "tool_result"): AgentEvent {
  return { id: `benchmark-event-${String(step).padStart(3, "0")}`, type, timestamp: fixedTime(step), message, detail, turn: step, mode: "DEMO" };
}
function observation(step: number): AgentEvent {
  if (step === 10) return event(step, "Current API documentation identifies v1 as the supported version.", "api_version = v1");
  if (step === 55) return event(step, "Updated API contract requires v2; v1 is stale.", "api_version = v2");
  if (step % 17 === 0) return event(step, `Tool log captured at step ${step}; transient details summarized.`, `BUILD LOG ${step}\n${("compiled module; warning resolved; cache hit;\n").repeat(150)}`);
  if (step % 19 === 0) return event(step, `Temporary test error at step ${step}; retry succeeded.`, "Test runner timed out once; retry completed successfully.");
  if (step % 11 === 0) return event(step, `Endpoint verification observation ${step}.`, "The generation endpoint remains the durable integration target.");
  return event(step, `API integration activity ${step}: inspected code and recorded the durable result.`, `Tool output for step ${step}: routine inspection complete.`);
}
export async function runLongHorizonBenchmark(baseDirectory = process.env.CONTEXTOS_DATA_DIR ?? resolve(process.cwd(), "data"), totalSteps = 120): Promise<BenchmarkResult> {
  if (!Number.isInteger(totalSteps) || totalSteps < 55 || totalSteps > 150) throw new Error("Benchmark steps must be between 55 and 150");
  const runId = `benchmark-${randomUUID()}`;
  const directory = join(baseDirectory, "benchmarks", runId);
  const store = new JsonFileStorage(directory);
  const now = fixedTime(0);
  let state: AgentState = {
    mission: "Complete the API integration across a long sequence of tool observations.",
    currentGoal: "Use the current API contract to verify the generation endpoint.",
    facts: [], constraints: [], decisions: [], openLoops: [], nextActions: [], artifacts: [],
    stateVersion: 1, completedTurns: 0, createdAt: now, updatedAt: now
  };
  const start: AgentEvent = { id: "benchmark-start", type: "scenario_started", timestamp: now, message: "Long-horizon API integration started.", mode: "DEMO", stateVersion: 1, runId, scenario: "benchmark" };
  await store.reset(state, start);
  const events: AgentEvent[] = [start];
  const steps: BenchmarkStep[] = [];
  const mutations = new Map<number, Parameters<typeof applyMutation>[1]>([
    [10, { type: "ADD_FACT", key: "api_version", value: "v1", reason: "Initial API contract." }],
    [20, { type: "ADD_OPEN_LOOP", text: "Verify generation endpoint against the current API contract.", reason: "Endpoint verification remains open." }],
    [30, { type: "ADD_DECISION", text: "Use the documented generation endpoint.", reason: "Endpoint evidence confirmed." }],
    [55, { type: "SUPERSEDE_FACT", key: "api_version", oldValue: "v1", newValue: "v2", reason: "Updated contract supersedes v1." }],
    [78, { type: "RESOLVE_OPEN_LOOP", id: "item-3", reason: "Endpoint verified against v2." }],
    [80, { type: "ADD_NEXT_ACTION", text: "Run final API v2 integration check.", reason: "Final verification remains." }]
  ]);
  for (let step = 1; step <= totalSteps; step++) {
    const observed = observation(step);
    events.push(observed);
    await store.appendEvent(observed);
    const mutation = mutations.get(step);
    if (mutation) {
      const applied = applyMutation(state, mutation, fixedTime(step), observed.id);
      state = applied.state;
      await store.saveState(state);
      await store.appendDiff(applied.diff);
      const appliedEvent = event(step, applied.diff.subject, applied.diff.reason, "mutation_applied");
      appliedEvent.id = `benchmark-mutation-${step}`;
      appliedEvent.stateVersion = state.stateVersion;
      appliedEvent.mutationType = mutation.type;
      appliedEvent.relatedStateKeys = "key" in mutation ? [mutation.key] : undefined;
      events.push(appliedEvent);
      await store.appendEvent(appliedEvent);
    }
    const baseline = `SYSTEM INSTRUCTIONS\nComplete the mission using the full conversation history.\n\nHISTORY\n${events.map((entry) => JSON.stringify(entry)).join("\n")}\n\nCURRENT TASK\n${task}`;
    const compiled = compileContext(state, events);
    const activeContext = `${compiled.text}\n\nCURRENT TASK\n${task}`;
    steps.push({ step, baseline_context_characters: baseline.length, baseline_context_estimated_tokens: estimate(baseline), contextos_context_characters: activeContext.length, contextos_context_estimated_tokens: estimate(activeContext), context_ratio: estimate(activeContext) / estimate(baseline), active_facts: activeFacts(state).length, superseded_facts: state.facts.filter((fact) => fact.status === "superseded").length, open_loops: state.openLoops.filter((loop) => loop.status === "active").length, raw_event_count: events.length, state_version: state.stateVersion });
  }
  const final = steps.at(-1)!;
  const raw = events.map((entry) => JSON.stringify(entry)).join("\n");
  const activeApiVersion = activeFacts(state).find((fact) => fact.key === "api_version")?.value ?? "missing";
  const summary: BenchmarkSummary = {
    runId, steps: totalSteps, finalBaselineTokens: final.baseline_context_estimated_tokens,
    finalContextosTokens: final.contextos_context_estimated_tokens, contextRatio: final.context_ratio,
    percentageReduction: (1 - final.context_ratio) * 100, maximumContextosTokens: Math.max(...steps.map((entry) => entry.contextos_context_estimated_tokens)),
    payloadCharactersExcluded: Math.max(0, final.baseline_context_characters - final.contextos_context_characters),
    supersededFacts: state.facts.filter((fact) => fact.status === "superseded").length,
    resolvedOpenLoops: state.openLoops.filter((loop) => loop.status === "resolved").length,
    staleCanonicalFacts: activeFacts(state).filter((fact) => fact.key === "api_version" && fact.value === "v1").length,
    baselineContainsV1: raw.includes('"value":"v1"') || raw.includes("api_version = v1"),
    baselineContainsV2: raw.includes('"value":"v2"') || raw.includes("api_version = v2"),
    activeApiVersion, historyPreserved: (await store.loadEvents()).length === events.length
  };
  if (activeApiVersion !== "v2" || summary.staleCanonicalFacts !== 0 || !summary.baselineContainsV1 || !summary.baselineContainsV2 || !summary.historyPreserved) throw new Error("BENCHMARK CANONICAL STATE CHECK FAILED");
  await mkdir(directory, { recursive: true });
  await Promise.all([
    writeFile(join(directory, "per-step.json"), JSON.stringify(steps, null, 2) + "\n"),
    writeFile(join(directory, "summary.json"), JSON.stringify(summary, null, 2) + "\n"),
    writeFile(join(directory, "metrics.json"), JSON.stringify({ summary, formula: "estimated tokens = ceil(characters / 4)", sameEventsForBoth: true, compiler: "packages/core/compiler.ts:compileContext" }, null, 2) + "\n")
  ]);
  const pointer = join(baseDirectory, "benchmark-current.json");
  const temporary = join(baseDirectory, `.benchmark-current.${process.pid}.${randomUUID()}.tmp`);
  await writeFile(temporary, JSON.stringify({ runId, directory }) + "\n");
  await rename(temporary, pointer);
  const telemetry = createTelemetryPipeline(baseDirectory);
  const records: TelemetryEvent[] = steps.map((entry) => ({ run_id: runId, event_id: `${runId}-step-${entry.step}`, event_type: "benchmark_step", timestamp: fixedTime(entry.step), mission: state.mission, scenario: "benchmark", state_version: entry.state_version, step: entry.step, raw_history_estimated_tokens: entry.baseline_context_estimated_tokens, compiled_context_estimated_tokens: entry.contextos_context_estimated_tokens, context_ratio: entry.context_ratio, mode: "DEMO" }));
  telemetry.batch(records);
  await telemetry.flush();
  return { runId, summary, perStep: steps, directory };
}
export async function latestBenchmark(baseDirectory = process.env.CONTEXTOS_DATA_DIR ?? resolve(process.cwd(), "data")): Promise<BenchmarkResult | null> {
  try {
    const pointer = JSON.parse(await readFile(join(baseDirectory, "benchmark-current.json"), "utf8")) as { runId: string };
    if (!/^benchmark-[a-f0-9-]{36}$/.test(pointer.runId)) throw new Error("BENCHMARK POINTER INVALID");
    const directory = join(baseDirectory, "benchmarks", pointer.runId);
    const [summary, perStep] = await Promise.all([
      readFile(join(directory, "summary.json"), "utf8").then((text) => JSON.parse(text) as BenchmarkSummary),
      readFile(join(directory, "per-step.json"), "utf8").then((text) => JSON.parse(text) as BenchmarkStep[])
    ]);
    return { runId: pointer.runId, summary, perStep, directory };
  } catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return null; throw error; }
}
