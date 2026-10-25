"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, useSyncExternalStore, type ReactNode } from "react";
import { DEFAULT_ASSUMPTIONS, runEngine, type Assumptions } from "@/lib/engine";
import { applyChange, diffResults, withdrawApplication, type Change, type FieldDiff } from "@/lib/engine/changes";
import { applyExampleChoice, parseWorkbook } from "@/lib/engine/parse";
import { todayIST } from "@/lib/engine/reference";
import type { EngineInput, EngineResult, Overrides, ParseNotice, Status } from "@/lib/engine/types";
import {
  clearPersisted,
  loadPersisted,
  savePersisted,
  type ChangeLogEntry,
  type ChatMessage,
  type Persisted,
} from "./persist";

export type TabKey = "overview" | "applications" | "territories" | "map" | "changes";
export type DrawerTarget = { kind: "application" | "territory"; id: string } | null;

const MAX_FILE_BYTES = 15 * 1024 * 1024;

export interface Store {
  ready: boolean;
  fileName: string | null;
  input: EngineInput | null;
  notices: ParseNotice[];
  uploadError: string | null;
  busy: boolean;
  today: string;
  assumptions: Assumptions;
  overrides: Overrides;
  log: ChangeLogEntry[];
  chat: ChatMessage[];
  result: EngineResult | null;
  engineError: string | null;
  includeExamples: { application: boolean; territory: boolean };
  aiAvailable: boolean;
  // UI state
  tab: TabKey;
  setTab: (t: TabKey) => void;
  drawer: DrawerTarget;
  openApplicant: (id: string) => void;
  openTerritory: (id: string) => void;
  closeDrawer: () => void;
  assumptionsOpen: boolean;
  setAssumptionsOpen: (open: boolean) => void;
  chatOpen: boolean;
  setChatOpen: (open: boolean) => void;
  statusFilter: Status[];
  setStatusFilter: (s: Status[]) => void;
  // Actions
  loadFile: (file: File) => Promise<void>;
  loadSample: () => Promise<void>;
  startOver: () => void;
  dismissUploadError: () => void;
  setIncludeExample: (kind: "application" | "territory", include: boolean) => void;
  commit: (changes: Change[], sourceText: string, source?: ChangeLogEntry["source"]) => ChangeLogEntry | null;
  withdraw: (id: string, reason: string) => ChangeLogEntry | null;
  changeAssumptions: (next: Assumptions, summary: FieldDiff[], sourceText: string) => ChangeLogEntry | null;
  undo: () => ChangeLogEntry | null;
  addChat: (m: Omit<ChatMessage, "id" | "at">) => void;
  clearChat: () => void;
}

const Ctx = createContext<Store | null>(null);

export function useStore(): Store {
  const s = useContext(Ctx);
  if (!s) throw new Error("useStore must be used inside <StoreProvider>");
  return s;
}

function safeRun(
  input: EngineInput | null,
  assumptions: Assumptions,
  overrides: Overrides,
  today: string
): { result: EngineResult | null; error: string | null } {
  if (!input) return { result: null, error: null };
  try {
    // The decision engine re-verifies the placement rules itself; the UI shows the verdict instead of crashing.
    return { result: runEngine(input, assumptions, overrides, { today, simulate: false, throwOnViolation: false }), error: null };
  } catch (e) {
    return { result: null, error: e instanceof Error ? e.message : "The engine could not process this data." };
  }
}

const uid = () => `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;

const subscribeNever = () => () => {};

/** Renders nothing but a loading line on the server, then the app on the client where localStorage exists. */
export function StoreProvider({ children }: { children: ReactNode }) {
  const isClient = useSyncExternalStore(subscribeNever, () => true, () => false);
  if (!isClient) {
    return (
      <div className="grid h-dvh place-items-center text-sm text-muted-foreground" aria-busy="true">
        Loading…
      </div>
    );
  }
  return <StoreInner>{children}</StoreInner>;
}

function StoreInner({ children }: { children: ReactNode }) {
  const [saved] = useState<Persisted | null>(() => loadPersisted());
  const [fileName, setFileName] = useState<string | null>(saved?.fileName ?? null);
  const [baseInput, setBaseInput] = useState<EngineInput | null>(saved?.baseInput ?? null);
  const [notices, setNotices] = useState<ParseNotice[]>(saved?.notices ?? []);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [today] = useState(() => todayIST());
  const [assumptions, setAssumptions] = useState<Assumptions>(() => ({ ...DEFAULT_ASSUMPTIONS, ...(saved?.assumptions ?? {}) }));
  const [overrides, setOverrides] = useState<Overrides>(saved?.overrides ?? {});
  const [log, setLog] = useState<ChangeLogEntry[]>(saved?.log ?? []);
  const [chat, setChat] = useState<ChatMessage[]>(saved?.chat ?? []);
  const [includeExamples, setIncludeExamples] = useState(saved?.includeExamples ?? { application: false, territory: false });
  const [tab, setTab] = useState<TabKey>("overview");
  const [drawer, setDrawer] = useState<DrawerTarget>(null);
  const [assumptionsOpen, setAssumptionsOpen] = useState(false);
  const [chatOpen, setChatOpen] = useState(saved?.chatOpen ?? true);
  const [statusFilter, setStatusFilter] = useState<Status[]>([]);

  // Save on change (debounced).
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => {
      const snapshot: Persisted = { v: 1, fileName, baseInput, notices, includeExamples, assumptions, overrides, log, chat, chatOpen };
      savePersisted(snapshot);
    }, 250);
    return () => {
      if (timer.current) clearTimeout(timer.current);
    };
  }, [fileName, baseInput, notices, includeExamples, assumptions, overrides, log, chat, chatOpen]);

  const input = useMemo(
    () =>
      baseInput
        ? applyExampleChoice(baseInput, { includeExampleApplication: includeExamples.application, includeExampleTerritory: includeExamples.territory })
        : null,
    [baseInput, includeExamples]
  );

  const run = useMemo(() => safeRun(input, assumptions, overrides, today), [input, assumptions, overrides, today]);
  const result = run.result;

  const ingest = useCallback((bytes: ArrayBuffer, name: string) => {
    const parsed = parseWorkbook(bytes);
    if (!parsed.ok) {
      setUploadError(parsed.notices.find((n) => n.level === "error")?.message ?? "We couldn't read that file.");
      return false;
    }
    setUploadError(null);
    setFileName(name);
    setBaseInput(parsed.input);
    setNotices(parsed.notices);
    setIncludeExamples({ application: false, territory: false });
    // A new file starts clean: edits made to the old one would otherwise attach to matching IDs.
    setOverrides({});
    setLog([]);
    setChat([]);
    setStatusFilter([]);
    setDrawer(null);
    setTab("overview");
    return true;
  }, []);

  const loadFile = useCallback(
    async (file: File) => {
      setBusy(true);
      try {
        if (file.size > MAX_FILE_BYTES) {
          setUploadError("That file is larger than 15 MB. The template is normally well under 1 MB.");
          return;
        }
        if (!/\.(xlsx|xlsm|xls)$/i.test(file.name)) {
          setUploadError(`“${file.name}” isn't an Excel workbook. Please upload the .xlsx template (use Download template if you need a fresh copy).`);
          return;
        }
        ingest(await file.arrayBuffer(), file.name);
      } catch {
        setUploadError("We couldn't read that file. Try saving it again as .xlsx.");
      } finally {
        setBusy(false);
      }
    },
    [ingest]
  );

  const loadSample = useCallback(async () => {
    setBusy(true);
    try {
      const res = await fetch("/sample/Stress_Test_Case1.xlsx");
      if (!res.ok) throw new Error("sample missing");
      ingest(await res.arrayBuffer(), "Stress_Test_Case1.xlsx (sample)");
    } catch {
      setUploadError("The sample file couldn't be loaded. Check your connection and try again, or upload your own file.");
    } finally {
      setBusy(false);
    }
  }, [ingest]);

  const startOver = useCallback(() => {
    clearPersisted();
    setFileName(null);
    setBaseInput(null);
    setNotices([]);
    setUploadError(null);
    setIncludeExamples({ application: false, territory: false });
    setAssumptions(DEFAULT_ASSUMPTIONS);
    setOverrides({});
    setLog([]);
    setChat([]);
    setStatusFilter([]);
    setDrawer(null);
    setTab("overview");
  }, []);

  const setIncludeExample = useCallback((kind: "application" | "territory", include: boolean) => {
    setIncludeExamples((s) => ({ ...s, [kind]: include }));
  }, []);

  const pushLog = useCallback((entry: ChangeLogEntry) => setLog((l) => [entry, ...l]), []);

  const commit = useCallback<Store["commit"]>(
    (changes, sourceText, source = "Inline edit") => {
      if (!input || !result) return null;
      let ov = overrides;
      const diffs: FieldDiff[] = [];
      for (const ch of changes) {
        const r = applyChange(input, ov, ch);
        if (r) {
          ov = r.overrides;
          diffs.push(r.diff);
        }
      }
      if (!diffs.length) return null;
      const after = safeRun(input, assumptions, ov, today).result;
      const entry: ChangeLogEntry = {
        id: uid(),
        at: new Date().toISOString(),
        source,
        sourceText,
        fieldDiffs: diffs,
        statusDiffs: after ? diffResults(result, after, changes.map((c) => c.id)) : [],
        prev: { overrides, assumptions },
      };
      setOverrides(ov);
      pushLog(entry);
      return entry;
    },
    [input, result, overrides, assumptions, today, pushLog]
  );

  const withdraw = useCallback<Store["withdraw"]>(
    (id, reason) => {
      if (!input || !result) return null;
      const r = withdrawApplication(input, overrides, id, reason);
      if (!r) return null;
      const after = safeRun(input, assumptions, r.overrides, today).result;
      const entry: ChangeLogEntry = {
        id: uid(),
        at: new Date().toISOString(),
        source: "Withdrawal",
        sourceText: `${id} withdrawn${reason ? `: ${reason}` : ""}`,
        fieldDiffs: [r.diff],
        statusDiffs: after ? diffResults(result, after, [id]) : [],
        prev: { overrides, assumptions },
      };
      setOverrides(r.overrides);
      pushLog(entry);
      return entry;
    },
    [input, result, overrides, assumptions, today, pushLog]
  );

  const changeAssumptions = useCallback<Store["changeAssumptions"]>(
    (next, summary, sourceText) => {
      if (!input || !result || !summary.length) {
        setAssumptions(next);
        return null;
      }
      const after = safeRun(input, next, overrides, today).result;
      const entry: ChangeLogEntry = {
        id: uid(),
        at: new Date().toISOString(),
        source: "Assumption",
        sourceText,
        fieldDiffs: summary,
        statusDiffs: after ? diffResults(result, after) : [],
        prev: { overrides, assumptions },
      };
      setAssumptions(next);
      pushLog(entry);
      return entry;
    },
    [input, result, overrides, assumptions, today, pushLog]
  );

  const undo = useCallback<Store["undo"]>(() => {
    const latest = log.find((e) => !e.undone);
    if (!latest) return null;
    setOverrides(latest.prev.overrides);
    setAssumptions(latest.prev.assumptions);
    setLog((l) => l.map((e) => (e.id === latest.id ? { ...e, undone: true } : e)));
    return latest;
  }, [log]);

  const addChat = useCallback<Store["addChat"]>((m) => setChat((c) => [...c, { ...m, id: uid(), at: new Date().toISOString() }]), []);
  const clearChat = useCallback(() => setChat([]), []);

  const value: Store = {
    ready: true,
    fileName,
    input,
    notices,
    uploadError,
    busy,
    today,
    assumptions,
    overrides,
    log,
    chat,
    result,
    engineError: run.error,
    includeExamples,
    aiAvailable: false,
    tab,
    setTab,
    drawer,
    openApplicant: (id) => setDrawer({ kind: "application", id }),
    openTerritory: (id) => setDrawer({ kind: "territory", id }),
    closeDrawer: () => setDrawer(null),
    assumptionsOpen,
    setAssumptionsOpen,
    chatOpen,
    setChatOpen,
    statusFilter,
    setStatusFilter,
    loadFile,
    loadSample,
    startOver,
    dismissUploadError: () => setUploadError(null),
    setIncludeExample,
    commit,
    withdraw,
    changeAssumptions,
    undo,
    addChat,
    clearChat,
  };

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}
