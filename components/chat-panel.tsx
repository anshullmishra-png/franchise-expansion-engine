"use client";

import { useEffect, useRef, useState } from "react";
import { MessageSquareDot, Send, Sparkles, X } from "lucide-react";
import { RichText } from "@/components/rich-text";
import { useStore } from "@/lib/state/store";

export const SUGGESTED_QUESTIONS = [
  "Why is APP-007 on hold?",
  "Who's competing for TER-01?",
  "Which slots are unfilled and why?",
  "APP-012 has now found a ground-floor space",
];

function ChatBody({ open }: { open: boolean }) {
  const s = useStore();
  const [text, setText] = useState("");
  const endRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    endRef.current?.scrollIntoView({ block: "end", behavior: "smooth" });
  }, [s.chat.length, s.chatBusy]);

  // Put the cursor in the box as soon as the panel slides in.
  useEffect(() => {
    if (!open) return;
    const t = setTimeout(() => inputRef.current?.focus({ preventScroll: true }), 220);
    return () => clearTimeout(t);
  }, [open]);

  function send(t: string) {
    const q = t.trim();
    if (!q || s.chatBusy) return;
    setText("");
    void s.sendChat(q);
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex-1 space-y-3 overflow-y-auto px-4 py-4" aria-live="polite">
        {s.chat.length === 0 ? (
          <div className="rise-in">
            <p className="text-[14px] leading-relaxed text-ink-300">
              Ask why an applicant got their decision, compare two applicants, or tell the engine something new. Every answer comes from the rules engine, with the numbers.
            </p>
            <p className="tracky mt-6 mb-2.5 text-[11px] font-bold text-ink-500 uppercase">Try one</p>
            <div className="space-y-2">
              {SUGGESTED_QUESTIONS.map((q) => (
                <button
                  key={q}
                  type="button"
                  disabled={s.chatBusy}
                  onClick={() => send(q)}
                  className="spotlight spotlight-dark press flex w-full items-center gap-3 rounded-xl border border-white/10 bg-white/[.04] px-3.5 py-3 text-left text-[13.5px] text-ink-200 disabled:opacity-50"
                >
                  <Sparkles className="size-4 shrink-0 text-teal-400" aria-hidden />
                  <span className="relative">{q}</span>
                </button>
              ))}
            </div>
          </div>
        ) : (
          s.chat.map((m) => (
            <div key={m.id} className={`rise-in max-w-[94%] rounded-2xl px-4 py-3 text-[13.5px] leading-relaxed ${m.role === "user" ? "ml-auto bg-teal-700 text-white" : "bg-white/[.06] text-ink-100 ring-1 ring-white/10"}`}>
              {m.role === "assistant" ? <RichText text={m.text} /> : m.text}
              {m.role === "assistant" && m.rulesOnly ? <span className="mt-1.5 block text-[11px] text-ink-400">Rules-only answer</span> : null}
            </div>
          ))
        )}
        {s.chatBusy ? (
          <div className="inline-flex items-center gap-2 rounded-2xl bg-white/[.06] px-4 py-3 text-[13px] text-ink-400 ring-1 ring-white/10" role="status">
            <span className="flex gap-1" aria-hidden>
              <span className="size-1.5 animate-bounce rounded-full bg-teal-400 [animation-delay:-0.3s]" />
              <span className="size-1.5 animate-bounce rounded-full bg-teal-400 [animation-delay:-0.15s]" />
              <span className="size-1.5 animate-bounce rounded-full bg-teal-400" />
            </span>
            Checking the engine…
          </div>
        ) : null}
        <div ref={endRef} />
      </div>

      <div className="border-t border-white/10 px-4 py-3.5">
        {s.chat.length > 0 ? (
          <div className="no-scrollbar -mx-1 mb-3 flex gap-1.5 overflow-x-auto px-1 pb-1">
            {SUGGESTED_QUESTIONS.map((q) => (
              <button
                key={q}
                type="button"
                disabled={s.chatBusy}
                onClick={() => send(q)}
                className="press shrink-0 rounded-full border border-white/10 px-3 py-1.5 text-xs text-ink-300 hover:border-teal-500/50 hover:bg-white/5 hover:text-white disabled:opacity-50"
              >
                {q}
              </button>
            ))}
          </div>
        ) : null}
        <form
          className="flex gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            send(text);
          }}
        >
          <input
            ref={inputRef}
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder="Ask about an applicant or territory…"
            aria-label="Message the engine"
            className="field h-11 min-w-0 flex-1 rounded-xl px-3.5 text-[14px]"
          />
          <button type="submit" aria-label="Send" title="Send" disabled={!text.trim() || s.chatBusy} className="submit-btn grid size-11 shrink-0 place-items-center rounded-xl">
            <Send className="size-4" />
          </button>
        </form>
      </div>
    </div>
  );
}

/**
 * The chat is a slide-over from the right. It doesn't dim or block the page, so you can watch decisions change
 * behind it. Open it with the Ask button or Ctrl/Cmd+K; close it with Esc or the X.
 */
export function ChatPanel() {
  const s = useStore();
  const open = s.chatOpen;
  const { setChatOpen } = s;

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setChatOpen(!open);
      } else if (e.key === "Escape" && open) {
        setChatOpen(false);
      }
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open, setChatOpen]);

  return (
    <>
      {!open ? (
        <button
          type="button"
          onClick={() => setChatOpen(true)}
          className="submit-btn press fixed right-5 bottom-5 z-40 flex items-center gap-2.5 rounded-full py-3 pr-4 pl-4 text-[14px] font-bold shadow-pop"
          aria-label="Open chat"
        >
          <MessageSquareDot className="size-[18px]" aria-hidden /> Ask the engine
          <kbd className="ml-1 rounded-md bg-white/15 px-1.5 py-0.5 font-sans text-[11px] font-semibold max-md:hidden">Ctrl K</kbd>
        </button>
      ) : null}

      <aside
        data-open={open}
        aria-label="Ask the engine"
        aria-hidden={!open}
        inert={!open}
        className={`slide-over dark-rail fixed inset-y-0 right-0 z-50 flex w-full flex-col border-l border-ink-800 bg-ink-950 text-ink-100 shadow-pop sm:w-[26rem] ${open ? "translate-x-0" : "invisible translate-x-full"}`}
      >
        <div className="flex items-center gap-3 border-b border-white/10 px-4 py-4">
          <span className="grid size-9 shrink-0 place-items-center rounded-lg bg-teal-700/30 text-teal-300" aria-hidden>
            <MessageSquareDot className="size-[18px]" />
          </span>
          <div className="min-w-0 flex-1">
            <h2 className="tracky text-[12px] font-bold text-white uppercase">Ask the engine</h2>
            <p className="truncate text-xs text-ink-400">Answers come from the rules, with the numbers</p>
          </div>
          <button
            type="button"
            onClick={() => setChatOpen(false)}
            aria-label="Close chat"
            title="Close (Esc)"
            className="press grid size-9 shrink-0 place-items-center rounded-lg text-ink-300 hover:bg-white/10 hover:text-white"
          >
            <X className="size-[18px]" />
          </button>
        </div>
        <ChatBody open={open} />
      </aside>
    </>
  );
}
