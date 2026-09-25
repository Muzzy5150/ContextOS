export type Mutation =
  | { type: "ADD_FACT"; key: string; value: string; reason: string; confidence?: number }
  | { type: "UPDATE_FACT"; key: string; value: string; reason: string }
  | { type: "SUPERSEDE_FACT"; key: string; oldValue: string; newValue: string; reason: string }
  | { type: "ADD_CONSTRAINT" | "ADD_DECISION" | "ADD_OPEN_LOOP" | "ADD_NEXT_ACTION"; text: string; reason: string }
  | { type: "RESOLVE_OPEN_LOOP" | "REMOVE_NEXT_ACTION"; id: string; reason: string }
  | { type: "ARCHIVE_ITEM"; collection: "facts" | "constraints" | "decisions" | "openLoops" | "nextActions"; id: string; reason: string };
export interface ValidationResult { valid: true; mutation: Mutation };
export interface ValidationFailure { valid: false; error: string };
const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null && !Array.isArray(value);
const nonEmpty = (value: unknown): value is string => typeof value === "string" && value.trim().length > 0 && value.length <= 1000;
export function validateMutation(value: unknown): ValidationResult | ValidationFailure {
  if (!isRecord(value) || !nonEmpty(value.type)) return { valid: false, error: "Mutation must be an object with a type" };
  if (!nonEmpty(value.reason)) return { valid: false, error: "Mutation requires a reason" };
  const type = value.type;
  if (type === "ADD_FACT" || type === "UPDATE_FACT") {
    if (!nonEmpty(value.key) || !nonEmpty(value.value)) return { valid: false, error: `${type} requires key and value` };
    if (type === "ADD_FACT" && value.confidence !== undefined && (typeof value.confidence !== "number" || value.confidence < 0 || value.confidence > 1)) return { valid: false, error: "Confidence must be between 0 and 1" };
    return { valid: true, mutation: value as Mutation };
  }
  if (type === "SUPERSEDE_FACT") {
    if (!nonEmpty(value.key) || !nonEmpty(value.oldValue) || !nonEmpty(value.newValue) || value.oldValue === value.newValue) return { valid: false, error: "SUPERSEDE_FACT requires distinct old and new values" };
    return { valid: true, mutation: value as Mutation };
  }
  if (["ADD_CONSTRAINT", "ADD_DECISION", "ADD_OPEN_LOOP", "ADD_NEXT_ACTION"].includes(type)) {
    if (!nonEmpty(value.text)) return { valid: false, error: `${type} requires text` };
    return { valid: true, mutation: value as Mutation };
  }
  if (type === "RESOLVE_OPEN_LOOP" || type === "REMOVE_NEXT_ACTION") {
    if (!nonEmpty(value.id)) return { valid: false, error: `${type} requires id` };
    return { valid: true, mutation: value as Mutation };
  }
  if (type === "ARCHIVE_ITEM") {
    if (!nonEmpty(value.id) || !["facts", "constraints", "decisions", "openLoops", "nextActions"].includes(String(value.collection))) return { valid: false, error: "ARCHIVE_ITEM requires a valid collection and id" };
    return { valid: true, mutation: value as Mutation };
  }
  return { valid: false, error: `Unknown mutation type: ${type}` };
}
