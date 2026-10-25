"use client";

import { useEffect, useRef, useState } from "react";
import { MessageSquare, PanelRightClose, PanelRightOpen, Send } from "lucide-react";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { RichText } from "@/components/rich-text";
import { useStore } from "@/lib/state/store";

export const SUGGESTED_QUESTIONS = [
  "Why is APP-007 on hold?",
  "Who's competing for TER-01?",
  "Which slots are unfilled and why?",
  "APP-012 has now found a ground-floor space",
];

function ChatBody() {
  const s = useStore();
  const [text, setText] = useState("");
  const endRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    endRef.current?.scrollIntoView({ block: "end" });
  }, [s.chat.length, s.chatBusy]);

  function send(t: string) {
    const q = t.trim();
    if (!q || s.chatBusy) return;
    setText("");
    void s.sendChat(q);
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex-1 space-y-3 overflow-y-auto px-3 py-3" aria-live="polite">
        {s.chat.length === 0 ? (
          <p className="text-[13px] leading-relaxed text-ink-400">
            Ask why an applicant got their decision, compare two applicants, or tell the engine something new, like &ldquo;APP-012 has now found a ground-floor space&rdquo;. Every answer comes from
            the rules engine, with the numbers.
          </p>
        ) : (
          s.chat.map((m) => (
            <div key={m.id} className={`max-w-[94%] rounded-xl px-3.5 py-2.5 text-[13px] leading-relaxed ${m.role === "user" ? "ml-auto bg-teal-700 text-white" : "bg-white/[.06] text-ink-100 ring-1 ring-white/10"}`}>
              {m.role === "assistant" ? <RichText text={m.text} /> : m.text}
              {m.role === "assistant" && m.rulesOnly ? <span className="mt-1 block text-[11px] text-ink-400">Rules-only answer</span> : null}
            </div>
          ))
        )}
        {s.chatBusy ? (
          <div className="max-w-[94%] rounded-xl bg-white/[.06] px-3.5 py-2.5 text-[13px] text-ink-400 ring-1 ring-white/10" role="status">
            Checking the engine…
          </div>
        ) : null}
        <div ref={endRef} />
      </div>

      <div className="border-t border-white/10 px-3 py-3">
        <div className="mb-2.5 flex flex-wrap gap-1.5">
          {SUGGESTED_QUESTIONS.map((q) => (
            <button
              key={q}
              type="button"
              disabled={s.chatBusy}
              onClick={() => send(q)}
              className="rounded-full border border-white/10 px-2.5 py-1 text-left text-xs text-ink-300 hover:bg-white/5 hover:text-white disabled:opacity-50"
            >
              {q}
            </button>
          ))}
        </div>
        <form
          className="flex gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            send(text);
          }}
        >
          <input
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder="Ask about an applicant or territory…"
            aria-label="Message the engine"
            className="field h-10 min-w-0 flex-1 rounded-lg px-3 text-[14px]"
          />
          <button type="submit" aria-label="Send" disabled={!text.trim() || s.chatBusy} className="submit-btn grid size-10 shrink-0 place-items-center rounded-lg">
            <Send className="size-4" />
          </button>
        </form>
      </div>
    </div>
  );
}

/** Desktop: a collapsible column on the right. Phone: a button that opens a bottom sheet. */
export function ChatPanel() {
  const s = useStore();
  const [sheet, setSheet] = useState(false);

  return (
    <>
      <aside
        className={`dark-rail hidden shrink-0 flex-col border-l border-ink-800 bg-ink-950 text-ink-100 transition-[width] lg:flex ${s.chatOpen ? "w-[24rem]" : "w-11"}`}
        aria-label="Ask the engine"
      >
        <div className="flex items-center gap-2 border-b border-white/10 px-2 py-3">
          <button
            type="button"
            onClick={() => s.setChatOpen(!s.chatOpen)}
            aria-label={s.chatOpen ? "Collapse chat" : "Open chat"}
            className="grid size-8 shrink-0 place-items-center rounded-lg bg-white/5 text-ink-300 hover:bg-teal-700 hover:text-white"
          >
            {s.chatOpen ? <PanelRightClose className="size-4" /> : <PanelRightOpen className="size-4" />}
          </button>
          {s.chatOpen ? (
            <div className="min-w-0">
              <h2 className="tracky text-[12px] font-bold text-white uppercase">Ask the engine</h2>
              <p className="truncate text-xs text-ink-400">Answers come from the rules, with the numbers</p>
            </div>
          ) : null}
        </div>
        {s.chatOpen ? <ChatBody /> : null}
      </aside>

      <button
        type="button"
        onClick={() => setSheet(true)}
        className="submit-btn fixed right-4 bottom-4 z-30 flex items-center gap-2 rounded-full px-4 py-2.5 text-sm font-bold lg:hidden"
        aria-label="Open chat"
      >
        <MessageSquare className="size-4" /> Ask
      </button>
      <Sheet open={sheet} onOpenChange={setSheet}>
        <SheetContent side="bottom" className="dark-rail h-[80dvh] border-ink-800 bg-ink-950 text-ink-100">
          <SheetHeader>
            <SheetTitle className="tracky text-[12px] font-bold text-white uppercase">Ask the engine</SheetTitle>
            <SheetDescription className="text-ink-400">Answers come from the rules, with the numbers.</SheetDescription>
          </SheetHeader>
          <ChatBody />
        </SheetContent>
      </Sheet>
    </>
  );
}
