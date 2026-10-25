import type { Assumptions } from "../engine/assumptions";
import type { FieldDiff, OutcomeDiff } from "../engine/changes";
import type { EngineInput, Overrides, ParseNotice } from "../engine/types";

// Everything the app remembers between visits lives in localStorage under one key. Every read and write is
// wrapped in try/catch so the app works when storage is blocked, full or corrupt.

export const STORAGE_KEY = "fee.state.v1";

export interface ChatMessage {
  id: string;
  role: "user" | "assistant";
  text: string;
  at: string;
  /** Set on assistant messages produced without AI. */
  rulesOnly?: boolean;
}

export interface ChangeLogEntry {
  id: string;
  /** ISO timestamp */
  at: string;
  source: "Inline edit" | "Chat" | "Assumption" | "Withdrawal";
  /** What was said or done, in the user's words where possible. */
  sourceText: string;
  fieldDiffs: FieldDiff[];
  statusDiffs: OutcomeDiff[];
  /** The state before this change, restored by Undo. */
  prev: { overrides: Overrides; assumptions: Assumptions };
  undone?: boolean;
}

export interface Persisted {
  v: 1;
  fileName: string | null;
  baseInput: EngineInput | null;
  notices: ParseNotice[];
  includeExamples: { application: boolean; territory: boolean };
  assumptions: Assumptions | null;
  overrides: Overrides;
  log: ChangeLogEntry[];
  chat: ChatMessage[];
  chatOpen: boolean;
}

export function isPersisted(x: unknown): x is Persisted {
  if (!x || typeof x !== "object") return false;
  const p = x as Persisted;
  if (p.v !== 1) return false;
  if (p.baseInput !== null) {
    const b = p.baseInput;
    if (!b || !Array.isArray(b.applications) || !Array.isArray(b.territories) || !Array.isArray(b.existingStores) || !b.excludedExamples) return false;
  }
  return Array.isArray(p.log) && Array.isArray(p.chat) && !!p.overrides && typeof p.overrides === "object";
}

export function loadPersisted(storage: Pick<Storage, "getItem"> | undefined = safeStorage()): Persisted | null {
  try {
    const raw = storage?.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed: unknown = JSON.parse(raw);
    return isPersisted(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

export function savePersisted(p: Persisted, storage: Pick<Storage, "setItem"> | undefined = safeStorage()): boolean {
  try {
    storage?.setItem(STORAGE_KEY, JSON.stringify(p));
    return !!storage;
  } catch {
    return false;
  }
}

export function clearPersisted(storage: Pick<Storage, "removeItem"> | undefined = safeStorage()): void {
  try {
    storage?.removeItem(STORAGE_KEY);
  } catch {
    /* storage unavailable: nothing to clear */
  }
}

function safeStorage(): Storage | undefined {
  try {
    return typeof window !== "undefined" ? window.localStorage : undefined;
  } catch {
    return undefined;
  }
}
