import { StateDiff } from "./state";
export function formatDiff(diff: StateDiff): string {
  return [`STATE #${diff.stateVersion}`, diff.subject, diff.before === undefined ? "" : `- ${diff.before}`, diff.after === undefined ? "" : `+ ${diff.after}`, `Reason: ${diff.reason}`].filter(Boolean).join("\n");
}
