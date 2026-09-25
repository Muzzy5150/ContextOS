import { AutopsyReport, compareStateImages, latestAutopsyReport, StateComparison } from "../core/autopsy";
import { AgentEvent, AgentState, StateDiff } from "../core/state";
import { currentAutopsyRun } from "../../scenarios/autopsy-demo";
export interface AutopsyDashboardData { runId: string; states: AgentState[]; comparisons: StateComparison[]; events: AgentEvent[]; diffs: StateDiff[]; failure: AgentEvent; report: AutopsyReport | null; canonicalVersion: number }
export async function loadAutopsyDashboard(): Promise<AutopsyDashboardData | null> {
  const run = await currentAutopsyRun();
  if (!run) return null;
  const [versions, events, diffs, report, canonical] = await Promise.all([run.store.stateVersions(), run.store.loadEvents(), run.store.loadDiffs(), latestAutopsyReport(run.store), run.store.loadState()]);
  if (!canonical) throw new Error("Autopsy canonical state missing");
  const states = await Promise.all(versions.map((version) => run.store.getStateAtVersion(version)));
  const failure = [...events].reverse().find((entry) => entry.type === "mission_failure");
  if (!failure) throw new Error("Autopsy failure event missing");
  return { runId: run.id, states, comparisons: states.slice(1).map((state, index) => compareStateImages(states[index], state)), events, diffs, failure, report, canonicalVersion: canonical.stateVersion };
}
