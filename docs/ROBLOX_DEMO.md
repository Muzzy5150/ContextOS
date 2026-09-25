# ContextOS / ATOM TOWN checkpoint presentation

## Open one page

```bash
npm run dev
```

Open **http://localhost:3000/demo/roblox**. Click **RESET**, turn **PRESENTER NOTES ON** if wanted, then click **RUN FULL DEMO**. The automatic sequence takes about 70–90 seconds and waits for each real ContextOS operation before advancing. **PAUSE**, **PREVIOUS**, and **NEXT STEP** let you control the pace. The numbered timeline revisits completed historical state images without changing current canonical state.

If the browser is unavailable, run `npm run contextos:roblox-demo`. It exits with `ROBLOX CHECKPOINT DEMO PASS` only after verifying the savepoint, fresh PID, zero replay, mission continuation, and Autopsy.

## What is real

The ATOM TOWN map drawing and workload observations are **controlled deterministic inputs**. This is not live Roblox Studio control. ContextOS uses its real validated mutation engine, canonical AgentState, state diffs and historical snapshots, checksum-verified savepoint, owned worker process with actual `SIGKILL`, fresh process restore, zero-event replay, continued worker task, structured failure, and persisted Autopsy report. The final graph uses the separately measured 120-step API benchmark. The page makes no external sponsor request; Liquid and Nimble live verification remains documented in [LIVE_VERIFICATION.md](LIVE_VERIFICATION.md).

## 60–90 second automatic sequence

1. Inspect ATOM TOWN: exposed Red spawn becomes a fact and open task.
2. Move Red spawn behind House B; record a decision and traversal 42/48.
3. Save those context points. Start an owned worker and show its PID.
4. Kill that exact worker. Restore the savepoint in a fresh worker with a different PID and **0 historical events replayed**.
5. Resolve the Blue spawn open loop, supersede clearance 24 → 32, then deliberately promote stale Blue spawn north → east.
6. Run the controlled sightline check. Its failure event points to `blue_spawn`; Autopsy traces the introducing diff and suggests the preceding state for inspection.
7. Show the actual persisted 120-step benchmark: 20,603 estimated history tokens versus 210 active context tokens, about 1.0% ratio, maximum active context 220.

## 2–3 minute narrated version

| Time | Screen | Say |
| --- | --- | --- |
| 0:00–0:20 | Start / map inspection | “Video games use checkpoints so you do not replay the entire game after a loss. Long-running agents should too.” |
| 0:20–0:45 | Red spawn repair / context points | “ContextOS turns growing history into facts, decisions, constraints, open tasks, and next actions. The transcript is not the state.” |
| 0:45–1:20 | Savepoint / worker loss / restore | “This checkpoint contains the state of the mission, not the conversation. The old process is gone, but the mission survives. The new worker replayed zero events.” |
| 1:20–1:40 | Blue verification / clearance diff | “The fresh worker knows the unresolved task and completes it. When requirements change, 32 becomes current while 24 remains historical.” |
| 1:40–2:05 | Stale Blue spawn / failure / Autopsy | “ContextOS records how understanding changes. Autopsy traces this failure back to the mutation that introduced the wrong spawn.” |
| 2:05–2:30 | Benchmark | “Across 120 steps, full history reached 20,603 estimated tokens; active context needed 210. Agents should not have to replay their entire past to know what to do next.” |

Alternative closing: “Games have checkpoints for progress. ContextOS gives checkpoints to agents.”
