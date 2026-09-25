# Sponsor integrations

ContextOS keeps local `AgentState`, events, diffs, and savepoints authoritative. Sponsor services are optional devices around that runtime. `DEMO` does not call any sponsor API.

## Liquid AI — Second Brain

Set `CONTEXTOS_SECOND_BRAIN_PROVIDER=liquid` and supply `CONTEXTOS_SECOND_BRAIN_BASE_URL`, `CONTEXTOS_SECOND_BRAIN_MODEL`, and an API key if the endpoint requires one. The endpoint must implement the OpenAI-compatible chat completions API. A small Liquid model suited to JSON extraction is preferable; ContextOS never starts or downloads one. Configure the First Brain separately for the full LIVE scenario.

The Second Brain sees current canonical state, recent diffs, new evidence, and First Brain output. It proposes JSON mutations. ContextOS parses, validates, and applies them in the deterministic engine; Liquid cannot write state directly. The revalidation scenario can use the configured LIVE Second Brain without requiring a configured LIVE First Brain.

## Nimble — fresh evidence

Set `NIMBLE_ENABLED=true`, `NIMBLE_API_KEY`, and `NIMBLE_SOURCE_URL`. The source must be a public HTTPS page without credentials, query parameters, or a fragment. For the current revalidation demonstration it must contain exactly one unambiguous `api_version: v2` style line. Use a stable documentation page you control or trust. No public source is baked into LIVE mode.

The adapter uses Nimble's [Extract v2 API](https://docs.nimbleway.com/nimble-sdk/web-tools/extract/quickstart): `POST https://sdk.nimbleway.com/v2/extract` with Bearer authorization and Markdown output. It normalizes the one fact value, source URL, and observation time. It does not store the page body or API key. The result becomes an `external_evidence_received` event. The Second Brain must propose a matching supersession, and the existing validator and mutation engine make the state change. Errors leave canonical state unchanged.

The Fact Inspector in Current State uses an isolated revalidation workspace. **SEED DEMO FACT** starts a stale v1 fact with deterministic evidence available. **SEED LIVE FACT** requires Nimble and a LIVE Second Brain configuration. **REVALIDATE** uses the selected mode; it never silently changes LIVE to DEMO.

## RawTree — analytical mirror

The existing `RAWTREE_*` settings in `.env.example` enable the server-side telemetry exporter. Local files remain authoritative. Without a key, the UI reports **NOT CONFIGURED**. With credentials, run `npm run contextos:benchmark` and `npm run contextos:rawtree-query -- <run-id>` to verify external records. Export failures are diagnostic and do not stop state transitions.

## AWS — optional remote savepoints

S3 mirroring is intentionally unimplemented. Local SHA-256 verified savepoints and process recovery remain operational. No AWS credential was available for this pass, so no remote durability claim is made.

## Verify

```bash
npm run contextos:sponsors
npm run contextos:revalidate-demo
npm run contextos:demo
npm run contextos:recovery-demo
npm run contextos:autopsy-demo
npm run contextos:benchmark
```

`contextos:sponsors` reports configuration and any persisted provider verification evidence. “CONFIGURED” is not a network connection claim. Live Liquid, Nimble, and RawTree calls require real credentials and an explicit LIVE action; tests use mocked HTTP and deterministic evidence.

For the local small Liquid model, `npm run contextos:sponsors -- --verify-liquid` runs a real Second Brain request against a deterministic First Brain event and verifies the accepted mutation in an isolated workspace. The latest actual results and unresolved access are recorded in [LIVE_VERIFICATION.md](LIVE_VERIFICATION.md).
