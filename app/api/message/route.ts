import { buildContext, failed, ok, readJson } from "@/lib/ai/http";
import { handleMessage, messageBodySchema } from "@/lib/ai/service";

export const runtime = "nodejs";
export const maxDuration = 60;

// POST { decision, language } -> a message to the applicant (Kannada or Hindi when the AI is available, otherwise English).
export async function POST(req: Request) {
  const parsed = await readJson(req, messageBodySchema);
  if (!parsed.ok) return parsed.response;
  try {
    return ok(await handleMessage(parsed.data, buildContext(req)));
  } catch (e) {
    return failed(e);
  }
}
