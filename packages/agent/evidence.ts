export interface EvidenceRequest { factKey: string; currentValue: string; sourceUrl: string }
export interface EvidenceResult { provider: "deterministic" | "nimble"; factKey: string; value: string; sourceUrl: string; observedAt: string; summary: string }
export interface EvidenceProvider { readonly id: EvidenceResult["provider"]; fetchEvidence(request: EvidenceRequest): Promise<EvidenceResult> }

export class EvidenceError extends Error {
  constructor(readonly code: "NOT_CONFIGURED" | "UNAUTHORIZED" | "RATE_LIMITED" | "NETWORK_FAILURE" | "EMPTY_RESULT" | "UNSUPPORTED_RESPONSE", message: string) { super(message); this.name = "EvidenceError"; }
}

export function safeEvidenceUrl(input: string): string {
  let url: URL;
  try { url = new URL(input); } catch { throw new EvidenceError("NOT_CONFIGURED", "Evidence source URL is invalid"); }
  if (url.protocol !== "https:" || url.username || url.password || url.search || url.hash) throw new EvidenceError("NOT_CONFIGURED", "Evidence source must be a public HTTPS URL without credentials or query parameters");
  return url.toString();
}

export class DeterministicEvidenceProvider implements EvidenceProvider {
  readonly id = "deterministic";
  async fetchEvidence(request: EvidenceRequest): Promise<EvidenceResult> {
    if (request.factKey !== "api_version") throw new EvidenceError("UNSUPPORTED_RESPONSE", "Demo evidence supports api_version only");
    return { provider: this.id, factKey: request.factKey, value: "v2", sourceUrl: "https://example.org/contextos-demo-api-version", observedAt: new Date().toISOString(), summary: "DEMO EVIDENCE / Current documentation specifies api_version: v2." };
  }
}

export interface NimbleConfig { apiKey?: string; sourceUrl?: string; endpoint?: string; fetchImpl?: typeof fetch }
export function nimbleStatus(env: NodeJS.ProcessEnv = process.env): { configured: boolean; issue?: string; sourceUrl?: string } {
  if (env.NIMBLE_ENABLED !== "true") return { configured: false, issue: "NOT ENABLED" };
  if (!env.NIMBLE_API_KEY?.trim()) return { configured: false, issue: "API KEY MISSING" };
  if (!env.NIMBLE_SOURCE_URL?.trim()) return { configured: false, issue: "SOURCE URL MISSING" };
  try { return { configured: true, sourceUrl: safeEvidenceUrl(env.NIMBLE_SOURCE_URL) }; }
  catch { return { configured: false, issue: "SOURCE URL INVALID" }; }
}

// Nimble Extract v2: https://docs.nimbleway.com/nimble-sdk/web-tools/extract/quickstart
export class NimbleEvidenceProvider implements EvidenceProvider {
  readonly id = "nimble";
  constructor(private readonly config: NimbleConfig) {}
  async fetchEvidence(request: EvidenceRequest): Promise<EvidenceResult> {
    if (!this.config.apiKey?.trim()) throw new EvidenceError("NOT_CONFIGURED", "Nimble API key is missing");
    const sourceUrl = safeEvidenceUrl(request.sourceUrl || this.config.sourceUrl || "");
    let response: Response;
    try {
      response = await (this.config.fetchImpl ?? fetch)(this.config.endpoint ?? "https://sdk.nimbleway.com/v2/extract", {
        method: "POST", headers: { Authorization: `Bearer ${this.config.apiKey}`, "Content-Type": "application/json" },
        body: JSON.stringify({ url: sourceUrl, formats: ["markdown"] }), signal: AbortSignal.timeout(30000)
      });
    } catch { throw new EvidenceError("NETWORK_FAILURE", "Nimble evidence request failed"); }
    if (response.status === 401 || response.status === 403) throw new EvidenceError("UNAUTHORIZED", "Nimble authorization failed");
    if (response.status === 429) throw new EvidenceError("RATE_LIMITED", "Nimble rate limit reached");
    if (!response.ok) throw new EvidenceError("NETWORK_FAILURE", `Nimble request failed (${response.status})`);
    let payload: unknown;
    try { payload = await response.json(); } catch { throw new EvidenceError("UNSUPPORTED_RESPONSE", "Nimble returned invalid JSON"); }
    if (!payload || typeof payload !== "object") throw new EvidenceError("UNSUPPORTED_RESPONSE", "Nimble response is not an object");
    const result = payload as { status?: unknown; data?: { markdown?: unknown; html?: unknown }; status_code?: unknown };
    if (result.status !== "success" || (typeof result.status_code === "number" && result.status_code >= 400)) throw new EvidenceError("UNSUPPORTED_RESPONSE", "Nimble extraction did not succeed");
    const raw = typeof result.data?.markdown === "string" ? result.data.markdown : typeof result.data?.html === "string" ? result.data.html.replace(/<[^>]*>/g, "\n") : "";
    if (!raw.trim()) throw new EvidenceError("EMPTY_RESULT", "Nimble returned no extractable content");
    const escaped = request.factKey.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const matches = [...raw.matchAll(new RegExp(`(?:^|\\n)\\s*["']?${escaped}["']?\\s*[:=]\\s*["']?([A-Za-z0-9._-]{1,80})`, "gim"))].map((match) => match[1]);
    const values = [...new Set(matches)];
    if (values.length !== 1) throw new EvidenceError("UNSUPPORTED_RESPONSE", `Nimble source must contain one unambiguous ${request.factKey}: value`);
    const observedAt = new Date().toISOString();
    return { provider: this.id, factKey: request.factKey, value: values[0], sourceUrl, observedAt, summary: `Nimble extracted ${request.factKey}: ${values[0]} from the configured source.` };
  }
}
