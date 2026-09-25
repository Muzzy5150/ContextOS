import { randomUUID } from "node:crypto";
import { link, mkdir, readFile, readdir, unlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { activeFacts, AgentState, StateDiff } from "./state";
import { JsonFileStorage } from "./storage";

export interface StateChange { key: string; before?: string; after?: string }
export interface StateComparison {
  fromVersion: number; toVersion: number;
  facts: StateChange[]; constraints: StateChange[]; decisions: StateChange[]; openLoops: StateChange[]; nextActions: StateChange[]; artifacts: StateChange[];
}
function changes(before: Map<string, string>, after: Map<string, string>): StateChange[] {
  return [...new Set([...before.keys(), ...after.keys()])].sort().flatMap((key) => before.get(key) === after.get(key) ? [] : [{ key, before: before.get(key), after: after.get(key) }]);
}
export function compareStateImages(before: AgentState, after: AgentState): StateComparison {
  const facts = (state: AgentState) => new Map(activeFacts(state).map((fact) => [fact.key, fact.value]));
  const items = (values: { id: string; text: string; status: string }[]) => new Map(values.filter((item) => item.status === "active").map((item) => [item.text, item.text]));
  const artifacts = (state: AgentState) => new Map(state.artifacts.map((item) => [item.id, `${item.label} / ${item.uri}`]));
  return { fromVersion: before.stateVersion, toVersion: after.stateVersion,
    facts: changes(facts(before), facts(after)),
    constraints: changes(items(before.constraints), items(after.constraints)),
    decisions: changes(items(before.decisions), items(after.decisions)),
    openLoops: changes(items(before.openLoops), items(after.openLoops)),
    nextActions: changes(items(before.nextActions), items(after.nextActions)),
    artifacts: changes(artifacts(before), artifacts(after)) };
}
export async function compareStates(store: JsonFileStorage, versionA: number, versionB: number): Promise<StateComparison> {
  return compareStateImages(await store.getStateAtVersion(versionA), await store.getStateAtVersion(versionB));
}
export interface AutopsyStep { stateVersion: number; eventId?: string; diffId?: string; description: string; relation: "introduced" | "superseded" | "used" | "contradicted" | "failed"; stateKeys: string[] }
export interface EvidenceRef { kind: "event" | "diff" | "state"; id: string; stateVersion: number }
export interface AutopsyReport {
  id: string; createdAt: string; failureEventId: string; failureStateVersion: number; summary: string;
  suspectedOrigin?: { stateVersion: number; diffId: string; mutationType: string; key?: string; before?: string; after?: string; sourceEventId?: string; mutationProposalEventId?: string; reason: string; confidence: number };
  causalChain: AutopsyStep[]; affectedStateKeys: string[]; recommendedHealthyVersion?: number; evidence: EvidenceRef[];
}
function diffKey(diff: StateDiff): string | undefined { return diff.subject.startsWith("FACT / ") ? diff.subject.slice(7) : undefined; }
export async function analyzeFailure(store: JsonFileStorage, failureEventId: string): Promise<Omit<AutopsyReport, "id" | "createdAt">> {
  const [events, diffs] = await Promise.all([store.loadEvents(), store.loadDiffs()]);
  const failure = events.find((entry) => entry.id === failureEventId && entry.type === "mission_failure");
  if (!failure || !failure.stateVersion || !failure.relatedStateKeys?.length) throw new Error("MISSION FAILURE NOT FOUND OR INCOMPLETE");
  const failureState = await store.getStateAtVersion(failure.stateVersion);
  const keys = failure.relatedStateKeys;
  const candidates = keys.flatMap((key) => {
    const actual = failure.actual?.[key] ?? activeFacts(failureState).find((fact) => fact.key === key)?.value;
    if (actual === undefined) return [];
    const match = [...diffs].reverse().find((diff) => diff.stateVersion <= failure.stateVersion! && diffKey(diff) === key && diff.after === actual);
    return match ? [{ key, diff: match }] : [];
  }).sort((a, b) => a.diff.stateVersion - b.diff.stateVersion);
  const origin = candidates[0];
  const evidence: EvidenceRef[] = [{ kind: "event", id: failure.id, stateVersion: failure.stateVersion }];
  const causalChain: AutopsyStep[] = [];
  let suspectedOrigin: AutopsyReport["suspectedOrigin"];
  let recommendedHealthyVersion: number | undefined;
  if (origin) {
    const { key, diff } = origin;
    const expected = failure.expected?.[key];
    const confidence = expected !== undefined && diff.before === expected && diff.after === failure.actual?.[key] ? 0.97 : 0.72;
    suspectedOrigin = { stateVersion: diff.stateVersion, diffId: diff.id, mutationType: diff.mutationType, key, before: diff.before, after: diff.after, sourceEventId: diff.sourceEventId, mutationProposalEventId: diff.mutationProposalEventId, reason: diff.reason, confidence };
    recommendedHealthyVersion = diff.stateVersion > 1 ? diff.stateVersion - 1 : undefined;
    if (recommendedHealthyVersion) await store.getStateAtVersion(recommendedHealthyVersion);
    causalChain.push({ stateVersion: diff.stateVersion, diffId: diff.id, eventId: diff.sourceEventId, description: `${key} changed from ${diff.before ?? "unset"} to ${diff.after ?? "unset"}.`, relation: diff.mutationType === "SUPERSEDE_FACT" ? "superseded" : "introduced", stateKeys: [key] });
    evidence.push({ kind: "diff", id: diff.id, stateVersion: diff.stateVersion });
    if (diff.sourceEventId) evidence.push({ kind: "event", id: diff.sourceEventId, stateVersion: events.find((entry) => entry.id === diff.sourceEventId)?.stateVersion ?? diff.stateVersion });
    if (diff.mutationProposalEventId) evidence.push({ kind: "event", id: diff.mutationProposalEventId, stateVersion: diff.stateVersion - 1 });
    for (const entry of events) {
      if (entry.type !== "action_observed" || !entry.stateVersion || entry.stateVersion < diff.stateVersion || entry.stateVersion > failure.stateVersion || !entry.relatedStateKeys?.includes(key)) continue;
      causalChain.push({ stateVersion: entry.stateVersion, eventId: entry.id, description: entry.message, relation: "used", stateKeys: [key] });
      evidence.push({ kind: "event", id: entry.id, stateVersion: entry.stateVersion });
    }
    evidence.push({ kind: "state", id: `state-${String(diff.stateVersion).padStart(4, "0")}`, stateVersion: diff.stateVersion });
  }
  causalChain.push({ stateVersion: failure.stateVersion, eventId: failure.id, description: failure.message, relation: "failed", stateKeys: keys });
  const summary = origin ? `Failure at state #${failure.stateVersion} plausibly follows ${origin.key} entering canonical state at #${origin.diff.stateVersion}.` : `Failure at state #${failure.stateVersion}; no matching introducing mutation was found.`;
  return { failureEventId, failureStateVersion: failure.stateVersion, summary, suspectedOrigin, causalChain, affectedStateKeys: keys, recommendedHealthyVersion, evidence };
}
export async function reportIds(store: JsonFileStorage): Promise<string[]> {
  try { return (await readdir(join(store.directoryPath, "autopsies"))).filter((name) => /^autopsy-\d{4,}\.json$/.test(name)).map((name) => name.slice(0, -5)).sort((a, b) => Number(a.slice(8)) - Number(b.slice(8))); }
  catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return []; throw error; }
}
export async function latestAutopsyReport(store: JsonFileStorage): Promise<AutopsyReport | null> {
  const id = (await reportIds(store)).at(-1);
  return id ? JSON.parse(await readFile(join(store.directoryPath, "autopsies", `${id}.json`), "utf8")) as AutopsyReport : null;
}
export async function runAutopsy(store: JsonFileStorage, failureEventId: string): Promise<AutopsyReport> {
  const analysis = await analyzeFailure(store, failureEventId);
  const ids = await reportIds(store);
  const sequence = Math.max(0, ...ids.map((id) => Number(id.slice(8)))) + 1;
  const report: AutopsyReport = { id: `autopsy-${String(sequence).padStart(4, "0")}`, createdAt: new Date().toISOString(), ...analysis };
  const directory = join(store.directoryPath, "autopsies");
  await mkdir(directory, { recursive: true });
  const temporary = join(directory, `.${report.id}.${process.pid}.${randomUUID()}.tmp`);
  await writeFile(temporary, JSON.stringify(report, null, 2) + "\n", { flag: "wx" });
  try { await link(temporary, join(directory, `${report.id}.json`)); }
  catch (error) { if ((error as NodeJS.ErrnoException).code === "EEXIST") throw new Error("AUTOPSY REPORT ALREADY EXISTS"); throw error; }
  finally { await unlink(temporary); }
  return report;
}
