export const human = (s?: string | null) => (s ? s.replace(/_/g, " ").toLowerCase().replace(/^\w/, (c) => c.toUpperCase()) : "Unknown");
export const upper = (s?: string | null) => (s ? s.replace(/_/g, " ") : "UNKNOWN");

export function fmtDate(iso?: string | null, opts: Intl.DateTimeFormatOptions = { day: "numeric", month: "short", year: "numeric" }): string {
  if (!iso) return "UNKNOWN";
  const d = new Date(iso.length === 10 ? `${iso}T12:00:00Z` : iso);
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleDateString("en-GB", opts);
}

export function fmtDateTime(iso?: string | null): string {
  if (!iso) return "never";
  return new Date(iso).toLocaleString("en-GB", { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" });
}

export function daysLabel(days: number | null | undefined): string {
  if (days === null || days === undefined) return "Deadline unknown";
  if (days < 0) return `Closed ${-days} day${days === -1 ? "" : "s"} ago`;
  if (days === 0) return "Due TODAY";
  if (days === 1) return "Due tomorrow";
  return `${days} days left`;
}

export function feeLabel(o: { feeStatus: string; feeAmount: number | null; feeCurrency: string | null }): string {
  if (o.feeStatus === "FREE") return "FREE";
  if (o.feeAmount) return `${o.feeCurrency} ${o.feeAmount}${o.feeStatus === "FEE_WAIVER_AVAILABLE" ? " (waiver)" : ""}`;
  if (o.feeStatus === "FEE_REQUIRED" || o.feeStatus === "FEE_WAIVER_AVAILABLE") return `Fee (amount unknown)${o.feeStatus === "FEE_WAIVER_AVAILABLE" ? " · waiver" : ""}`;
  return "UNKNOWN";
}

export function englishShort(status: string): string {
  switch (status) {
    case "REQUIRED_AT_APPLICATION": return "Required at application";
    case "REQUIRED_LATER": return "Not required initially";
    case "NOT_REQUIRED": return "Not required";
    case "WAIVER_POSSIBLE": return "Waiver possible";
    case "REQUIRED_STAGE_UNCLEAR": return "Required · stage unclear";
    case "NEEDS_VERIFICATION": return "Needs verification";
    default: return "Unknown";
  }
}

export const STAGE_LABELS: Record<string, string> = {
  DISCOVERED: "Discovered",
  SHORTLISTED: "Shortlisted",
  REQUIREMENTS_VERIFIED: "Requirements verified",
  DOCUMENTS_PREPARING: "Documents preparing",
  READY_TO_APPLY: "Ready to apply",
  APPLICATION_STARTED: "Application started",
  AWAITING_USER_REVIEW: "Awaiting your review",
  SUBMITTED: "Submitted",
  INTERVIEW: "Interview",
  DECISION: "Decision",
};
