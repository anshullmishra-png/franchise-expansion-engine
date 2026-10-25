import type { Status } from "../engine/types";

export const STATUS_LABEL: Record<Status, string> = {
  APPROVED: "Approved",
  CONDITIONAL: "Conditional",
  REDIRECT: "Redirect",
  WAITLIST: "Waitlist",
  HOLD: "Hold",
  REJECTED: "Rejected",
};
