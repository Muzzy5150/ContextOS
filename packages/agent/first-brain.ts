import { FirstBrainProvider, WorkerInput, WorkerOutput } from "./provider";
export class DemoFirstBrain implements FirstBrainProvider {
  readonly id = "deterministic";
  readonly model = "scenario-v1";
  async respond(input: WorkerInput): Promise<WorkerOutput> {
    if (input.turn === 1) return { activity: "INSPECTING CURRENT INTEGRATION", message: "The client is configured for API v1. I am locating the required generation route before changing code." };
    if (input.turn === 2) return { activity: "ROUTE CONFLICT DETECTED", message: "The required generation endpoint is absent in v1. Documentation confirms it is supported only by API v2. The integration must use v2." };
    const current = input.compiledContext.includes("api_version = v2") ? "v2" : "unknown";
    return { activity: "RECOMPILING WORKING CONTEXT", message: `Canonical context now specifies API ${current}. I will update the client against v2 and verify the endpoint response.` };
  }
}
