# Final demo: telemetry and long-horizon benchmark

## RawTree analytical mirror

`JsonFileStorage` persists each event locally first. The optional telemetry pipeline normalizes an allowlist of structured fields, writes `telemetry.jsonl`, and sends the same record to RawTree. Export failures are logged and recorded in `telemetry-status.json`; they do not fail a state mutation or mission step. The pipeline never exports event `detail`, raw prompts, provider keys, or full tool output. Local state, diffs, events, snapshots, and savepoints remain authoritative.

Configure `RAWTREE_ENABLED=true`, `RAWTREE_API_KEY`, and optionally `RAWTREE_BASE_URL`, `RAWTREE_DATABASE`, and `RAWTREE_TABLE` in `apps/web/.env.local`. The defaults are `https://api.rawtree.com` and `contextos_events`. Use a RawTree key with ingestion access to the selected database. The adapter uses the documented [table insertion API](https://rawtree.com/docs/quickstart/api) and [read-only query API](https://rawtree.com/docs/reference/api). `runAnalyticsQueries` provides event counts, context growth by step, per-run event totals, and model token/latency aggregates. No RawTree credentials are required for the rest of ContextOS.

`CONNECTED` means an HTTP insert was acknowledged. `READY` means configured but not yet verified by an insert. `ERROR` shows the latest export failure. `NOT CONFIGURED` means the mirror is disabled or has no key. The exported-event count is the number acknowledged by RawTree, not the number in the local JSONL file. A live ingestion claim requires querying the external table.

After a configured benchmark run, use `npm run contextos:rawtree-query` to query the latest benchmark run, or `npm run contextos:rawtree-query -- <run-id>` for another run. This prints event counts, model usage, context growth, and event totals from RawTree. Run it to verify an exact external record count before claiming live ingestion.

## Benchmark

`npm run contextos:benchmark` creates an isolated 120-step run under `data/benchmarks/<run-id>/`. The baseline payload includes system instructions, **every** persisted synthetic event including large tool logs, and the current task. The ContextOS payload includes the real `compileContext` output plus the same current task. Both use the identical event array at every step. Estimates use `ceil(characters / 4)`; they are payload estimates, not provider-reported token usage.

The scenario introduces `api_version=v1` at step 10 and supersedes it with `v2` at step 55. Several large synthetic tool results and temporary errors remain in the baseline. The canonical state contains active `v2`, historical `v1` remains superseded, and the complete event log remains on disk. No model calls or accuracy claims are involved. `per-step.json` contains the plot points, `summary.json` contains the final numbers, and `metrics.json` documents the measurement path. The UI plots those persisted local metrics, while RawTree receives the step telemetry when configured.

## Two to three minute judge flow

1. **Context:** Run the API migration from the dashboard. Show the v1→v2 semantic diff and compiled-context telemetry. The transcript is an audit record; active state is explicit.
2. **Recovery:** Run the recovery demo. Show the savepoint, killed PID, new PID, zero replay, and continued mission in the continuity feed.
3. **Autopsy:** Run the failure scenario, then Autopsy. Inspect states #5 and #6, the `us-west-2`→`us-east-1` diff, its source event, and the ordered causal chain.
4. **Benchmark:** Run or show the persisted 120-step benchmark. The amber history curve grows; cyan active context stays bounded. Show the measured ratio and zero stale canonical `api_version=v1` facts.

All scenario actions are deterministic. The worker kill/restart, local persistence, savepoint verification, history inspection, and benchmark payload construction are real. RawTree is an optional external mirror, and its dashboard status reflects actual configuration/export results.
