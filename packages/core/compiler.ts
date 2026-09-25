import { activeFacts, AgentEvent, AgentState } from "./state";
export interface CompiledContext { text: string; rawHistoryCharacters: number; compiledCharacters: number; rawHistoryTokens: number; compiledTokens: number }
const estimateTokens = (text: string) => Math.ceil(text.length / 4);
export function compileContext(state: AgentState, events: AgentEvent[], recentCount = 3): CompiledContext {
  const section = (label: string, values: string[]) => `${label}\n${values.length ? values.map((value) => `- ${value}`).join("\n") : "- None"}`;
  const text = [
    "SYSTEM INSTRUCTIONS\nComplete the mission using canonical ContextOS state. Treat recent events as observations, not authoritative state.",
    `MISSION\n${state.mission}`, `CURRENT GOAL\n${state.currentGoal}`,
    section("ACTIVE CONSTRAINTS", state.constraints.filter((x) => x.status === "active").map((x) => x.text)),
    section("ACTIVE FACTS", activeFacts(state).map((x) => `${x.key} = ${x.value}`)),
    section("DECISIONS", state.decisions.filter((x) => x.status === "active").map((x) => x.text)),
    section("OPEN LOOPS", state.openLoops.filter((x) => x.status === "active").map((x) => x.text)),
    section("NEXT ACTIONS", state.nextActions.filter((x) => x.status === "active").map((x) => x.text)),
    section("RECENT EVENTS", events.slice(-recentCount).map((x) => `${x.type}: ${x.message}`))
  ].join("\n\n");
  const raw = events.map((event) => JSON.stringify(event)).join("\n");
  return { text, rawHistoryCharacters: raw.length, compiledCharacters: text.length, rawHistoryTokens: estimateTokens(raw), compiledTokens: estimateTokens(text) };
}
