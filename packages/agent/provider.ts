import { AgentEvent, AgentState, StateDiff } from "../core/state";

export type RuntimeMode = "DEMO" | "LIVE";
export interface ModelRequest {
  system: string;
  user: string;
  jsonMode?: boolean;
  jsonSchema?: Record<string, unknown>;
}
export interface ModelResult {
  text: string;
  model?: string;
  provider?: string;
  inputTokens?: number; // Only provider-reported usage belongs here.
  outputTokens?: number;
  estimatedInputTokens: number;
  estimatedOutputTokens: number;
  inputCharacters: number;
  outputCharacters: number;
  latencyMs: number;
}
export interface ModelProvider {
  readonly id: string;
  readonly model: string;
  generate(request: ModelRequest): Promise<ModelResult>;
}
export interface WorkerInput { compiledContext: string; task: string; turn: number }
export interface WorkerOutput { message: string; activity: string; result?: ModelResult }
export interface MaintainerInput { state: AgentState; workerEvent: AgentEvent; observation: string; evidence: string; recentDiffs: StateDiff[]; turn: number }
export interface MaintainerOutput { classification: string; analysis: string; mutations: unknown[]; rawOutput?: string; result?: ModelResult }
export interface FirstBrainProvider { readonly id: string; readonly model: string; respond(input: WorkerInput): Promise<WorkerOutput> }
export interface SecondBrainProvider { readonly id: string; readonly model: string; analyze(input: MaintainerInput): Promise<MaintainerOutput> }
export const estimateTokens = (characters: number) => Math.ceil(characters / 4);
