import { formatMoney, type ExtractCtx } from "./common.js";
import { todayInZone } from "./dates.js";
import { extractDeadlines, primaryApplicationDeadline } from "./deadlines.js";
import { extractDocuments } from "./documents.js";
import { extractEnglish } from "./english.js";
import { extractFee } from "./fees.js";
import { extractFunding } from "./funding.js";
import { extractMeta } from "./meta.js";
import { certaintyFor, classifySource, hostOf, normalizeUrl } from "./source.js";
import { htmlToPageText, sha256 } from "./text.js";
import type { DeadlineFact, ExtractionResult, SourceType } from "./types.js";

export interface ExtractOptions {
  referenceDate?: Date;
  knownUniversityDomains?: string[];
  knownUniversityName?: string;
  accessedAt?: Date;
  sourceTypeOverride?: SourceType;
}

/**
 * Deterministic, evidence-backed extraction of a PhD opportunity page.
 * Nothing here guesses: any field without supporting text is returned as UNKNOWN.
 */
export function extractOpportunity(html: string, url: string, opts: ExtractOptions = {}): ExtractionResult {
  const referenceDate = opts.referenceDate ?? new Date();
  const accessedAt = (opts.accessedAt ?? new Date()).toISOString();
  const page = htmlToPageText(html, url);
  const cls = opts.sourceTypeOverride
    ? { type: opts.sourceTypeOverride, reason: "Set explicitly" }
    : classifySource(url, opts.knownUniversityDomains);
  const host = hostOf(url);
  const dayFirst = !/\.(edu|us)$/.test(host) && !/\bUnited States\b/.test(page.fullText.slice(0, 3000));

  const ctx: ExtractCtx = {
    url,
    sourceType: cls.type,
    pageTitle: page.title || page.h1,
    accessedAt,
    referenceDate,
    dayFirst,
  };

  const meta = extractMeta(page, ctx, opts.knownUniversityName);
  const dl = extractDeadlines(page.segments, ctx);
  const funding = extractFunding(page.segments, ctx);
  const fee = extractFee(page.segments, ctx);
  const english = extractEnglish(page.segments, ctx);
  const documents = extractDocuments(page.segments, ctx);
  const warnings = [...dl.warnings];

  // Structured data deadline (JobPosting.validThrough) — used only if the text gives no application deadline.
  const deadlines: DeadlineFact[] = dl.deadlines;
  const vt = meta.jobPosting?.validThrough?.slice(0, 10);
  if (vt && /^\d{4}-\d{2}-\d{2}$/.test(vt)) {
    const hasApp = deadlines.some((d) => d.kind === "APPLICATION");
    if (!hasApp) {
      deadlines.push({
        kind: "APPLICATION",
        date: vt,
        dateText: meta.jobPosting!.validThrough!,
        rolling: false,
        yearInferred: false,
        confidence: "MEDIUM",
        certainty: certaintyFor(cls.type, "MEDIUM"),
        evidence: [{ sourceUrl: url, sourceTitle: ctx.pageTitle, sourceType: cls.type, snippet: `JobPosting validThrough: ${meta.jobPosting!.validThrough}`, accessedAt, method: "STRUCTURED_DATA" }],
        note: "From the page's structured data (validThrough). Confirm it matches the visible deadline.",
      });
    } else if (!deadlines.some((d) => d.kind === "APPLICATION" && d.date === vt)) {
      warnings.push(`Structured data says the posting is valid through ${vt}, which differs from the visible application deadline. Verify manually.`);
    }
  }

  if (cls.type === "THIRD_PARTY") warnings.unshift("THIRD-PARTY SOURCE — use it to find the official university page, then analyse that page. Facts below are unverified.");
  if (cls.type === "UNKNOWN") warnings.unshift("The domain is not a recognised university domain. Confirm this is an official page before relying on it.");
  if (!meta.isLikelyOpportunity) warnings.push("This page does not look like a specific PhD opportunity (few PhD/deadline/apply signals). It may be a listing or general page.");
  if (funding.category.value === null) warnings.push("Funding could not be verified from this page — FUNDING UNKNOWN.");
  if (english.status.value === null || english.status.value === "NEEDS_VERIFICATION" || english.status.value === "REQUIRED_STAGE_UNCLEAR") {
    warnings.push("English-language (IELTS/TOEFL) requirements need manual verification — check the graduate admissions page.");
  }
  if (!deadlines.some((d) => d.kind === "APPLICATION") && !dl.rolling.value) warnings.push("No application deadline found — DEADLINE UNKNOWN.");

  const today = todayInZone(referenceDate, "UTC");
  const primary = primaryApplicationDeadline(deadlines, today);
  const summaryParts = [
    meta.title.value ?? page.title,
    meta.university.value ? `at ${meta.university.value}` : null,
    primary?.date ? `— application deadline ${primary.date}` : "— deadline unknown",
    `— funding: ${(funding.category.value ?? "FUNDING_UNKNOWN").replace(/_/g, " ").toLowerCase()}`,
    funding.stipend.value ? `(${formatMoney(funding.stipend.value)})` : null,
    `— fee: ${fee.status.value === "FREE" ? "no application fee (per source)" : fee.amount.value ? formatMoney(fee.amount.value) : "unknown"}`,
    `— English: ${english.summary}`,
  ].filter(Boolean);

  return {
    url,
    normalizedUrl: normalizeUrl(url),
    pageTitle: page.title || page.h1,
    sourceType: cls.type,
    sourceTypeReason: cls.reason,
    accessedAt,
    contentHash: sha256(page.fullText),
    isLikelyOpportunity: meta.isLikelyOpportunity,
    opportunitySignals: meta.signals,
    title: meta.title,
    university: meta.university,
    department: meta.department,
    country: meta.country,
    city: meta.city,
    positionType: meta.positionType,
    researchAreas: meta.researchAreas,
    applyUrl: meta.applyUrl,
    supervisorRequired: meta.supervisorRequired,
    supervisors: meta.supervisors,
    positionStatus: meta.positionStatus,
    rolling: dl.rolling,
    deadlines,
    funding,
    fee,
    english,
    documents,
    degreeRequirement: meta.degreeRequirement,
    conflicts: dl.conflicts,
    warnings,
    summary: summaryParts.join(" "),
  };
}

export { htmlToPageText } from "./text.js";
export { normalizeUrl, classifySource } from "./source.js";
export type * from "./types.js";
