import { activeFacts } from "../core/state";
import { FirstBrainProvider, MaintainerInput, MaintainerOutput, ModelProvider, ModelResult, SecondBrainProvider, WorkerInput, WorkerOutput } from "./provider";

const firstSystem = [
  "You are the First Brain, the worker in ContextOS. Perform the current task and report your action or conclusion plainly.",
  "Canonical ContextOS active state is authoritative. Old transcript observations may be stale; active state takes precedence.",
  "Use only supplied evidence. Do not invent endpoint paths, tool calls, documentation, or completed work. If no actual route evidence is supplied, say the endpoint is unverified and state the next verification step.",
  "Do not directly modify AgentState or manage durable memory.",
  "Return a concise user-visible work report. Do not include hidden reasoning or chain-of-thought."
].join("\n");
export function makeFirstBrainRequest(input: WorkerInput) {
  return { system: firstSystem, user: `COMPILED CONTEXTOS WORKING STATE\n${input.compiledContext}\n\nCURRENT TASK / EVIDENCE\n${input.task}` };
}
export class LiveFirstBrain implements FirstBrainProvider {
  get id() { return this.provider.id; } get model() { return this.provider.model; }
  constructor(private readonly provider: ModelProvider) {}
  async respond(input: WorkerInput): Promise<WorkerOutput> {
    const result = await this.provider.generate(makeFirstBrainRequest(input));
    return { activity: "MODEL RESPONSE RECEIVED", message: result.text, result };
  }
}
const secondSystem = [
  "You are the Second Brain, a ContextOS state maintainer, not the primary task-solving agent. Canonical active state is authoritative. Inspect new evidence, worker output, and recent state diffs.",
  "Propose only durable changes grounded in current evidence. Worker speculation is not evidence. Do not invent facts, preserve conversational detail, or copy large tool output. Do not repeat an existing active fact or open loop. Never directly write AgentState.",
  "Return one JSON object only: {\"classification\": string, \"analysis\": string, \"mutations\": array}. No markdown or extra text.",
  "Allowed mutation types: ADD_FACT(key,value,reason,confidence?), UPDATE_FACT(key,value,reason), SUPERSEDE_FACT(key,oldValue,newValue,reason), ADD_CONSTRAINT(text,reason), ADD_DECISION(text,reason), ADD_OPEN_LOOP(text,reason), RESOLVE_OPEN_LOOP(id,reason), ADD_NEXT_ACTION(text,reason), REMOVE_NEXT_ACTION(id,reason), ARCHIVE_ITEM(collection,id,reason).",
  "Every mutation is a flat object with an uppercase type field, plus the fields listed for that type. Never nest fields under the type name. Example: {\"type\":\"SUPERSEDE_FACT\",\"key\":\"api_version\",\"oldValue\":\"v1\",\"newValue\":\"v2\",\"reason\":\"Evidence requires v2\"}.",
  "When new evidence changes an active fact, use SUPERSEDE_FACT with the exact old active value. Keep the mutation list small. An empty list is valid when nothing durable changed."
].join("\n");
const stringField = { type: "string" };
const mutationShape = (type: string, fields: Record<string, unknown>) => ({
  type: "object", additionalProperties: false,
  properties: { type: { type: "string", enum: [type] }, ...fields, reason: stringField },
  required: ["type", ...Object.keys(fields).filter((key) => key !== "confidence"), "reason"]
});
const mutationEnvelopeSchema: Record<string, unknown> = {
  type: "object", additionalProperties: false, required: ["classification", "analysis", "mutations"],
  properties: {
    classification: stringField, analysis: stringField,
    mutations: { type: "array", maxItems: 12, items: { anyOf: [
      mutationShape("ADD_FACT", { key: stringField, value: stringField, confidence: { type: "number" } }),
      mutationShape("UPDATE_FACT", { key: stringField, value: stringField }),
      mutationShape("SUPERSEDE_FACT", { key: stringField, oldValue: stringField, newValue: stringField }),
      mutationShape("ADD_CONSTRAINT", { text: stringField }), mutationShape("ADD_DECISION", { text: stringField }),
      mutationShape("ADD_OPEN_LOOP", { text: stringField }), mutationShape("ADD_NEXT_ACTION", { text: stringField }),
      mutationShape("RESOLVE_OPEN_LOOP", { id: stringField }), mutationShape("REMOVE_NEXT_ACTION", { id: stringField }),
      mutationShape("ARCHIVE_ITEM", { collection: { type: "string", enum: ["facts", "constraints", "decisions", "openLoops", "nextActions"] }, id: stringField })
    ] } }
  }
};
export function makeSecondBrainRequest(input: MaintainerInput) {
  const canonical = {
    mission: input.state.mission, currentGoal: input.state.currentGoal, stateVersion: input.state.stateVersion,
    activeFacts: activeFacts(input.state).map(({ id, key, value }) => ({ id, key, value })),
    activeConstraints: input.state.constraints.filter((item) => item.status === "active").map(({ id, text }) => ({ id, text })),
    activeDecisions: input.state.decisions.filter((item) => item.status === "active").map(({ id, text }) => ({ id, text })),
    activeOpenLoops: input.state.openLoops.filter((item) => item.status === "active").map(({ id, text }) => ({ id, text })),
    activeNextActions: input.state.nextActions.filter((item) => item.status === "active").map(({ id, text }) => ({ id, text }))
  };
  return { system: secondSystem, user: JSON.stringify({ canonicalState: canonical, currentEvidence: input.evidence, workerOutput: input.observation, recentDiffs: input.recentDiffs.slice(-3).map(({ mutationType, subject, before, after, reason }) => ({ mutationType, subject, before, after, reason })) }), jsonSchema: mutationEnvelopeSchema };
}
export function makeLiquidSecondBrainRequest(input: MaintainerInput) {
  const facts = activeFacts(input.state);
  const structured = input.workerEvent.structuredEvidence ?? {};
  const assignments = [...input.evidence.matchAll(/(?:^|[\s,;])([A-Za-z][A-Za-z0-9_]*)\s*[:=]\s*([A-Za-z0-9._-]+)/g)].map((match) => [match[1], match[2]] as const);
  const evidence = [...Object.entries(structured), ...assignments];
  const conflict = evidence.map(([key, value]) => ({ fact: facts.find((item) => item.key === key), value })).find(({ fact, value }) => fact && fact.value !== value);
  if (!conflict?.fact) return makeSecondBrainRequest(input);
  const { fact, value } = conflict;
  return {
    system: "You are the ContextOS Second Brain, not the task-solving agent. Fresh evidence contradicts one active fact. Propose one durable correction. Use only the supplied key and values. Return JSON only. Do not invent facts or copy tool output.",
    user: JSON.stringify({ mission: input.state.mission, currentGoal: input.state.currentGoal, canonicalFact: { key: fact.key, value: fact.value }, freshEvidence: { key: fact.key, value }, sourceEventId: input.workerEvent.id, activeOpenLoops: input.state.openLoops.filter((loop) => loop.status === "active").map(({ id, text }) => ({ id, text })), recentDiffs: input.recentDiffs.slice(-2).map(({ subject, before, after }) => ({ subject, before, after })) }),
    jsonSchema: { type: "object", additionalProperties: false, required: ["mutations"], properties: { mutations: { type: "array", maxItems: 1, items: { type: "object", additionalProperties: false, required: ["type", "key", "oldValue", "newValue", "reason"], properties: { type: { type: "string", enum: ["SUPERSEDE_FACT"] }, key: { type: "string", enum: [fact.key] }, oldValue: { type: "string", enum: [fact.value] }, newValue: { type: "string", enum: [value] }, reason: { type: "string" } } } } } }
  };
}
export class SecondBrainParseError extends Error {
  constructor(readonly rawOutput: string, readonly reason: string, readonly result?: ModelResult) { super(reason); this.name = "SecondBrainParseError"; }
}
export function parseMaintainerOutput(raw: string): Omit<MaintainerOutput, "rawOutput" | "result"> {
  let parsed: unknown;
  try { parsed = JSON.parse(raw); } catch { throw new SecondBrainParseError(raw, "Second Brain returned malformed JSON"); }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed) || !("mutations" in parsed) || !Array.isArray(parsed.mutations) || parsed.mutations.length > 12) throw new SecondBrainParseError(raw, "Second Brain JSON must contain a mutations array of at most 12 items");
  const record = parsed as Record<string, unknown>;
  if (record.classification !== undefined && typeof record.classification !== "string") throw new SecondBrainParseError(raw, "Second Brain classification must be text");
  if (record.analysis !== undefined && typeof record.analysis !== "string") throw new SecondBrainParseError(raw, "Second Brain analysis must be text");
  return { classification: typeof record.classification === "string" ? record.classification : "STATE REVIEW", analysis: typeof record.analysis === "string" ? record.analysis : "Structured state review complete.", mutations: record.mutations as unknown[] };
}
export class LiveSecondBrain implements SecondBrainProvider {
  get id() { return this.provider.id; } get model() { return this.provider.model; }
  constructor(private readonly provider: ModelProvider) {}
  async analyze(input: MaintainerInput): Promise<MaintainerOutput> {
    const request = this.provider.id === "liquid" ? makeLiquidSecondBrainRequest(input) : makeSecondBrainRequest(input);
    const result = await this.provider.generate(request);
    try { const parsed = parseMaintainerOutput(result.text); return { ...parsed, rawOutput: result.text, result }; }
    catch (error) { if (error instanceof SecondBrainParseError) throw new SecondBrainParseError(error.rawOutput, error.reason, result); throw error; }
  }
}
