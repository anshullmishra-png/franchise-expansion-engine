import { ToolRuntime, closestIds } from "./tools";
import {
  replyAssumption,
  replyCompare,
  replyList,
  replyNextSteps,
  replyOverview,
  replyPayback,
  replyStoreConflicts,
  replyTerritory,
  replyTraining,
  replyUndo,
  replyUpdate,
  replyWhy,
} from "./replies";

// Rules-only chat (SPEC §8.5): a deterministic intent parser over the same tools the AI uses, so the judge's
// questions and updates still work when Gemini is down, throttled or not configured.

export const FALLBACK_HELP =
  "I can answer “why is APP-007 on hold?”, compare two applicants, summarise a territory or the unfilled slots, and apply updates like “APP-012 has now found a ground-floor space”, “APP-002 has withdrawn” or “TER-03 now has 2 open slots”. Try one of those.";

const ID = /\bAPP-\d{1,4}\b/gi;
const TER = /\bTER-\d{1,3}\b/gi;

/** Accept APP-12 for APP-012 by comparing the numbers. */
function resolve(raw: string, rt: ToolRuntime, kind: "APP" | "TER"): string {
  const upper = raw.toUpperCase();
  const pool = kind === "APP" ? rt.state.input.applications.map((a) => a.id) : rt.state.input.territories.map((t) => t.id);
  if (pool.includes(upper)) return upper;
  const n = Number(upper.split("-")[1]);
  return pool.find((id) => Number(id.split("-")[1]?.replace(/\D.*$/, "")) === n) ?? upper;
}

const num = (s: string | undefined) => (s === undefined ? NaN : Number(s));

export function fallbackChat(message: string, rt: ToolRuntime): string {
  const text = message.trim();
  const apps = [...text.matchAll(ID)].map((m) => resolve(m[0], rt, "APP"));
  const ters = [...text.matchAll(TER)].map((m) => resolve(m[0], rt, "TER"));
  const a = apps[0];
  const whatIf = /\b(what if|what would happen|suppose|imagine|if we|if they)\b/i.test(text) || /^if\b/i.test(text);
  const run = (name: string, args: Record<string, unknown>) => rt.run(name, args);

  if (!text) return FALLBACK_HELP;

  // ---- undo
  if (/\bundo\b|\brevert\b|\broll ?back\b/i.test(text)) return replyUndo(run("undo", {}));

  // ---- updates and what-ifs
  if (a && /\b(withdr(aw|ew|awn)|dropp?(ed)? out|backed out|pulled out|not interested)\b/i.test(text) && !whatIf) {
    const reason = text.match(/\b(?:because|since)\s+(.+)$/i)?.[1];
    return replyUpdate(run("withdraw", { id: a, reason: reason ?? "" }));
  }
  if (a && /\bloan\b/i.test(text) && /(sanction|approv|cleared|come through|disburs)/i.test(text)) {
    const x = run(whatIf ? "what_if" : "apply_update", { changes: [{ target: "application", id: a, field: "addSignal", value: "Bank loan sanctioned" }], sourceText: text });
    return replyUpdate(x, { whatIf });
  }
  const slots = ters[0] ? text.match(/(\d+)\s*(?:open\s*)?slots?/i) ?? text.match(/slots?\D{0,20}(\d+)/i) : null;
  if (ters[0] && slots && /\b(now|has|have|set|change|make|increase|decrease|reduce|to)\b/i.test(text) && !/^(who|which|why|how)\b/i.test(text)) {
    const x = whatIf
      ? run("what_if", { changes: [{ target: "territory", id: ters[0], field: "openSlots", value: num(slots[1]) }], sourceText: text })
      : run("update_territory", { id: ters[0], changes: { openSlots: slots[1] }, sourceText: text });
    return replyUpdate(x, { whatIf });
  }
  const catchment = text.match(/tier\s*([123])[^.]*catchment[^.]*?(?:to|=|at)\s*(\d+(?:\.\d+)?)\s*km/i);
  if (catchment) return replyAssumption(run("set_assumption", { key: `catchmentKm.${catchment[1]}`, value: num(catchment[2]) }));
  const approve = text.match(/approv\w*\s*(?:threshold|score)?[^.]*?(?:to|=|at)\s*(\d{2,3})\b/i);
  if (approve && /threshold|score/i.test(text) && !a) return replyAssumption(run("set_assumption", { key: "approveScore", value: num(approve[1]) }));

  if (a) {
    const changes: { target: string; id: string; field: string; value: string | number }[] = [];
    const invest = text.match(/(?:invest\w*|capacity|budget|put in|afford)[^.\d]*?(?:is|of|to|at|actually|only|about|around)?\s*₹?\s*(\d+(?:\.\d+)?)\s*(lakh|lakhs|lac|l\b)?/i);
    if (invest && /(invest|capacity|budget|put in|afford)/i.test(text)) changes.push({ target: "application", id: a, field: "investmentLakh", value: num(invest[1]) });
    const floor = text.match(/\b(ground|upper|first|mall)[- ]?(?:floor|unit)?/i);
    const foundSpace = /(found|got|secured|has now|now has|moved|identified|signed|taken|rented|bought|new (space|shop|unit))/i.test(text);
    if (floor && foundSpace) {
      const f = floor[1].toLowerCase();
      changes.push({ target: "application", id: a, field: "floor", value: f === "ground" ? "Ground" : f === "mall" ? "Mall unit" : "Upper" });
      const cur = rt.state.input.applications.find((x) => x.id === a);
      const eff = rt.current().input.applications.find((x) => x.id === a) ?? cur;
      if (/\bown(ed)?\b/i.test(text)) changes.push({ target: "application", id: a, field: "spaceAvailable", value: "Owned" });
      else if (/\b(rent(ed)?|lease[ds]?)\b/i.test(text)) changes.push({ target: "application", id: a, field: "spaceAvailable", value: "Rented" });
      else if (!eff?.spaceAvailable || eff.spaceAvailable === "Not yet identified") changes.push({ target: "application", id: a, field: "spaceAvailable", value: "Identified (ownership unconfirmed)" });
    } else if (foundSpace && /\b(space|shop|unit|premises|site)\b/i.test(text) && !invest) {
      const eff = rt.current().input.applications.find((x) => x.id === a);
      if (!eff?.spaceAvailable || eff.spaceAvailable === "Not yet identified") changes.push({ target: "application", id: a, field: "spaceAvailable", value: "Identified (ownership unconfirmed)" });
    }
    const size = text.match(/(\d{3,4})\s*(?:sq\.?\s*ft|sqft|square\s*feet|sq ft)/i);
    if (size && (foundSpace || floor || /size|space/i.test(text))) changes.push({ target: "application", id: a, field: "spaceSize", value: num(size[1]) });
    const target = text.match(/target[^.\d]*(\d{1,2})\s*months?/i);
    if (target) changes.push({ target: "application", id: a, field: "targetLaunchMonths", value: num(target[1]) });
    const exp = text.match(/(\d{1,2})\s*years?\s*(?:of\s*)?(?:retail\s*)?experience/i);
    if (exp && !/\bwhy\b/i.test(text)) changes.push({ target: "application", id: a, field: "experienceYears", value: num(exp[1]) });
    if (changes.length && (!/^(why|how|what does|what's|who|which|explain|tell me)\b/i.test(text) || whatIf)) {
      return replyUpdate(run(whatIf ? "what_if" : "apply_update", { changes, sourceText: text }), { whatIf });
    }
  }

  // ---- comparisons
  if (apps.length >= 2 && /\b(compare|vs\.?|versus|beat|over|instead of|and not|rather than|than)\b/i.test(text)) {
    return replyCompare(run("compare", { idA: apps[0], idB: apps[1] }));
  }

  // ---- questions about one applicant
  if (a) {
    const info = run("get_application", { id: a });
    if ((info as { error?: string }).error) return replyWhy(info);
    if (/\btrain/i.test(text)) return replyTraining(info);
    if (/payback|pay back|break.?even/i.test(text)) return replyPayback(info);
    if (/\b(next|need to do|should (they|he|she)|steps?|onboard)\b/i.test(text)) return replyNextSteps(info);
    return replyWhy(info);
  }

  // ---- territories and the big picture
  if (ters[0]) return replyTerritory(run("get_territory", { id: ters[0] }));
  if (/(already has|existing).{0,30}store|same pin|pin.{0,20}(already|store)|two stores/i.test(text)) return replyStoreConflicts(rt.storeConflicts());
  if (/unfilled|free slot|empty slot|open slot|slots?.{0,20}(left|remain|filled)|which territor|overview|summary|how many|at a glance/i.test(text)) return replyOverview(run("get_overview", {}));
  const status = text.match(/\b(approved|conditional|redirect(?:ed)?|waitlist(?:ed)?|on hold|hold|rejected)\b/i);
  if (status && /\b(list|show|who|which|all)\b/i.test(text)) {
    const s = status[1].toLowerCase().replace(/ed$/, "").replace("on ", "").toUpperCase();
    return replyList(run("list_applications", { status: s }));
  }

  // ---- an ID that doesn't exist, mentioned loosely
  const bogus = text.match(/\b(?:APP|TER)-\d+\b/i);
  if (bogus) return `There's nothing called ${bogus[0].toUpperCase()}. Did you mean ${closestIds(bogus[0], rt.state.input.applications.map((x) => x.id)).join(", ")}?`;

  return FALLBACK_HELP;
}
