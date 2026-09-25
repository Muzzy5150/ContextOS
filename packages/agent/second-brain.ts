import { SecondBrainProvider, MaintainerInput, MaintainerOutput } from "./provider";
export class DemoSecondBrain implements SecondBrainProvider {
  readonly id = "deterministic";
  readonly model = "scenario-v1";
  async analyze(input: MaintainerInput): Promise<MaintainerOutput> {
    if (input.turn === 1) return {
      classification: "OPEN LOOP", analysis: "The route remains unverified. Track it as an unresolved task.",
      mutations: [{ type: "ADD_OPEN_LOOP", text: "Confirm which API version supports the required generation endpoint.", reason: "The worker has not yet located the route." }]
    };
    if (input.turn === 2) return {
      classification: "DURABLE CONFLICT", analysis: "New endpoint evidence conflicts with the active api_version fact. Supersede v1 and close the investigation loop.",
      mutations: [
        { type: "SUPERSEDE_FACT", key: "api_version", oldValue: "v1", newValue: "v2", reason: "The required generation endpoint is only supported by API v2." },
        ...input.state.openLoops.filter((loop) => loop.status === "active").map((loop) => ({ type: "RESOLVE_OPEN_LOOP", id: loop.id, reason: "API v2 support was confirmed." })),
        { type: "ADD_DECISION", text: "Migrate the integration to API v2.", reason: "The required endpoint is unavailable in v1." }
      ]
    };
    return { classification: "NEXT ACTION", analysis: "The worker used the new canonical fact. Record the remaining implementation step.", mutations: [{ type: "ADD_NEXT_ACTION", text: "Update the client to v2 and verify the generation endpoint response.", reason: "Migration is the next task after version confirmation." }] };
  }
}
