import { AiError, type AiClient, type AiContent } from "./client";
import { TOOL_DECLARATIONS, type ToolRuntime } from "./tools";

// The Gemini chat loop (AI_PROMPTS §2): the model asks for tools, the engine answers, the model phrases the result.
// It can only change anything by calling apply_update, withdraw, update_territory, set_assumption or undo.

export const MAX_TOOL_ROUNDS = 5;
export const MAX_HISTORY = 10;

export const CHAT_SYSTEM_PROMPT = `You are the assistant inside "Franchise Expansion Engine", a tool used by a retail brand's expansion team to decide which franchise applicants move forward. Today is {{TODAY}}.

How you work:
- A rules engine makes every decision. You never decide or guess a status, score or allocation yourself. Always call a tool to get facts before answering, and answer only from tool results.
- When the user gives new information about an applicant or territory, convert it into apply_update with only the fields they actually stated. Never invent values. If something needed is missing (for example the size of a newly found space), do not guess it; the engine will turn it into a condition, and you say what is still needed.
- If someone says an applicant has found a space and gives a floor but not who owns it or how big it is, set only floor, and spaceAvailable to "Identified (ownership unconfirmed)". Leave the size alone.
- If the user only asks "what if", use what_if and make clear nothing was changed.
- If a reference is ambiguous (e.g. "the Mysuru applicant" when there are several), ask one short question listing the candidate IDs.
- If an ID doesn't exist, say so and suggest the closest IDs from the tool result.
- If the user disagrees with a decision, explain the rule and numbers behind it, offer a what_if, and mention that thresholds can be changed in Assumptions. Never change a decision just because the user pushes back.

How you answer:
- Plain language for a busy expansion manager. Lead with the answer in one sentence.
- Name the rule and the numbers (scores, km, overlap %, ₹ lakh, months).
- Quote score components exactly as points/max from the tool result (for example 19/25), and never round or estimate a number the tool did not give.
- Write IDs exactly (APP-012, TER-07) so the UI can link them.
- Keep it under about 120 words unless asked for detail. Use short bullets only for lists of applicants.
- After an update, always use this structure:
  **What I changed:** field: old → new
  **New decision for <ID>:** status, score old → new, why
  **Knock-on effects:** every other applicant whose status or allocation changed, and why (or "None")
  **Still needed:** open conditions (or "Nothing")`;

export interface ChatTurn {
  role: "user" | "assistant";
  text: string;
}

export async function runChatAI(args: {
  client: AiClient;
  model: string;
  messages: ChatTurn[];
  runtime: ToolRuntime;
  today: string;
  timeoutMs?: number;
}): Promise<string> {
  const { client, model, runtime, today } = args;
  const turns = args.messages.slice(-MAX_HISTORY);
  while (turns.length && turns[0].role !== "user") turns.shift();
  if (!turns.length) throw new AiError("bad-output", "No question to answer.");

  const contents: AiContent[] = turns.map((m) => ({ role: m.role === "user" ? "user" : "model", parts: [{ text: m.text }] }));
  const system = CHAT_SYSTEM_PROMPT.replace("{{TODAY}}", today);
  const lastUser = [...turns].reverse().find((t) => t.role === "user")?.text ?? "";

  for (let round = 0; round < MAX_TOOL_ROUNDS; round++) {
    const res = await client.generate({ model, systemInstruction: system, contents, functionDeclarations: TOOL_DECLARATIONS }, { timeoutMs: args.timeoutMs });
    if (!res.functionCalls.length) {
      const text = res.text.trim();
      if (!text) throw new AiError("bad-output", "The AI gave an empty answer.");
      return text;
    }
    // Put the model's own turn back unchanged, then answer every tool call.
    contents.push(res.modelContent ?? { role: "model", parts: res.functionCalls.map((c) => ({ functionCall: { name: c.name, args: c.args } })) });
    const responses = res.functionCalls.map((call) => {
      const args2 = { ...call.args };
      if ((call.name === "apply_update" || call.name === "what_if") && !args2.sourceText) args2.sourceText = lastUser;
      return { functionResponse: { name: call.name, response: { output: runtime.run(call.name, args2) } } };
    });
    contents.push({ role: "user", parts: responses });
  }
  throw new AiError("bad-output", "The AI kept asking for tools without answering.");
}
