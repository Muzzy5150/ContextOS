# ContextOS Agent Autopsy and state history

Run `npm run contextos:autopsy-demo` to create a controlled deployment failure and a deterministic Autopsy report. The command uses no model provider. The dashboard has separate **Run Failure Scenario** and **Run Autopsy** controls so the recorded failure can be inspected before analysis.

## Historical state images

`JsonFileStorage` writes an exclusive, compact state image under `state-history/<epoch>/state-NNNN.json` for each new state version. The runtime also records intermediate versions when one turn applies several mutations. `getStateAtVersion(version)` and `compareStates(store, a, b)` read these images without touching current `state.json`. A scenario reset starts a new history epoch, keeping prior images on disk. Existing Phase 3 data predating this feature can only provide images for versions written after this change; new scenario runs contain every version.

Each Autopsy demonstration gets its own `data/autopsy-runs/<run-id>/` workspace. `data/autopsy-current.json` points the dashboard to the latest run. Repeating the demo creates a new directory; old runs, reports, events, diffs, and images remain intact. The existing API migration and recovery workspace remains separate.

## Failure and provenance

The deployment scenario starts with approved `deployment_region = us-west-2`. A persisted old-cache `tool_result` event incorrectly leads to a validated `SUPERSEDE_FACT` mutation at state #6, changing the active region to `us-east-1`. The `StateDiff` links to both its source event and mutation proposal event. Later recorded actions select the target and construct a command from that active canonical value. A structured `mission_failure` at state #9 records the affected key and expected/actual values.

## Analyzer

The rules-first analyzer reads the failure event, its state image, diffs, and related action events. For each failed state key, it finds the mutation that introduced the failed value, follows its source/proposal references, and orders downstream uses before the failure. It labels the preceding version as the **suggested pre-mutation state**, without claiming universal causal certainty. The controlled run identifies diff `diff-6`, state #6, and suggests #5. Confidence 0.97 means the recorded diff changed the value directly from the failure's expected value to its actual value; it is a rule score, not a statistical probability.

Autopsy reads only explicit persisted records. It does not inspect or store private model reasoning. `analyzeFailure` is read-only. `runAutopsy` writes a derived report exclusively under the run's `autopsies/` directory and does not alter canonical state, events, diffs, savepoints, or historical images. The dashboard offers historical inspection and comparison only; it has no rollback button.
