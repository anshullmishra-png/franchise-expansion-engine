import { readFileSync } from "node:fs";
import path from "node:path";
import { DEFAULT_ASSUMPTIONS, type Assumptions } from "../../lib/engine";
import { parseWorkbook } from "../../lib/engine/parse";
import { handleChat, type AiContext, type ChatResponse } from "../../lib/ai/service";
import type { AiClient } from "../../lib/ai/client";
import { getAiConfig } from "../../lib/ai/config";
import type { EngineInput, Overrides } from "../../lib/engine/types";
import type { Committed } from "../../lib/ai/tools";

// Drives /api/chat's logic the way the browser does: send the whole state each time, take back the new state.

export const TODAY = "2026-10-25";

export function stressInput(): EngineInput {
  return parseWorkbook(readFileSync(path.join(process.cwd(), "test-data/Stress_Test_Case1.xlsx"))).input;
}

export class ChatSession {
  overrides: Overrides = {};
  assumptions: Assumptions = DEFAULT_ASSUMPTIONS;
  history: { role: "user" | "assistant"; text: string }[] = [];
  log: Committed[] = [];
  last!: ChatResponse;

  constructor(
    public input: EngineInput,
    public ctx: AiContext
  ) {}

  async say(text: string): Promise<string> {
    this.history.push({ role: "user", text });
    const active = this.log.filter((e) => !(e as Committed & { undone?: boolean }).undone);
    const undoTo = active.length ? active[active.length - 1].prev : null;
    this.last = await handleChat(
      {
        messages: this.history,
        state: {
          input: this.input as never,
          overrides: this.overrides as never,
          assumptions: this.assumptions as never,
          readings: [],
          undoTo: undoTo as never,
          today: TODAY,
        },
      },
      this.ctx
    );
    if (this.last.newOverrides) this.overrides = this.last.newOverrides;
    if (this.last.newAssumptions) this.assumptions = this.last.newAssumptions;
    if (this.last.entries) {
      const undid = this.last.entries.some((e) => e.sourceText === "Undid the last change");
      if (undid) {
        const idx = [...this.log].reverse().findIndex((e) => !(e as Committed & { undone?: boolean }).undone);
        if (idx >= 0) (this.log[this.log.length - 1 - idx] as Committed & { undone?: boolean }).undone = true;
      } else this.log.push(...this.last.entries);
    }
    this.history.push({ role: "assistant", text: this.last.reply });
    return this.last.reply;
  }
}

export const rulesOnly = (): AiContext => ({ client: null, config: { ...getAiConfig({}), apiKey: null }, forceFallback: true });

export const withClient = (client: AiClient): AiContext => ({ client, config: { apiKey: "test-key", chatModel: "chat-model", fastModel: "fast-model" } });
