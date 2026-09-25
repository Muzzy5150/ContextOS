import { AgentState, Fact, StateDiff, StateItem } from "./state";
import { Mutation } from "./validation";
export interface ApplyResult { state: AgentState; diff: StateDiff }
export function applyMutation(state: AgentState, mutation: Mutation, now: string, sourceEventId?: string, provenance?: Pick<Fact, "sourceUrl" | "observedAt" | "freshness">): ApplyResult {
  const next: AgentState = structuredClone(state);
  const version = state.stateVersion + 1;
  const id = `item-${version}`;
  let subject = ""; let before: string | undefined; let after: string | undefined;
  const item = (text: string): StateItem => ({ id, text, status: "active", createdAt: now, updatedAt: now, sourceEventId });
  const activeFact = (key: string): Fact | undefined => next.facts.find((fact) => fact.key === key && fact.status === "active");
  switch (mutation.type) {
    case "ADD_FACT": {
      if (activeFact(mutation.key)) throw new Error(`Active fact already exists: ${mutation.key}`);
      next.facts.push({ id, key: mutation.key, value: mutation.value, status: "active", confidence: mutation.confidence, createdAt: now, updatedAt: now, sourceEventId, ...provenance });
      subject = `FACT / ${mutation.key}`; after = mutation.value; break;
    }
    case "UPDATE_FACT": {
      const fact = activeFact(mutation.key); if (!fact) throw new Error(`Active fact not found: ${mutation.key}`);
      before = fact.value; fact.value = mutation.value; fact.updatedAt = now; fact.sourceEventId = sourceEventId; Object.assign(fact, provenance); subject = `FACT / ${mutation.key}`; after = fact.value; break;
    }
    case "SUPERSEDE_FACT": {
      const fact = activeFact(mutation.key);
      if (!fact || fact.value !== mutation.oldValue) throw new Error(`Expected active ${mutation.key} = ${mutation.oldValue}`);
      before = fact.value; fact.status = "superseded"; fact.updatedAt = now; fact.supersededBy = id;
      next.facts.push({ id, key: mutation.key, value: mutation.newValue, status: "active", createdAt: now, updatedAt: now, sourceEventId, ...provenance });
      subject = `FACT / ${mutation.key}`; after = mutation.newValue; break;
    }
    case "ADD_CONSTRAINT": next.constraints.push(item(mutation.text)); subject = "CONSTRAINT"; after = mutation.text; break;
    case "ADD_DECISION": next.decisions.push(item(mutation.text)); subject = "DECISION"; after = mutation.text; break;
    case "ADD_OPEN_LOOP": next.openLoops.push(item(mutation.text)); subject = "OPEN LOOP"; after = mutation.text; break;
    case "ADD_NEXT_ACTION": next.nextActions.push(item(mutation.text)); subject = "NEXT ACTION"; after = mutation.text; break;
    case "RESOLVE_OPEN_LOOP": {
      const loop = next.openLoops.find((entry) => entry.id === mutation.id && entry.status === "active"); if (!loop) throw new Error(`Active open loop not found: ${mutation.id}`);
      before = loop.text; loop.status = "resolved"; loop.updatedAt = now; subject = "OPEN LOOP"; after = "RESOLVED"; break;
    }
    case "REMOVE_NEXT_ACTION": {
      const action = next.nextActions.find((entry) => entry.id === mutation.id && entry.status === "active"); if (!action) throw new Error(`Active next action not found: ${mutation.id}`);
      before = action.text; action.status = "archived"; action.updatedAt = now; subject = "NEXT ACTION"; after = "REMOVED"; break;
    }
    case "ARCHIVE_ITEM": {
      const target = next[mutation.collection].find((entry) => entry.id === mutation.id && entry.status === "active");
      if (!target) throw new Error(`Active item not found: ${mutation.collection}/${mutation.id}`);
      before = "value" in target ? target.value : target.text; target.status = "archived"; target.updatedAt = now; subject = mutation.collection.toUpperCase(); after = "ARCHIVED"; break;
    }
  }
  next.stateVersion = version; next.updatedAt = now;
  return { state: next, diff: { id: `diff-${version}`, stateVersion: version, mutationType: mutation.type, subject, before, after, reason: mutation.reason, sourceEventId, timestamp: now } };
}
