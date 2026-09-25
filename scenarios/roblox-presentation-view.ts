import { activeFacts, type AgentState } from "../packages/core/state";

/** Read-only visual projection of the persisted canonical state. */
export function presentationMapState(state: AgentState | null, step: number) {
  const facts = state ? activeFacts(state) : [];
  const fact = (key: string) => facts.find((entry) => entry.key === key)?.value;
  return {
    redExposed: fact("red_spawn_exposed") !== "false",
    blueSpawn: fact("blue_spawn") ?? "north",
    blueVerified: fact("blue_spawn_verified") === "true",
    traversalPassed: Number(fact("traversal_tests_passed") ?? 0),
    traversalTotal: Number(fact("traversal_tests_total") ?? 48),
    failed: step >= 11
  };
}
