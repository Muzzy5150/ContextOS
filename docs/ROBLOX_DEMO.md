# ContextOS / controlled Roblox checkpoint demo

## Run it

```bash
npm run contextos:roblox-demo
npm run dev
```

Open the dashboard and select **Checkpoint Demo** in the menu. The CLI runs the complete sequence and exits with `ROBLOX CHECKPOINT DEMO PASS` only after the savepoint, PID change, zero replay, mission continuation, and Autopsy checks pass. The web utility starts empty; press its action button for each step. **RESET DEMO** creates a fresh isolated run.

The ATOM TOWN mission is a **controlled Roblox FPS map fixture**, not a live Roblox Studio or Roblox API integration. Map inspection, test outcomes, requirement change, and stale configuration are deterministic observations. ContextOS state, validated mutations, savepoint files and checksums, worker processes, historical versions, diffs, failure event, and Autopsy report are real local runtime operations. Roblox Studio or recorded gameplay can be shown beside the dashboard without implying remote control.

## Exact 2–3 minute run of show

| Time | Operator action and screen | Spoken line |
| --- | --- | --- |
| 0:00–0:20 | Select **Checkpoint Demo**; show the empty ATOM TOWN utility. Press **START MISSION**. | “Video games solved this problem decades ago. If you die, you don't replay the entire game. You restore a checkpoint. Long-running agents should work the same way.” |
| 0:20–0:45 | Press **FIX RED SPAWN**. Point to the fact, decision, constraint, open loop, next action, and 42/48 traversal result. | “ContextOS turns growing agent history into structured context points representing what the mission currently needs. The transcript is not the state.” |
| 0:45–1:20 | Press **CREATE SAVEPOINT**, note its actual ID and state version, then **KILL WORKER**. Note the old PID. Press **START FRESH WORKER / RESTORE**. Note the new PID and **HISTORY REPLAYED: 0**. | “This checkpoint isn't the conversation. It's the state of the mission. The old process is completely gone, but the mission survives.” |
| 1:20–1:40 | Show the retained open loop and next action. Press **VERIFY BLUE SPAWN**; show the resolved task and next state diff. Press **CHANGE REQUIREMENT**; show clearance 24 → 32. | “The fresh worker starts from compiled state, finishes the unresolved test, and keeps only 32 as the current clearance. The old value remains auditable.” |
| 1:40–2:05 | Press **INJECT STALE MAP STATE**, then **RUN SIGHTLINE CHECK**, then **RUN AUTOPSY**. Show blue_spawn north → east, the persisted failure, suspected origin, source event, and before/after states. | “ContextOS also records how the agent's understanding changed. When the test fails, Autopsy traces the fault to the state mutation that introduced the wrong spawn.” |
| 2:05–2:30 | Select **Benchmark**. Point to the existing measured 120-step graph: 20,603 estimated raw-history tokens versus 210 active-context tokens, 1.0% ratio, max 220. | “Agents shouldn't have to replay their entire past to know what they're doing next. That's ContextOS.” |

Alternative close: “Games have checkpoints for progress. ContextOS gives checkpoints to agents.”

## What the demo proves

The savepoint captures the active context points after Red spawn is corrected: map name, traversal 42/48, the House B decision, fair-sightline constraint, Blue spawn open loop, and the exact next action. The supervisor kills only its owned worker PID with `SIGKILL`. A fresh PID restores that savepoint through the normal ContextOS worker interface, with zero historical events replayed. The fresh worker receives compiled canonical context and resolves the pending task.

The later stale `blue_spawn = east` value is deliberately promoted through the normal validated mutation path. The verification target is then read from canonical state, producing a structured failure against expected `north`. Autopsy reads persisted events, diffs, and historical state images to identify the introducing `SUPERSEDE_FACT` and suggest the immediately preceding state for inspection. Autopsy does not change current state.

The benchmark is the existing deterministic API workload, not a Roblox-specific measurement. Liquid and Nimble were verified live in a separate sponsor run; this Roblox presentation uses deterministic providers and makes no live sponsor request. RawTree remains implemented but unconfigured; AWS S3 is optional and was skipped.
