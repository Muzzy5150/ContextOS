# ContextOS continuity: savepoint, process death, restore

Run `npm run contextos:recovery-demo` from the repository root. The command uses deterministic First and Second Brains and starts no external model or provider. `npm run contextos:save` creates a manual savepoint; `npm run contextos:restore -- sp-0001` restores one by ID.

## State image

Each `data/savepoints/sp-NNNN.json` contains a unique sequence and ID, timestamp, mission, full canonical `AgentState`, saved state version, compiled context snapshot and token estimate, event cursor, provider mode, and a SHA-256 checksum over the saved payload. The state includes active and superseded facts, goals, constraints, decisions, loops, next actions, artifacts, and completed turn count. The savepoint is written to a temporary file and linked into place exclusively, so an existing ID is never overwritten. A `savepoint_created` event is appended after the file exists. Creating a savepoint does not advance canonical state.

The image does **not** contain the raw `events.jsonl` transcript or `diffs.jsonl`. Those files stay on disk for inspection and audit. The event cursor is informational; restore does not replay from it. Older Phase 2 states without `completedTurns` get that value once when the savepoint is created.

## Restore semantics

Restore reads only the selected savepoint and current `state.json`. It validates the envelope, supported schema version, required state fields, consistency, and checksum before any canonical write. Invalid files abort without changing state or history. A valid restore writes the saved state as a new canonical version: `max(currentVersion, savedVersion) + 1`. `restoredFromSavepoint` and `restoredFromStateVersion` record provenance. A `RESTORE_SAVEPOINT` diff and recovery events are appended; older events and diffs remain. Fresh context is compiled from the restored structured state with zero historical events. The recovery result reports `historyEventsReplayed: 0`.

The existing dashboard and general runtime may read event history for display and legacy progress compatibility. That read is not used to reconstruct canonical state during restore. New states persist turn progress in `AgentState`, so continuation after a restore uses saved progress. The runtime ignores worker output from before the latest restore when retrying a turn.

## Worker isolation

`WorkerSupervisor` starts a separate Node child process running `cli/worker.ts`. Requests go over newline-delimited JSON on stdin/stdout. The worker loads state through `JsonFileStorage`; it holds no inherited conversation object. The supervisor tracks the exact child PID. The demo creates its savepoint before sending SIGKILL to that PID, verifies that it is gone, launches a fresh process with a different PID, verifies the savepoint, restores, compiles context, and completes the next mission step. It then closes the fresh worker; `worker-status.json` shows OFFLINE while retaining the verified recovery timestamp and both PIDs. The recovery event feed retains the lifecycle.

The demo midpoint has active `api_version = v2`, an open endpoint-verification loop, and a next action to run verification. After restore, the new worker sees these in compiled context and records completion. The CLI prints actual PID, state version, byte-size, context-token, and replay telemetry. No model server is launched.

The web Continuity panel reads the same persisted state and event files. Its Start Worker, Create Savepoint, Kill Worker, and Restore Latest controls invoke real server-side operations and disable during requests. The kill action operates only on the child owned by that server process. The recovery demo CLI has its own supervisor and leaves its audit trail visible in the dashboard.
