export type ItemStatus = "active" | "superseded" | "archived";
export interface Fact { id: string; key: string; value: string; status: ItemStatus; confidence?: number; createdAt: string; updatedAt: string; sourceEventId?: string; sourceUrl?: string; observedAt?: string; freshness?: { status: "fresh" | "stale" | "unknown"; ttlSeconds?: number; lastVerifiedAt?: string }; supersededBy?: string }
export interface StateItem { id: string; text: string; status: "active" | "archived"; createdAt: string; updatedAt: string; sourceEventId?: string }
export interface OpenLoop extends Omit<StateItem, "status"> { status: "active" | "archived" | "resolved" }
export interface ArtifactRef { id: string; label: string; uri: string; createdAt: string }
export interface AgentState {
  mission: string;
  currentGoal: string;
  facts: Fact[];
  constraints: StateItem[];
  decisions: StateItem[];
  openLoops: OpenLoop[];
  nextActions: StateItem[];
  artifacts: ArtifactRef[];
  stateVersion: number;
  completedTurns?: number;
  restoredFromSavepoint?: string;
  restoredFromStateVersion?: number;
  createdAt: string;
  updatedAt: string;
}
export type EventType = "context_compiled" | "model_request_started" | "model_request_completed" | "model_request_failed" | "second_brain_parse_failed" | "mutation_validation_failed" | "turn_completed" | "scenario_started" | "first_brain_input" | "first_brain_output" | "tool_result" | "external_evidence_received" | "evidence_lookup_failed" | "second_brain_analysis" | "mutation_proposed" | "mutation_applied" | "mutation_rejected" | "state_updated" | "savepoint_created" | "savepoint_verified" | "savepoint_restored" | "worker_online" | "worker_lost" | "worker_recovered" | "recovery_started" | "mission_continued" | "action_observed" | "mission_failure";
export interface AgentEvent {
  id: string; type: EventType; timestamp: string; message: string; detail?: string; turn?: number; stateVersion?: number;
  mode?: "DEMO" | "LIVE"; firstProvider?: string; firstModel?: string; secondProvider?: string; secondModel?: string; role?: "first" | "second"; provider?: string; model?: string; latencyMs?: number;
  inputCharacters?: number; outputCharacters?: number; inputTokens?: number; outputTokens?: number;
  estimatedInputTokens?: number; estimatedOutputTokens?: number;
  rawHistoryCharacters?: number; compiledContextCharacters?: number; rawHistoryTokensEstimate?: number; compiledContextTokensEstimate?: number;
  errorCode?: string;
  workerPid?: number; savepointId?: string;
  relatedStateKeys?: string[]; expected?: Record<string, string>; actual?: Record<string, string>; sourceEventId?: string;
  mutationProposalEventId?: string;
  runId?: string; scenario?: string; mutationType?: string;
  factKey?: string; sourceUrl?: string; observedAt?: string; structuredEvidence?: Record<string, string>;
}
export interface StateDiff { id: string; stateVersion: number; mutationType: string; subject: string; before?: string; after?: string; reason: string; sourceEventId?: string; mutationProposalEventId?: string; timestamp: string }
export function activeFacts(state: AgentState): Fact[] { return state.facts.filter((fact) => fact.status === "active"); }
export function createInitialState(now: string): AgentState {
  return {
    mission: "Complete an API integration.",
    currentGoal: "Identify the supported endpoint and migrate the client safely.",
    facts: [{ id: "fact-0", key: "api_version", value: "v1", status: "active", confidence: 0.7, createdAt: now, updatedAt: now }],
    constraints: [{ id: "constraint-0", text: "Use the required generation endpoint.", status: "active", createdAt: now, updatedAt: now }],
    decisions: [], openLoops: [], nextActions: [], artifacts: [], stateVersion: 1, completedTurns: 0, createdAt: now, updatedAt: now
  };
}
