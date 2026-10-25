"use client";

import { useEffect, useRef, useState } from "react";
import { MessageSquare, PanelRightClose, PanelRightOpen, Send } from "lucide-react";
import { Button } from "@/components/ui/button";
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
          <p className="text-sm text-muted-foreground">
            Ask why an applicant got their decision, compare two applicants, or tell the engine something new, like &ldquo;APP-012 has now found a ground-floor space&rdquo;. Every answer comes from
            the rules engine, with the numbers.
          </p>
        ) : (
          s.chat.map((m) => (
            <div key={m.id} className={`max-w-[94%] rounded-lg px-3 py-2 text-sm ${m.role === "user" ? "ml-auto bg-brand text-white" : "bg-muted"}`}>
              {m.role === "assistant" ? <RichText text={m.text} /> : m.text}
              {m.role === "assistant" && m.rulesOnly ? <span className="mt-1 block text-[11px] text-muted-foreground">Rules-only answer</span> : null}
            </div>
          ))
        )}
        {s.chatBusy ? (
          <div className="max-w-[94%] rounded-lg bg-muted px-3 py-2 text-sm text-muted-foreground" role="status">
            Checking the engine…
          </div>
        ) : null}
        <div ref={endRef} />
      </div>

      <div className="border-t px-3 py-2">
        <div className="mb-2 flex flex-wrap gap-1.5">
          {SUGGESTED_QUESTIONS.map((q) => (
            <button
              key={q}
              type="button"
              disabled={s.chatBusy}
              onClick={() => send(q)}
              className="rounded-full border px-2.5 py-1 text-left text-xs text-muted-foreground hover:bg-muted hover:text-foreground disabled:opacity-50"
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
            className="h-9 min-w-0 flex-1 rounded-lg border bg-background px-3 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"
          />
          <Button type="submit" size="icon-lg" aria-label="Send" disabled={!text.trim() || s.chatBusy}>
            <Send />
          </Button>
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
        className={`hidden shrink-0 flex-col border-l bg-card transition-[width] lg:flex ${s.chatOpen ? "w-[22rem]" : "w-11"}`}
        aria-label="Ask the engine"
      >
        <div className="flex items-center gap-2 border-b px-2 py-2">
          <button
            type="button"
            onClick={() => s.setChatOpen(!s.chatOpen)}
            aria-label={s.chatOpen ? "Collapse chat" : "Open chat"}
            className="grid size-7 shrink-0 place-items-center rounded hover:bg-muted"
          >
            {s.chatOpen ? <PanelRightClose className="size-4" /> : <PanelRightOpen className="size-4" />}
          </button>
          {s.chatOpen ? (
            <div className="min-w-0">
              <h2 className="text-sm font-semibold">Ask the engine</h2>
              <p className="truncate text-xs text-muted-foreground">Answers come from the rules, with the numbers</p>
            </div>
          ) : null}
        </div>
        {s.chatOpen ? <ChatBody /> : null}
      </aside>

      <button
        type="button"
        onClick={() => setSheet(true)}
        className="fixed right-4 bottom-4 z-30 flex items-center gap-2 rounded-full bg-brand px-4 py-2.5 text-sm font-medium text-white shadow-lg lg:hidden"
        aria-label="Open chat"
      >
        <MessageSquare className="size-4" /> Ask
      </button>
      <Sheet open={sheet} onOpenChange={setSheet}>
        <SheetContent side="bottom" className="h-[80dvh]">
          <SheetHeader>
            <SheetTitle>Ask the engine</SheetTitle>
            <SheetDescription>Answers come from the rules, with the numbers.</SheetDescription>
          </SheetHeader>
          <ChatBody />
        </SheetContent>
      </Sheet>
    </>
  );
}
