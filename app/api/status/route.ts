import { getAiConfig } from "@/lib/ai/config";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// GET -> whether an AI key is configured. Never returns the key or the model names.
export async function GET() {
  return new Response(JSON.stringify({ aiConfigured: !!getAiConfig().apiKey }), {
    headers: { "content-type": "application/json", "cache-control": "no-store" },
  });
}
