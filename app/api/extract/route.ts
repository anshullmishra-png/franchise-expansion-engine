import { buildContext, failed, ok, readJson } from "@/lib/ai/http";
import { extractBodySchema, handleExtract } from "@/lib/ai/service";

export const runtime = "nodejs";
export const maxDuration = 60;

// POST { applications } -> AI-read (or rules-read) signals for every applicant's notes.
export async function POST(req: Request) {
  const parsed = await readJson(req, extractBodySchema);
  if (!parsed.ok) return parsed.response;
  try {
    return ok(await handleExtract(parsed.data, buildContext(req)));
  } catch (e) {
    return failed(e);
  }
}
