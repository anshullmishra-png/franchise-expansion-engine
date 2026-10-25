import { formatDate, pinLabel } from "./reference";
import type { Decision, Language } from "./types";

// A plain English message to the applicant, built from the Decision record (SPEC §7). This is the
// deterministic fallback; the AI route rewrites it in Kannada or Hindi when it is available.

export interface MessageDraft {
  language: Language;
  message: string;
  englishVersion: string;
  /** False when the text is still English because translation isn't available. */
  translated: boolean;
  note?: string;
}

const firstName = (name: string | null, id: string) => (name ? name.trim().split(/\s+/)[0] : id);
const firstSentence = (s: string) => (s.match(/^.*?[.!?](?=\s|$)/)?.[0] ?? s).trim();

export function englishMessage(d: Decision): string {
  const hi = `Dear ${firstName(d.name, d.id)},`;
  const sign = "Warm regards,\nExpansion Team";
  const where = d.allocation ? pinLabel(d.allocation.pin) + ", " + d.allocation.territoryId : "";

  switch (d.status) {
    case "APPROVED":
    case "CONDITIONAL":
    case "REDIRECT": {
      const lead =
        d.status === "APPROVED"
          ? `Congratulations! Your franchise application is approved for ${where}.`
          : d.status === "CONDITIONAL"
            ? `Congratulations! Your application is conditionally approved for ${where}.`
            : `Congratulations! Your application is approved at a different location: ${where}. We are holding the slot for you${d.allocation?.slotReservedUntil ? ` until ${formatDate(d.allocation.slotReservedUntil)}` : ""} while you find a site there.`;
      const steps = (d.nextSteps ?? []).slice(0, 3).map((s) => `- ${s.text.replace(/\.$/, "")} (by ${formatDate(s.due)})`);
      const conds = (d.conditions ?? []).filter((c) => c.code !== "SITE_AT_NEW_PIN").slice(0, 3).map((c) => `- ${c.text.replace(/\.$/, "")} (by ${formatDate(c.deadline)})`);
      const t = d.readinessPlan?.training;
      const train = t ? `Your training is ${t.totalDays} days in ${t.language}${t.shadowing ? `, including time at ${t.shadowing.storeId}` : ""}.` : "";
      return [hi, "", lead, steps.length ? `\nYour next steps:\n${steps.join("\n")}` : "", conds.length ? `\nPlease close these before opening:\n${conds.join("\n")}` : "", train ? `\n${train}` : "", "", sign]
        .filter((x) => x !== "")
        .join("\n")
        .replace(/\n{3,}/g, "\n\n");
    }
    case "HOLD": {
      const qs = (d.questionsForApplicant ?? []).slice(0, 4).map((q) => `- ${q}`);
      return [hi, "", "Thank you for applying. Before we can decide, we need a few details from you:", ...qs, "", "Please reply with these and we will take it forward quickly.", "", sign].join("\n");
    }
    case "WAITLIST": {
      const rank = d.waitlistRank ? ` You are #${d.waitlistRank.rank} for ${d.waitlistRank.territoryId}.` : "";
      const why = d.whatWouldChange ? ` ${firstSentence(d.whatWouldChange)}` : "";
      return [hi, "", `Thank you for applying. We are not able to confirm a store for you right now, so you are on our waitlist.${rank}${why}`, "", "We will contact you as soon as a place opens up.", "", sign].join("\n");
    }
    case "REJECTED": {
      if (d.withdrawn !== undefined) return [hi, "", "We have noted that you have withdrawn your application. Thank you for your interest, and you are welcome to apply again in future.", "", sign].join("\n");
      const how = d.whatWouldChange ? ` ${firstSentence(d.whatWouldChange)}` : "";
      return [hi, "", `Thank you for applying. We cannot go ahead with the application as it stands, because the investment is below the minimum we need for a store.${how}`, "", "We would be glad to look at it again if that changes.", "", sign].join("\n");
    }
  }
}

export function draftMessage(d: Decision, language: Language): MessageDraft {
  const english = englishMessage(d);
  return {
    language,
    message: english,
    englishVersion: english,
    translated: language === "English",
    note: language === "English" ? undefined : "Translation unavailable right now, so this is the English version.",
  };
}
