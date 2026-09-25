# Live provider verification — 2026-09-25

This record contains no credentials. Live checks used isolated, ignored files under `data/live-verification/`; the normal demo workspace remains separate.

## OpenAI First Brain — configured, live request failed

- Configured model: `gpt-5.6-luna`.
- ContextOS test: one LIVE First Brain turn after compiling canonical state. `context_compiled` event `042f1e03-1ce5-45e3-9d7c-93d3c111267f` recorded 100 estimated raw-history tokens and 124 estimated compiled-context tokens at this short initial turn.
- Result: provider returned HTTP **403**. `model_request_failed` event `139040d3-ffed-4669-a14d-97bebbf879f7` recorded `AUTH_FAILED`. No First Brain output, provider usage, or canonical mutation was produced; state remained #1. The 403 may indicate credential or project/model permission; the provider did not disclose a more specific reason.
- Status: **NOT LIVE VERIFIED**. Do not present this attempt as a successful OpenAI run.

## Liquid AI Second Brain — LIVE VERIFIED

- Model: `LiquidAI/lfm2.5-350m`, already installed on the local Ollama OpenAI-compatible endpoint. No heavyweight model was started or downloaded.
- ContextOS test: `npm run contextos:sponsors -- --verify-liquid`. A deterministic First Brain supplied the scenario's explicit documentation evidence; the real Liquid Second Brain request then ran through `advanceWithProviders`, runtime mutation validation, and the deterministic state engine.
- Real model call: event `7796317e-1c55-483a-a199-846ff17693e5` at `2026-09-25T20:10:05.451Z`; **662 ms**, **608 input tokens**, **116 output tokens** reported by the provider.
- Actual model proposal: `{"type":"SUPERSEDE_FACT","key":"api_version","oldValue":"v1","newValue":"v2","reason":"New documentation mentions v2 as the valid version"}`.
- First Brain event: `5ee51bd2-377c-4310-93e9-823798553f8d`. Proposal event: `74aecdc4-3d8d-49c0-8dfe-05271d217ea0`. Accepted semantic diff: `diff-3`, state **#2 → #3**, `v1 → v2`. Active canonical fact is v2; v1 is superseded history.
- The first unconstrained local attempt produced an invalid duplicate fact and left state unchanged. A narrow, evidence-derived JSON schema for explicit fact conflicts fixed the small model's key/value drift. The validator was not relaxed. This result verifies the explicit supersession path; it does not claim that every open-ended maintenance task works with the 350M model.

## Nimble — LIVE VERIFIED

- Source: https://raw.githubusercontent.com/Muzzy5150/ContextOS/main/docs/revalidation-source.json (public HTTP 200; `api_version = v2`).
- A real ContextOS `NimbleEvidenceProvider` Extract v2 request succeeded and normalized `api_version = v2` in **1,082 ms**. A separate live run through `revalidateFact` measured **2,244 ms** for the Nimble request.
- Extract v2 returned the JSON source as Markdown with an escaped underscore in `api\_version`. The parser now accepts that Markdown form and one-line JSON keys. No mutation or validation rule was relaxed.
- In the isolated LIVE run `36016279-69e4-47f5-9843-6ddcb03cebcf`, Nimble produced `external_evidence_received` event `d4a4f475-2970-440d-80dd-d9507609b7d8` at state #1. Its structured evidence was `api_version = v2`; the event retains the public source URL and observation time `2026-09-25T20:56:36.867Z`.

## Nimble + Liquid + ContextOS — LIVE END-TO-END VERIFIED

- The isolated canonical state began at **#1** with active `api_version = v1` and stale freshness metadata. The Nimble evidence event carried `v2` into the existing `revalidateFact` flow.
- The configured live Liquid Second Brain, model `LiquidAI/lfm2.5-350m`, returned the structured `SUPERSEDE_FACT` proposal `api_version: v1 → v2` with reason referencing the evidence event. Its real model request took **1,159 ms** and reported **169 input / 99 output tokens**.
- Runtime mutation validation passed. Proposal event `3794562b-d55c-4c53-80fa-0466e4b399d1` led to semantic `diff-2` and canonical state **#1 → #2** through the deterministic mutation engine.
- State #2 has active `api_version = v2`, fresh metadata, and source event `d4a4f475-2970-440d-80dd-d9507609b7d8`. The old `v1` fact is superseded history. The diff links to both evidence and proposal events. Neither provider wrote canonical state directly.
- The live verification data is isolated under ignored `data/live-verification/nimble-liquid-e2e/`. A local check found no Nimble or Liquid credential value in persisted state, events, or diffs.

## RawTree and AWS

- RawTree exporter remains implemented and locally tested. `npm run contextos:rawtree-query` returned `RAWTREE NOT CONFIGURED`; no external insertion or query was claimed.
- AWS S3 was intentionally skipped. Local savepoint continuity remains operational.

## Core regression evidence

- Context demo: state #6; active `api_version=v2`, historical v1 superseded.
- Revalidation demo: state #1 → #2, `v1 → v2`, source-event provenance preserved.
- Recovery demo: PID **53145** killed with SIGKILL, fresh PID **53146**, zero history replay, mission continued to state #11. The dashboard controls were also exercised with PID **53108** killed and PID **53112** restored; that worker was stopped after inspection.
- Autopsy demo: persisted bad `deployment_region` mutation at #6 traced to failure at #9, with #5 suggested as the pre-mutation state.
- Benchmark: 120 steps, 20,603 estimated history tokens, 210 active-context tokens, 1.0% ratio, 220 maximum active tokens, zero stale canonical API facts.
- Quality gate: lint, typecheck, **36/36 tests**, and production build passed.
- Earlier browser check, before the Nimble live run: at **1366×768** and **1280×720**, System Bus reported Liquid verified, OpenAI last-test failure, Nimble source missing, and RawTree not configured. Fact Inspector, Recovery, Autopsy, and Benchmark controls worked. No horizontal overflow, framework error overlay, or ContextOS console errors were observed.

The provider status utility reads the persisted Liquid proof, OpenAI failure record, and isolated Nimble revalidation proof. Nimble displays `LIVE VERIFIED` only while its configured public source matches the persisted evidence event, linked proposal/diff, and current canonical fact.

## Credential handling

`.env`, `.env.local`, `apps/web/.env.local`, and `data/` are gitignored. None of the configured API key values appeared in the live audit JSON/JSONL files. The repository secret-pattern scan found one deliberate redaction-test fixture in `tests/telemetry.test.ts`; no real credential was found in source or added to Git.
