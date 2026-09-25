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

## Nimble — source URL not configured

- An API key is present locally, but `NIMBLE_ENABLED=false` and `NIMBLE_SOURCE_URL` is empty.
- No live Extract v2 request was made. The code and mocked HTTP tests remain available; no external evidence or Nimble-backed state mutation is claimed.
- To verify the combined scenario, configure `NIMBLE_SOURCE_URL` with a stable public HTTPS page containing one unambiguous `api_version: v2` line, enable Nimble, then seed a LIVE fact and run revalidation. The source URL must not contain credentials or query parameters.

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
- Browser: at **1366×768** and **1280×720**, System Bus reported Liquid verified, OpenAI last-test failure, Nimble source missing, and RawTree not configured. Fact Inspector, Recovery, Autopsy, and Benchmark controls worked. No horizontal overflow, framework error overlay, or ContextOS console errors were observed.

The provider status utility reads the persisted Liquid proof and OpenAI failure record. `LIVE VERIFIED` requires a real completed model call linked to a proposal, semantic diff, and matching canonical fact.

## Credential handling

`.env`, `.env.local`, `apps/web/.env.local`, and `data/` are gitignored. None of the configured API key values appeared in the live audit JSON/JSONL files. The repository secret-pattern scan found one deliberate redaction-test fixture in `tests/telemetry.test.ts`; no real credential was found in source or added to Git.
