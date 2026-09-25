import { estimateTokens, ModelProvider, ModelRequest, ModelResult } from "./provider";

export type ProviderErrorCode = "NO_API_KEY" | "CONNECTION_REFUSED" | "MODEL_NOT_FOUND" | "TIMEOUT" | "RATE_LIMIT" | "AUTH_FAILED" | "INVALID_RESPONSE" | "PROVIDER_ERROR";
export class ProviderError extends Error {
  constructor(readonly code: ProviderErrorCode, message: string) { super(message); this.name = "ProviderError"; }
}
export interface HttpProviderOptions {
  id: string;
  baseUrl: string;
  model: string;
  apiKey?: string;
  requireApiKey?: boolean;
  timeoutMs?: number;
  fetchImpl?: typeof fetch;
}
const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null && !Array.isArray(value);
const tokenCount = (value: unknown): number | undefined => typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : undefined;
export class OpenAICompatibleHttpProvider implements ModelProvider {
  readonly id: string;
  readonly model: string;
  private readonly endpoint: string;
  private readonly apiKey?: string;
  private readonly requireApiKey: boolean;
  private readonly timeoutMs: number;
  private readonly fetchImpl: typeof fetch;
  constructor(options: HttpProviderOptions) {
    const url = new URL(options.baseUrl);
    if (url.protocol !== "http:" && url.protocol !== "https:") throw new ProviderError("PROVIDER_ERROR", "Provider base URL must use HTTP or HTTPS");
    this.endpoint = `${url.toString().replace(/\/$/, "")}/chat/completions`;
    this.id = options.id; this.model = options.model; this.apiKey = options.apiKey;
    this.requireApiKey = options.requireApiKey ?? false;
    this.timeoutMs = options.timeoutMs ?? 60_000;
    this.fetchImpl = options.fetchImpl ?? fetch;
  }
  async generate(request: ModelRequest): Promise<ModelResult> {
    if (this.requireApiKey && !this.apiKey) throw new ProviderError("NO_API_KEY", `${this.id} requires an API key`);
    const inputCharacters = request.system.length + request.user.length;
    const body = { model: this.model, messages: [{ role: "system", content: request.system }, { role: "user", content: request.user }], stream: false, ...(request.jsonSchema ? { response_format: { type: "json_schema", json_schema: { name: "contextos_mutations", schema: request.jsonSchema } } } : request.jsonMode ? { response_format: { type: "json_object" } } : {}) };
    const started = performance.now();
    let response: Response;
    try {
      response = await this.fetchImpl(this.endpoint, { method: "POST", headers: { "Content-Type": "application/json", ...(this.apiKey ? { Authorization: `Bearer ${this.apiKey}` } : {}) }, body: JSON.stringify(body), signal: AbortSignal.timeout(this.timeoutMs) });
    } catch (error) {
      if (error instanceof Error && (error.name === "TimeoutError" || error.name === "AbortError")) throw new ProviderError("TIMEOUT", `Provider request timed out after ${this.timeoutMs}ms`);
      throw new ProviderError("CONNECTION_REFUSED", "Could not connect to the configured model endpoint");
    }
    if (!response.ok) {
      if (response.status === 401 || response.status === 403) throw new ProviderError("AUTH_FAILED", `Provider authentication failed (${response.status})`);
      if (response.status === 404) throw new ProviderError("MODEL_NOT_FOUND", "Provider endpoint or model was not found (404)");
      if (response.status === 429) throw new ProviderError("RATE_LIMIT", "Provider rate limit reached (429)");
      throw new ProviderError("PROVIDER_ERROR", `Provider returned HTTP ${response.status}`);
    }
    let payload: unknown;
    try { payload = await response.json(); } catch { throw new ProviderError("INVALID_RESPONSE", "Provider returned invalid JSON"); }
    if (!isRecord(payload) || !Array.isArray(payload.choices) || !isRecord(payload.choices[0]) || !isRecord(payload.choices[0].message) || typeof payload.choices[0].message.content !== "string") throw new ProviderError("INVALID_RESPONSE", "Provider response is missing assistant text");
    const text = payload.choices[0].message.content;
    const usage = isRecord(payload.usage) ? payload.usage : {};
    return {
      text, model: typeof payload.model === "string" ? payload.model : this.model, provider: this.id,
      inputTokens: tokenCount(usage.prompt_tokens), outputTokens: tokenCount(usage.completion_tokens),
      estimatedInputTokens: estimateTokens(inputCharacters), estimatedOutputTokens: estimateTokens(text.length),
      inputCharacters, outputCharacters: text.length, latencyMs: Math.round(performance.now() - started)
    };
  }
}
