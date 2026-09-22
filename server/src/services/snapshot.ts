import { formatMoney } from "../extraction/common.js";
import { daysUntil, todayInZone } from "../extraction/dates.js";
import { primaryApplicationDeadline } from "../extraction/deadlines.js";
import type { Conflict, DeadlineKind, Evidence, ExtractionResult } from "../extraction/types.js";

/**
 * Critical fields that are monitored for changes and compared across sources.
 * Values are normalised strings so they can be compared and shown as "Old → New".
 */
export const CRITICAL_FIELDS: { key: string; label: string }[] = [
  { key: "deadline.APPLICATION", label: "Application deadline" },
  { key: "deadline.FUNDING", label: "Funding deadline" },
  { key: "deadline.SCHOLARSHIP", label: "Scholarship deadline" },
  { key: "deadline.SUPERVISOR_CONTACT", label: "Supervisor-contact deadline" },
  { key: "funding.category", label: "Funding" },
  { key: "funding.stipend", label: "Stipend" },
  { key: "funding.salary", label: "Salary" },
  { key: "funding.tuition", label: "Tuition coverage" },
  { key: "fee.status", label: "Application fee status" },
  { key: "fee.amount", label: "Application fee" },
  { key: "english.status", label: "English (IELTS/TOEFL) requirement" },
  { key: "english.tests", label: "English test scores" },
  { key: "documents", label: "Required documents" },
  { key: "applyUrl", label: "Application URL" },
  { key: "positionStatus", label: "Position status" },
];

export function labelFor(key: string): string {
  return CRITICAL_FIELDS.find((f) => f.key === key)?.label ?? key;
}

export function snapshotValue(ex: ExtractionResult, key: string): string {
  if (key.startsWith("deadline.")) {
    const kind = key.slice(9) as DeadlineKind;
    return ex.deadlines
      .filter((d) => d.kind === kind && d.date)
      .map((d) => `${d.date}${d.round ? ` (${d.round})` : ""}`)
      .sort()
      .join("; ");
  }
  switch (key) {
    case "funding.category": return ex.funding.category.value ?? "";
    case "funding.stipend": return ex.funding.stipend.value ? formatMoney(ex.funding.stipend.value) : "";
    case "funding.salary": return ex.funding.salary.value ?? "";
    case "funding.tuition": return ex.funding.tuition.value ?? "";
    case "fee.status": return ex.fee.status.value ?? "";
    case "fee.amount": return ex.fee.amount.value && ex.fee.amount.value.amount > 0 ? formatMoney(ex.fee.amount.value) : "";
    case "english.status": return ex.english.status.value ?? "";
    case "english.tests": return ex.english.tests.filter((t) => t.minOverall !== undefined).map((t) => `${t.test} ${t.minOverall}${t.minSection ? `/${t.minSection}` : ""}`).sort().join("; ");
    case "documents": return ex.documents.filter((d) => d.necessity === "REQUIRED").map((d) => d.key).sort().join(", ");
    case "applyUrl": return ex.applyUrl.value ?? "";
    case "positionStatus": return ex.positionStatus.value ?? "";
    default: return "";
  }
}

export function fieldEvidence(ex: ExtractionResult, key: string): Evidence[] {
  if (key.startsWith("deadline.")) return ex.deadlines.filter((d) => d.kind === key.slice(9)).flatMap((d) => d.evidence).slice(0, 3);
  switch (key) {
    case "funding.category": return ex.funding.category.evidence;
    case "funding.stipend": return ex.funding.stipend.evidence;
    case "funding.salary": return ex.funding.salary.evidence;
    case "funding.tuition": return ex.funding.tuition.evidence;
    case "fee.status": return ex.fee.status.evidence;
    case "fee.amount": return ex.fee.amount.evidence;
    case "english.status": return ex.english.status.evidence;
    case "english.tests": return ex.english.tests.flatMap((t) => t.evidence).slice(0, 2);
    case "documents": return ex.documents.flatMap((d) => d.evidence).slice(0, 3);
    case "applyUrl": return ex.applyUrl.evidence;
    case "positionStatus": return ex.positionStatus.evidence;
    default: return [];
  }
}

export interface FieldDiff {
  key: string;
  label: string;
  oldValue: string;
  newValue: string;
  evidence: Evidence[];
}

export function diffExtractions(current: ExtractionResult, incoming: ExtractionResult): FieldDiff[] {
  const out: FieldDiff[] = [];
  for (const f of CRITICAL_FIELDS) {
    const a = snapshotValue(current, f.key);
    const b = snapshotValue(incoming, f.key);
    if (a !== b) out.push({ key: f.key, label: f.label, oldValue: a, newValue: b, evidence: fieldEvidence(incoming, f.key) });
  }
  return out;
}

/** Copy one critical field from `incoming` into `current` (used when the user accepts a detected change). */
export function applyField(current: ExtractionResult, incoming: ExtractionResult, key: string): ExtractionResult {
  const next: ExtractionResult = structuredClone(current);
  if (key.startsWith("deadline.")) {
    const kind = key.slice(9);
    next.deadlines = [...next.deadlines.filter((d) => d.kind !== kind), ...incoming.deadlines.filter((d) => d.kind === kind)];
    next.conflicts = next.conflicts.filter((c) => c.field !== key);
    return next;
  }
  switch (key) {
    case "funding.category": next.funding.category = incoming.funding.category; break;
    case "funding.stipend": next.funding.stipend = incoming.funding.stipend; break;
    case "funding.salary": next.funding.salary = incoming.funding.salary; break;
    case "funding.tuition": next.funding.tuition = incoming.funding.tuition; break;
    case "fee.status":
    case "fee.amount": next.fee = incoming.fee; break;
    case "english.status":
    case "english.tests": next.english = incoming.english; break;
    case "documents": next.documents = incoming.documents; break;
    case "applyUrl": next.applyUrl = incoming.applyUrl; break;
    case "positionStatus": next.positionStatus = incoming.positionStatus; break;
  }
  next.conflicts = next.conflicts.filter((c) => c.field !== key);
  return next;
}

/**
 * Merge a second source (e.g. the graduate-admissions page) into an opportunity:
 * unknown fields are filled from the new source; fields that disagree become CONFLICTING
 * with both sources shown. Nothing known is overwritten.
 */
export function mergeSource(current: ExtractionResult, incoming: ExtractionResult): { merged: ExtractionResult; filled: string[]; conflicts: Conflict[] } {
  let merged: ExtractionResult = structuredClone(current);
  const filled: string[] = [];
  const conflicts: Conflict[] = [];
  for (const f of CRITICAL_FIELDS) {
    const a = snapshotValue(current, f.key);
    const b = snapshotValue(incoming, f.key);
    if (!b || a === b) continue;
    if (!a) {
      merged = applyField(merged, incoming, f.key);
      filled.push(f.label);
    } else if (f.key !== "applyUrl") {
      conflicts.push({
        field: f.key,
        label: f.label,
        values: [
          { value: a, evidence: fieldEvidence(current, f.key) },
          { value: b, evidence: fieldEvidence(incoming, f.key) },
        ],
        action: "VERIFY_MANUALLY",
      });
    }
  }
  // English waivers / tests from an admissions page enrich the existing English info.
  if (incoming.english.waivers.length && !merged.english.waivers.length) merged.english.waivers = incoming.english.waivers;
  merged.conflicts = [...merged.conflicts.filter((c) => !conflicts.some((n) => n.field === c.field)), ...conflicts];
  if (!merged.supervisors.length && incoming.supervisors.length) merged.supervisors = incoming.supervisors;
  return { merged, filled, conflicts };
}

export type OpportunityStatus = "OPEN" | "OPENING_SOON" | "DEADLINE_APPROACHING" | "CLOSED" | "UNKNOWN";

export function computeStatus(ex: ExtractionResult, now = new Date(), timeZone = "UTC"): { status: OpportunityStatus; primaryDeadline: string | null; daysRemaining: number | null } {
  const today = todayInZone(now, timeZone);
  const primary = primaryApplicationDeadline(ex.deadlines, today);
  const days = primary?.date ? daysUntil(primary.date, now, timeZone) : null;
  if (ex.positionStatus.value === "CLOSED") return { status: "CLOSED", primaryDeadline: primary?.date ?? null, daysRemaining: days };
  const opening = ex.deadlines.find((d) => d.kind === "OPENING" && d.date && d.date > today);
  if (opening) return { status: "OPENING_SOON", primaryDeadline: primary?.date ?? null, daysRemaining: days };
  if (days !== null) {
    if (days < 0) return { status: ex.rolling.value ? "OPEN" : "CLOSED", primaryDeadline: primary!.date, daysRemaining: days };
    if (days <= 14) return { status: "DEADLINE_APPROACHING", primaryDeadline: primary!.date, daysRemaining: days };
    return { status: "OPEN", primaryDeadline: primary!.date, daysRemaining: days };
  }
  if (ex.rolling.value) return { status: "OPEN", primaryDeadline: null, daysRemaining: null };
  return { status: "UNKNOWN", primaryDeadline: null, daysRemaining: null };
}

export function feeStatusOf(ex: ExtractionResult): "FREE" | "FEE_REQUIRED" | "FEE_WAIVER_AVAILABLE" | "UNKNOWN" {
  if (ex.fee.status.value === "FREE") return "FREE";
  if (ex.fee.status.value === "FEE_REQUIRED") return ex.fee.waiver.value === "AVAILABLE" ? "FEE_WAIVER_AVAILABLE" : "FEE_REQUIRED";
  return "UNKNOWN";
}

export function verificationStatusOf(ex: ExtractionResult): "VERIFIED" | "NEEDS_VERIFICATION" | "CONFLICTING" {
  if (ex.conflicts.length) return "CONFLICTING";
  const official = ex.sourceType === "OFFICIAL_UNIVERSITY" || ex.sourceType === "GOVERNMENT";
  const app = ex.deadlines.find((d) => d.kind === "APPLICATION");
  const deadlineOk = !!app && (app.certainty === "VERIFIED" || app.certainty === "USER_ENTERED");
  const fundingOk = ex.funding.category.certainty === "VERIFIED" || ex.funding.category.certainty === "USER_ENTERED";
  return official && deadlineOk && fundingOk ? "VERIFIED" : "NEEDS_VERIFICATION";
}
