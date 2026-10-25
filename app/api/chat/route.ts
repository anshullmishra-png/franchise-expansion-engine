import { buildContext, failed, ok, readJson } from "@/lib/ai/http";
import { chatBodySchema, explainBodySchema, handleChat, handleExplain } from "@/lib/ai/service";
import { z } from "zod";

export const runtime = "nodejs";
export const maxDuration = 60;

// POST { messages, state } -> the assistant's reply, plus the new state if the user's update changed anything.
// POST { mode: "explain", explanation, decision } -> a plainer rewrite of one explanation.
const body = z.union([chatBodySchema, explainBodySchema.extend({ mode: z.literal("explain") })]);

export async function POST(req: Request) {
  const parsed = await readJson(req, body);
  if (!parsed.ok) return parsed.response;
  try {
    const ctx = buildContext(req);
    if ("mode" in parsed.data) return ok(await handleExplain(parsed.data, ctx));
    return ok(await handleChat(parsed.data, ctx));
  } catch (e) {
    return failed(e);
  }
}
