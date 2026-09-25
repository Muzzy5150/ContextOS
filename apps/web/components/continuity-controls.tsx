"use client";
import { useRouter } from "next/navigation";
import { useState } from "react";
export function ContinuityControls({ hasSavepoint, workerOnline }: { hasSavepoint: boolean; workerOnline: boolean }) {
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  async function act(action: "start" | "save" | "kill" | "restore") {
    setBusy(action); setError(null);
    try {
      const response = await fetch("/api/continuity", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action }) });
      if (!response.ok) { const body = await response.json() as { error?: string }; throw new Error(body.error ?? "Continuity action failed"); }
      router.refresh();
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Continuity action failed"); }
    finally { setBusy(null); }
  }
  return <div className="continuity-controls"><button onClick={() => act("start")} disabled={busy !== null || workerOnline}>{busy === "start" ? "STARTING" : "START WORKER"}</button><button onClick={() => act("save")} disabled={busy !== null}>{busy === "save" ? "SAVING" : "CREATE SAVEPOINT"}</button><button className="kill-button" onClick={() => act("kill")} disabled={busy !== null || !workerOnline}>{busy === "kill" ? "TERMINATING" : "KILL WORKER"}</button><button onClick={() => act("restore")} disabled={busy !== null || !hasSavepoint || workerOnline}>{busy === "restore" ? "RESTORING" : "RESTORE LATEST"}</button>{error ? <span role="alert" className="control-error">{error}</span> : null}</div>;
}
