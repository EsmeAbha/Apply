import type { Opportunity, Prisma } from "@prisma/client";
import { augmentWithAI } from "../ai/aiExtract.js";
import { fetcher } from "../crawler/fetcher.js";
import { prisma } from "../db.js";
import { formatMoney } from "../extraction/common.js";
import { daysUntil, urgencyFor } from "../extraction/dates.js";
import { extractOpportunity } from "../extraction/index.js";
import { classifySource, hostOf, normalizeUrl, registrableDomain } from "../extraction/source.js";
import { htmlToPageText } from "../extraction/text.js";
import type { ExtractionResult, Fact } from "../extraction/types.js";
import { HttpError } from "../http.js";
import {
  applyField,
  computeStatus,
  diffExtractions,
  feeStatusOf,
  labelFor,
  mergeSource,
  verificationStatusOf,
  type FieldDiff,
} from "./snapshot.js";

export async function knownUniversityDomains(): Promise<string[]> {
  const unis = await prisma.university.findMany({ where: { domain: { not: null } }, select: { domain: true } });
  return unis.map((u) => u.domain!).filter(Boolean);
}

async function universityForHost(host: string): Promise<{ name: string } | null> {
  const reg = registrableDomain(host);
  return prisma.university.findFirst({ where: { domain: reg }, select: { name: true } });
}

export interface AnalyzeResult {
  ok: boolean;
  extraction?: ExtractionResult;
  error?: string;
  fetchStatus?: string;
  ai?: { accepted: string[]; rejected: string[] };
}

/** Analyse HTML the user already has (e.g. sent by the browser extension). */
export async function analyzeHtml(html: string, url: string, opts: { useAI?: boolean } = {}): Promise<AnalyzeResult> {
  const host = hostOf(url);
  const uni = host ? await universityForHost(host) : null;
  let extraction = extractOpportunity(html, url, {
    knownUniversityDomains: await knownUniversityDomains(),
    knownUniversityName: uni?.name,
  });
  let ai: AnalyzeResult["ai"];
  if (opts.useAI !== false) {
    const res = await augmentWithAI(extraction, htmlToPageText(html, url).fullText);
    extraction = res.extraction;
    if (res.accepted.length || res.rejected.length) ai = { accepted: res.accepted, rejected: res.rejected };
  }
  return { ok: true, extraction, ai };
}

/** Fetch (robots.txt-respecting) and analyse a URL. Failure is reported, never papered over. */
export async function analyzeUrl(url: string, opts: { useAI?: boolean; sourceId?: string } = {}): Promise<AnalyzeResult> {
  const res = await fetcher.fetch(url);
  if (res.status !== "OK" || !res.body) {
    await prisma.crawlResult.create({
      data: { url, status: res.status, httpStatus: res.httpStatus, error: res.error, sourceId: opts.sourceId },
    });
    return { ok: false, error: res.error ?? "Crawl failed", fetchStatus: res.status };
  }
  const out = await analyzeHtml(res.body, res.finalUrl || url, opts);
  await prisma.crawlResult.create({
    data: {
      url,
      status: "OK",
      httpStatus: res.httpStatus,
      contentHash: out.extraction!.contentHash,
      title: out.extraction!.pageTitle,
      extracted: out.extraction as unknown as Prisma.InputJsonValue,
      isCandidate: out.extraction!.isLikelyOpportunity,
      sourceId: opts.sourceId,
    },
  });
  return { ...out, fetchStatus: "OK" };
}

async function upsertUniversity(ex: ExtractionResult): Promise<string | null> {
  const name = ex.university.value;
  if (!name) return null;
  const country = ex.country.value ?? null;
  const official = ex.sourceType === "OFFICIAL_UNIVERSITY";
  const domain = official ? registrableDomain(hostOf(ex.url)) : null;
  const existing = await prisma.university.findFirst({ where: { name, country } });
  if (existing) {
    if (!existing.domain && domain) await prisma.university.update({ where: { id: existing.id }, data: { domain } });
    return existing.id;
  }
  const created = await prisma.university.create({ data: { name, country, domain, website: official ? new URL(ex.url).origin : null } });
  return created.id;
}

/** Materialise the normalised tables (deadlines, requirements, funding, summary columns) from the accepted extraction. */
export async function syncOpportunityTables(opportunityId: string, ex: ExtractionResult, timeZone = "UTC"): Promise<Opportunity> {
  const st = computeStatus(ex, new Date(), timeZone);
  const universityId = await upsertUniversity(ex);
  let programId: string | null = null;
  if (universityId && ex.title.value && ex.positionType.value === "PHD_PROGRAM") {
    const p = await prisma.program.upsert({
      where: { universityId_name: { universityId, name: ex.title.value } },
      update: { department: ex.department.value ?? undefined },
      create: { universityId, name: ex.title.value, department: ex.department.value },
    });
    programId = p.id;
  }

  const firstEv = (f: Fact<unknown>) => f.evidence[0];
  await prisma.$transaction([
    prisma.deadline.deleteMany({ where: { opportunityId } }),
    prisma.requirement.deleteMany({ where: { opportunityId } }),
    prisma.funding.deleteMany({ where: { opportunityId } }),
    prisma.deadline.createMany({
      data: ex.deadlines.map((d) => ({
        opportunityId,
        kind: d.kind,
        date: d.date ? new Date(`${d.date}T00:00:00Z`) : null,
        dateText: d.dateText,
        time: d.time,
        timezone: d.timezone,
        round: d.round,
        rolling: d.rolling,
        yearInferred: d.yearInferred,
        certainty: d.certainty,
        confidence: d.confidence,
        snippet: d.evidence[0]?.snippet ?? "",
        sourceUrl: d.evidence[0]?.sourceUrl ?? ex.url,
      })),
    }),
    prisma.requirement.createMany({
      data: [
        ...ex.documents.map((d) => ({
          opportunityId,
          category: "DOCUMENT",
          key: d.key,
          label: d.label,
          necessity: d.necessity,
          stage: "APPLICATION",
          details: { format: d.format, maxPages: d.maxPages, maxWords: d.maxWords, maxSizeMb: d.maxSizeMb, count: d.count } as Prisma.InputJsonValue,
          instructions: d.instructions,
          certainty: d.certainty,
          confidence: d.confidence,
          snippet: d.evidence[0]?.snippet ?? "",
          sourceUrl: d.evidence[0]?.sourceUrl ?? ex.url,
        })),
        ...(ex.english.status.value
          ? [{
              opportunityId,
              category: "ENGLISH",
              key: "ENGLISH",
              label: ex.english.summary,
              necessity: ex.english.status.value === "NOT_REQUIRED" ? "NOT_REQUIRED" : ex.english.status.value === "WAIVER_POSSIBLE" ? "CONDITIONAL" : "REQUIRED",
              stage: ex.english.stage.value ?? "UNKNOWN",
              details: { status: ex.english.status.value, tests: ex.english.tests.map((t) => ({ test: t.test, minOverall: t.minOverall, minSection: t.minSection })), waivers: ex.english.waivers.map((w) => w.reason) } as Prisma.InputJsonValue,
              certainty: ex.english.status.certainty,
              confidence: ex.english.status.confidence,
              snippet: firstEv(ex.english.status)?.snippet ?? "",
              sourceUrl: firstEv(ex.english.status)?.sourceUrl ?? ex.url,
            }]
          : []),
        ...(ex.fee.status.value
          ? [{
              opportunityId,
              category: "FEE",
              key: "APPLICATION_FEE",
              label: ex.fee.status.value === "FREE" ? "No application fee" : `Application fee ${ex.fee.amount.value ? formatMoney(ex.fee.amount.value) : "(amount not stated)"}`,
              necessity: ex.fee.status.value === "FREE" ? "NOT_REQUIRED" : "REQUIRED",
              stage: "APPLICATION",
              details: { amount: ex.fee.amount.value, waiver: ex.fee.waiver.value, otherCosts: ex.fee.otherMandatoryCosts.map((c) => c.label) } as Prisma.InputJsonValue,
              certainty: ex.fee.status.certainty,
              confidence: ex.fee.status.confidence,
              snippet: firstEv(ex.fee.status)?.snippet ?? "",
              sourceUrl: firstEv(ex.fee.status)?.sourceUrl ?? ex.url,
            }]
          : []),
        ...(ex.degreeRequirement.value
          ? [{
              opportunityId,
              category: "DEGREE",
              key: "DEGREE",
              label: ex.degreeRequirement.value,
              necessity: "REQUIRED",
              stage: "APPLICATION",
              certainty: ex.degreeRequirement.certainty,
              confidence: ex.degreeRequirement.confidence,
              snippet: firstEv(ex.degreeRequirement)?.snippet ?? "",
              sourceUrl: ex.url,
            }]
          : []),
      ],
    }),
    prisma.funding.create({
      data: {
        opportunityId,
        category: ex.funding.category.value ?? "FUNDING_UNKNOWN",
        tuition: ex.funding.tuition.value ?? "UNKNOWN",
        stipendAmount: ex.funding.stipend.value?.amount,
        stipendCurrency: ex.funding.stipend.value?.currency,
        stipendPeriod: ex.funding.stipend.value?.period,
        stipendText: ex.funding.stipend.value ? formatMoney(ex.funding.stipend.value) : null,
        salaryText: ex.funding.salary.value,
        duration: ex.funding.duration.value,
        benefits: ex.funding.benefits.map((b) => ({ benefit: b.benefit, snippet: b.evidence[0]?.snippet })) as Prisma.InputJsonValue,
        fundingSource: ex.funding.fundingSource.value,
        guaranteed: ex.funding.guaranteed.value ?? "UNKNOWN",
        positions: ex.funding.positions.value,
        evidence: ex.funding.category.evidence as unknown as Prisma.InputJsonValue,
        confidence: ex.funding.category.confidence,
      },
    }),
  ]);

  return prisma.opportunity.update({
    where: { id: opportunityId },
    data: {
      universityId,
      programId,
      title: ex.title.value ?? ex.pageTitle ?? "Untitled opportunity",
      positionType: ex.positionType.value ?? "UNKNOWN",
      universityName: ex.university.value,
      department: ex.department.value,
      country: ex.country.value,
      city: ex.city.value,
      researchAreas: ex.researchAreas,
      summary: ex.summary,
      applyUrl: ex.applyUrl.value,
      sourceType: ex.sourceType,
      status: st.status,
      fundingCategory: ex.funding.category.value ?? "FUNDING_UNKNOWN",
      feeStatus: feeStatusOf(ex),
      feeAmount: ex.fee.amount.value?.amount ?? null,
      feeCurrency: ex.fee.amount.value?.currency ?? null,
      englishStatus: ex.english.status.value ?? "UNKNOWN",
      verificationStatus: verificationStatusOf(ex),
      supervisorRequired: ex.supervisorRequired.value === null ? "UNKNOWN" : ex.supervisorRequired.value ? "YES" : "NO",
      primaryDeadline: st.primaryDeadline ? new Date(`${st.primaryDeadline}T00:00:00Z`) : null,
      extraction: ex as unknown as Prisma.InputJsonValue,
    },
  });
}

async function userTimeZone(userId: string): Promise<string> {
  const p = await prisma.profile.findUnique({ where: { userId }, select: { timezone: true } });
  return p?.timezone ?? "UTC";
}

export interface SaveResult {
  opportunity: Opportunity;
  created: boolean;
  duplicateOf?: string;
  changes: FieldDiff[];
}

/**
 * Save an analysed opportunity. Deduplicates by normalised URL, then by university + title.
 * If it already exists, the new analysis is compared and differences are recorded as PENDING
 * changes — existing information is never silently overwritten.
 */
export async function saveOpportunity(
  userId: string,
  ex: ExtractionResult,
  opts: { saved?: boolean; discoveredVia?: string; isDemo?: boolean } = {},
): Promise<SaveResult> {
  const normalizedUrl = ex.normalizedUrl || normalizeUrl(ex.url);
  let existing = await prisma.opportunity.findUnique({ where: { userId_normalizedUrl: { userId, normalizedUrl } } });
  if (!existing && ex.university.value && ex.title.value) {
    existing = await prisma.opportunity.findFirst({
      where: { userId, universityName: ex.university.value, title: ex.title.value },
    });
  }
  if (existing) {
    const current = existing.extraction as unknown as ExtractionResult;
    const changes = await recordChanges(existing.id, userId, current, ex);
    if (opts.saved && !existing.saved) existing = await prisma.opportunity.update({ where: { id: existing.id }, data: { saved: true } });
    await prisma.opportunity.update({ where: { id: existing.id }, data: { lastVerifiedAt: new Date(), contentHash: ex.contentHash } });
    return { opportunity: existing, created: false, duplicateOf: existing.id, changes };
  }

  const opp = await prisma.opportunity.create({
    data: {
      userId,
      title: ex.title.value ?? ex.pageTitle ?? "Untitled opportunity",
      officialUrl: ex.url,
      normalizedUrl,
      sourceType: ex.sourceType,
      saved: opts.saved ?? true,
      isDemo: opts.isDemo ?? false,
      discoveredVia: opts.discoveredVia ?? "MANUAL",
      contentHash: ex.contentHash,
      lastVerifiedAt: new Date(),
      extraction: ex as unknown as Prisma.InputJsonValue,
    },
  });
  await prisma.source.create({
    data: { opportunityId: opp.id, url: ex.url, title: ex.pageTitle, sourceType: ex.sourceType, contentHash: ex.contentHash, accessedAt: new Date(ex.accessedAt) },
  });
  const synced = await syncOpportunityTables(opp.id, ex, await userTimeZone(userId));
  return { opportunity: synced, created: true, changes: [] };
}

/** Compare a fresh analysis with the accepted one and log differences as pending changes + notifications. */
export async function recordChanges(opportunityId: string, userId: string, current: ExtractionResult, incoming: ExtractionResult): Promise<FieldDiff[]> {
  if (current.contentHash === incoming.contentHash) return [];
  const diffs = diffExtractions(current, incoming);
  for (const d of diffs) {
    const pending = await prisma.changeLog.findFirst({ where: { opportunityId, field: d.key, status: "PENDING", newValue: d.newValue } });
    if (pending) continue;
    await prisma.changeLog.create({
      data: {
        opportunityId,
        field: d.key,
        label: d.label,
        oldValue: d.oldValue || "(not stated)",
        newValue: d.newValue || "(no longer stated)",
        sourceUrl: incoming.url,
        snippet: d.evidence[0]?.snippet,
      },
    });
    await prisma.notification.upsert({
      where: { userId_dedupeKey: { userId, dedupeKey: `change:${opportunityId}:${d.key}:${d.newValue}` } },
      update: {},
      create: {
        userId,
        opportunityId,
        type: "CHANGE_DETECTED",
        severity: d.key.startsWith("deadline") || d.key === "positionStatus" ? "CRITICAL" : "WARNING",
        title: `CHANGE DETECTED: ${d.label}`,
        body: `Old: ${d.oldValue || "(not stated)"} → New: ${d.newValue || "(no longer stated)"}. Source: ${incoming.url}`,
        link: `/opportunities/${opportunityId}`,
        dedupeKey: `change:${opportunityId}:${d.key}:${d.newValue}`,
      },
    });
  }
  return diffs;
}

/** Re-verify a saved opportunity against its official source. */
export async function verifyOpportunity(userId: string, opportunityId: string): Promise<{ ok: boolean; error?: string; changes: FieldDiff[]; unchanged: boolean }> {
  const opp = await prisma.opportunity.findFirst({ where: { id: opportunityId, userId }, include: { sources: true } });
  if (!opp) throw new HttpError(404, "Opportunity not found");
  const source = opp.sources.find((s) => s.url === opp.officialUrl) ?? opp.sources[0];
  const res = await analyzeUrl(opp.officialUrl, { sourceId: source?.id, useAI: false });
  if (!res.ok || !res.extraction) {
    await prisma.notification.upsert({
      where: { userId_dedupeKey: { userId, dedupeKey: `crawlfail:${opportunityId}:${new Date().toISOString().slice(0, 10)}` } },
      update: {},
      create: {
        userId,
        opportunityId,
        type: "CRAWL_FAILED",
        severity: "WARNING",
        title: `Could not re-check: ${opp.title}`,
        body: `Crawl failed. Reason: ${res.error}. Stored information was NOT changed.`,
        link: `/opportunities/${opportunityId}`,
        dedupeKey: `crawlfail:${opportunityId}:${new Date().toISOString().slice(0, 10)}`,
      },
    });
    return { ok: false, error: res.error, changes: [], unchanged: true };
  }
  const current = opp.extraction as unknown as ExtractionResult;
  const changes = await recordChanges(opp.id, userId, current, res.extraction);
  await prisma.opportunity.update({ where: { id: opp.id }, data: { lastVerifiedAt: new Date(), contentHash: res.extraction.contentHash } });
  if (source) await prisma.source.update({ where: { id: source.id }, data: { lastVerifiedAt: new Date(), contentHash: res.extraction.contentHash } });
  // Refresh the time-dependent status (deadlines passing) without touching any facts.
  const st = computeStatus(current, new Date(), await userTimeZone(userId));
  await prisma.opportunity.update({ where: { id: opp.id }, data: { status: st.status } });
  return { ok: true, changes, unchanged: changes.length === 0 };
}

/** User accepts a detected change: apply only that field from the latest crawl of the source. */
export async function resolveChange(userId: string, changeId: string, action: "ACCEPT" | "DISMISS"): Promise<void> {
  const change = await prisma.changeLog.findUnique({ where: { id: changeId }, include: { opportunity: true } });
  if (!change || change.opportunity.userId !== userId) throw new HttpError(404, "Change not found");
  if (change.status !== "PENDING") throw new HttpError(409, "Change already resolved");
  if (action === "ACCEPT") {
    const latest = await prisma.crawlResult.findFirst({
      where: { url: change.sourceUrl, status: "OK", extracted: { not: undefined } },
      orderBy: { fetchedAt: "desc" },
    });
    const pendingExtraction = (latest?.extracted ?? null) as unknown as ExtractionResult | null;
    if (!pendingExtraction) throw new HttpError(409, "The analysed page for this change is no longer available. Re-verify the opportunity.");
    const next = applyField(change.opportunity.extraction as unknown as ExtractionResult, pendingExtraction, change.field);
    await syncOpportunityTables(change.opportunityId, next, await userTimeZone(userId));
  }
  await prisma.changeLog.update({ where: { id: changeId }, data: { status: action === "ACCEPT" ? "ACCEPTED" : "DISMISSED", resolvedAt: new Date() } });
}

/** Attach another source page (e.g. graduate admissions page) and merge without overwriting known facts. */
export async function addSource(userId: string, opportunityId: string, ex: ExtractionResult) {
  const opp = await prisma.opportunity.findFirst({ where: { id: opportunityId, userId } });
  if (!opp) throw new HttpError(404, "Opportunity not found");
  const { merged, filled, conflicts } = mergeSource(opp.extraction as unknown as ExtractionResult, ex);
  await prisma.source.create({ data: { opportunityId, url: ex.url, title: ex.pageTitle, sourceType: ex.sourceType, contentHash: ex.contentHash } });
  await syncOpportunityTables(opportunityId, merged, await userTimeZone(userId));
  return { filled, conflicts };
}

const EDITABLE_FIELDS = ["deadline.APPLICATION", "deadline.FUNDING", "funding.category", "funding.stipendText", "fee.status", "english.status", "applyUrl", "title", "university", "country"] as const;
export type EditableField = (typeof EDITABLE_FIELDS)[number];
export const isEditableField = (f: string): f is EditableField => (EDITABLE_FIELDS as readonly string[]).includes(f);

/** Manual correction by the user. Stored as USER_ENTERED evidence, never mixed up with source facts. */
export async function setUserFact(userId: string, opportunityId: string, field: EditableField, value: string, note?: string) {
  const opp = await prisma.opportunity.findFirst({ where: { id: opportunityId, userId } });
  if (!opp) throw new HttpError(404, "Opportunity not found");
  const ex = structuredClone(opp.extraction as unknown as ExtractionResult);
  const ev = [{ sourceUrl: "user", sourceType: "USER_ENTERED" as const, snippet: note ? `Entered by you: ${note}` : "Entered by you", accessedAt: new Date().toISOString(), method: "USER" as const }];
  const userFact = <T>(v: T): Fact<T> => ({ value: v, confidence: "HIGH", certainty: "USER_ENTERED", evidence: ev, note });
  switch (field) {
    case "deadline.APPLICATION":
    case "deadline.FUNDING": {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) throw new HttpError(400, "Date must be YYYY-MM-DD");
      const kind = field.slice(9) as "APPLICATION" | "FUNDING";
      ex.deadlines = [...ex.deadlines.filter((d) => d.kind !== kind), { kind, date: value, dateText: value, rolling: false, yearInferred: false, confidence: "HIGH", certainty: "USER_ENTERED", evidence: ev, note }];
      ex.conflicts = ex.conflicts.filter((c) => c.field !== field);
      break;
    }
    case "funding.category": ex.funding.category = userFact(value as never); break;
    case "funding.stipendText": ex.funding.salary = userFact(value); break;
    case "fee.status": ex.fee.status = userFact(value as never); break;
    case "english.status": ex.english.status = userFact(value as never); ex.english.summary = `${value.replace(/_/g, " ")} (entered by you)`; break;
    case "applyUrl": ex.applyUrl = userFact(value); break;
    case "title": ex.title = userFact(value); break;
    case "university": ex.university = userFact(value); break;
    case "country": ex.country = userFact(value); break;
  }
  return syncOpportunityTables(opportunityId, ex, await userTimeZone(userId));
}

type OpportunityWithRelations = Prisma.OpportunityGetPayload<{
  include: { funding: true; deadlines: true; requirements: true; sources: true; applications: true; changes: true; supervisors: true };
}>;

/** API representation with live-computed status, days remaining and urgency in the user's timezone. */
export function serializeOpportunity(o: Opportunity | OpportunityWithRelations, timeZone = "UTC", full = false) {
  const ex = o.extraction as unknown as ExtractionResult;
  const st = computeStatus(ex, new Date(), timeZone);
  const days = st.primaryDeadline ? daysUntil(st.primaryDeadline, new Date(), timeZone) : null;
  const base = {
    id: o.id,
    title: o.title,
    universityName: o.universityName,
    department: o.department,
    country: o.country,
    city: o.city,
    positionType: o.positionType,
    researchAreas: o.researchAreas as string[],
    officialUrl: o.officialUrl,
    applyUrl: o.applyUrl,
    sourceType: o.sourceType,
    sourceLabel: classifySource(o.officialUrl).reason,
    status: st.status,
    fundingCategory: o.fundingCategory,
    tuition: ex.funding.tuition.value ?? "UNKNOWN",
    stipend: ex.funding.stipend.value ? formatMoney(ex.funding.stipend.value) : null,
    salary: ex.funding.salary.value,
    feeStatus: o.feeStatus,
    feeAmount: o.feeAmount,
    feeCurrency: o.feeCurrency,
    feeWaiver: ex.fee.waiver.value,
    otherMandatoryCosts: ex.fee.otherMandatoryCosts.map((c) => c.label),
    englishStatus: o.englishStatus,
    englishSummary: ex.english.summary,
    englishWaiverPossible: ex.english.waivers.length > 0,
    verificationStatus: o.verificationStatus,
    supervisorRequired: o.supervisorRequired,
    primaryDeadline: st.primaryDeadline,
    daysRemaining: days,
    urgency: urgencyFor(days),
    rolling: !!ex.rolling.value,
    requiredDocuments: ex.documents.filter((d) => d.necessity === "REQUIRED").map((d) => ({ key: d.key, label: d.label })),
    saved: o.saved,
    shortlisted: o.shortlisted,
    archived: o.archived,
    isDemo: o.isDemo,
    discoveredVia: o.discoveredVia,
    lastVerifiedAt: o.lastVerifiedAt,
    createdAt: o.createdAt,
    conflictCount: ex.conflicts.length,
    applicationId: "applications" in o && o.applications.length ? o.applications[0].id : null,
    applicationStage: "applications" in o && o.applications.length ? o.applications[0].stage : null,
    pendingChanges: "changes" in o ? o.changes.filter((c) => c.status === "PENDING").length : undefined,
  };
  if (!full) return base;
  const r = o as OpportunityWithRelations;
  return {
    ...base,
    extraction: ex,
    sources: r.sources,
    changes: r.changes.sort((a, b) => b.detectedAt.getTime() - a.detectedAt.getTime()),
    supervisors: r.supervisors,
    funding: r.funding,
  };
}

export { labelFor };
