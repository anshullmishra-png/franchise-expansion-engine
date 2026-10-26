import * as XLSX from "xlsx";
import { formatDate, getPin, pinLabel } from "./engine/reference";
import type { Decision, EngineResult, ScoreKey } from "./engine/types";

// Export to Excel (SPEC §9): a decisions sheet (one row per applicant) and a territories sheet.

const STATUS_WORD: Record<Decision["status"], string> = {
  APPROVED: "Approved",
  CONDITIONAL: "Conditional",
  REDIRECT: "Redirect",
  WAITLIST: "Waitlist",
  HOLD: "Hold",
  REJECTED: "Rejected",
};

const pts = (d: Decision, k: ScoreKey) => d.breakdown.find((c) => c.key === k)?.points ?? "";

export function decisionRows(result: EngineResult) {
  return result.decisions.map((d) => {
    const app = result.input.applications.find((a) => a.id === d.id);
    const al = d.allocation;
    return {
      "Application ID": d.id,
      "Applicant name": d.name ?? "",
      "City": d.city ?? "",
      "Pin applied for": d.pin ?? "",
      "Area applied for": d.pin ? (getPin(d.pin)?.area ?? "") : "",
      "Preferred language": app?.language ?? "",
      "Status": STATUS_WORD[d.status],
      "Headline": d.headline,
      "Score (of 100)": d.score ?? "",
      "Financial readiness (of 25)": pts(d, "financial"),
      "Operator experience (of 20)": pts(d, "experience"),
      "Site readiness (of 20)": pts(d, "site"),
      "Location fit (of 20)": pts(d, "location"),
      "Launch readiness (of 10)": pts(d, "launch"),
      "AI-read signals (+/-5)": pts(d, "signals"),
      "Territory": al?.territoryId ?? d.ownTerritoryId ?? "",
      "Allocated pin": al?.pin ?? "",
      "Allocated area": al?.area ?? "",
      "Redirected from": al?.redirectedFrom ? pinLabel(al.redirectedFrom.pin) : "",
      "Waitlist position": d.waitlistRank ? `#${d.waitlistRank.rank} of ${d.waitlistRank.of} for ${d.waitlistRank.territoryId}` : "",
      "Payback (months)": d.payback && Number.isFinite(d.payback.months) ? Math.round(d.payback.months) : "",
      "Planned opening": d.plannedOpenDate ? formatDate(d.plannedOpenDate) : "",
      "Why": d.why,
      "Reasons": d.reasons.map((r) => r.text).join(" | "),
      "Conditions": (d.conditions ?? []).map((c) => `${c.text} (by ${formatDate(c.deadline)})`).join(" | "),
      "Questions for applicant": (d.questionsForApplicant ?? []).join(" | "),
      "What would change it": d.whatWouldChange ?? "",
      "Next steps": (d.nextSteps ?? []).map((s) => `${formatDate(s.due)} [${s.owner}] ${s.text}`).join(" | "),
      "Training": d.readinessPlan
        ? `${d.readinessPlan.training.track}, ${d.readinessPlan.training.language}, ${d.readinessPlan.training.totalDays} days${d.readinessPlan.training.shadowing ? `; ${d.readinessPlan.training.shadowing.text}` : ""}`
        : "",
      "Confidence": d.confidence,
    };
  });
}

export function territoryRows(result: EngineResult) {
  return result.territories.map((t) => ({
    "Territory ID": t.id,
    "City": t.city ?? "",
    "Tier": t.tier ? `Tier ${t.tier}` : "",
    "Priority": t.priority ?? "",
    "Open slots": t.openSlots,
    "Filled": t.allocated.length,
    "Free": t.freeSlots,
    "Allocated applicants": t.allocated.join(", "),
    "Waitlist (in order)": t.waitlist.join(", "),
    "Pins still viable": t.viablePins.map(pinLabel).join(", "),
    "Why slots are unfilled": t.insight?.reasons.join(" ") ?? "",
    "Data flags": t.flags.filter((f) => f.severity !== "info").map((f) => f.message).join(" | "),
  }));
}

/** The "what would change it" column re-runs the whole engine for every applicant who isn't moving forward, which grows very fast (about 4 s at 200 applicants, minutes at 1000). Above this size the export leaves it blank. */
export const EXPORT_SIMULATE_MAX = 120;
export const WHAT_WOULD_CHANGE_SKIPPED = `The "What would change it" column is left blank in exports of more than ${EXPORT_SIMULATE_MAX} applicants. Open an applicant in the app to see what would change their decision.`;

export function buildExportWorkbook(result: EngineResult, opts: { whatWouldChangeSkipped?: boolean } = {}): XLSX.WorkBook {
  const wb = XLSX.utils.book_new();
  const decisions = XLSX.utils.json_to_sheet(decisionRows(result));
  decisions["!cols"] = [{ wch: 12 }, { wch: 22 }, { wch: 16 }, { wch: 10 }, { wch: 22 }, { wch: 10 }, { wch: 12 }, { wch: 50 }, ...Array(10).fill({ wch: 12 }), { wch: 90 }];
  const territories = XLSX.utils.json_to_sheet(territoryRows(result));
  XLSX.utils.book_append_sheet(wb, decisions, "Decisions");
  XLSX.utils.book_append_sheet(wb, territories, "Territories");
  if (opts.whatWouldChangeSkipped) XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([["Note"], [WHAT_WOULD_CHANGE_SKIPPED]]), "Notes");
  return wb;
}

export function exportToBytes(result: EngineResult, opts: { whatWouldChangeSkipped?: boolean } = {}): Uint8Array {
  return new Uint8Array(XLSX.write(buildExportWorkbook(result, opts), { type: "array", bookType: "xlsx" }) as ArrayBuffer);
}

export const EXPORT_FILE_NAME = "franchise-expansion-decisions.xlsx";

/** Browser only: build the workbook and start the download. Returns the blob URL so the page can offer a manual link if the browser blocks the automatic download. */
export function downloadExport(result: EngineResult, opts: { whatWouldChangeSkipped?: boolean } = {}, fileName = EXPORT_FILE_NAME): string {
  const bytes = exportToBytes(result, opts);
  const blob = new Blob([bytes.buffer as ArrayBuffer], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = fileName;
  document.body.appendChild(a);
  a.click();
  a.remove();
  return url;
}
