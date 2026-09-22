import type { Prisma } from "@prisma/client";
import { Router } from "express";
import { z } from "zod";
import { uid } from "../auth/middleware.js";
import { prisma } from "../db.js";
import { daysUntil, urgencyFor } from "../extraction/dates.js";
import type { ExtractionResult } from "../extraction/types.js";
import { ah, HttpError } from "../http.js";
import { matchAnalysis } from "../services/matching.js";
import {
  addSource,
  analyzeHtml,
  analyzeUrl,
  isEditableField,
  resolveChange,
  saveOpportunity,
  serializeOpportunity,
  setUserFact,
  verifyOpportunity,
} from "../services/opportunities.js";
import { getProfileBundle } from "../services/profile.js";

export const opportunitiesRouter = Router();

const tz = async (userId: string) => (await prisma.profile.findUnique({ where: { userId }, select: { timezone: true } }))?.timezone ?? "UTC";

const analyzeBody = z.object({
  url: z.string().url(),
  html: z.string().max(5_000_000).optional(),
  useAI: z.boolean().optional(),
});

/** POST /analyze-url — analyse without saving. With `html` (from the extension) no fetch happens. */
opportunitiesRouter.post(
  "/analyze-url",
  ah(async (req, res) => {
    const body = analyzeBody.parse(req.body);
    const result = body.html ? await analyzeHtml(body.html, body.url, { useAI: body.useAI }) : await analyzeUrl(body.url, { useAI: body.useAI });
    if (!result.ok) {
      res.status(422).json({ ok: false, error: `Crawl failed. Reason: ${result.error}`, fetchStatus: result.fetchStatus });
      return;
    }
    const existing = await prisma.opportunity.findUnique({ where: { userId_normalizedUrl: { userId: uid(req), normalizedUrl: result.extraction!.normalizedUrl } }, select: { id: true } });
    const bundle = await getProfileBundle(uid(req));
    res.json({ ok: true, extraction: result.extraction, ai: result.ai, existingId: existing?.id ?? null, match: matchAnalysis(bundle, result.extraction!) });
  }),
);

/** POST /opportunities — save an analysed extraction (or analyse+save a URL). */
opportunitiesRouter.post(
  "/opportunities",
  ah(async (req, res) => {
    const body = z
      .object({ url: z.string().url().optional(), html: z.string().max(5_000_000).optional(), extraction: z.any().optional(), discoveredVia: z.string().optional(), useAI: z.boolean().optional() })
      .parse(req.body);
    let ex: ExtractionResult | undefined;
    if (body.url && body.html) ex = (await analyzeHtml(body.html, body.url, { useAI: body.useAI })).extraction;
    else if (body.url && !body.extraction) {
      const r = await analyzeUrl(body.url, { useAI: body.useAI });
      if (!r.ok) throw new HttpError(422, `Crawl failed. Reason: ${r.error}`);
      ex = r.extraction;
    } else if (body.extraction) {
      // Re-run extraction server-side is not possible without HTML; accept only structurally valid extractions from our own analyzer.
      const e = body.extraction as ExtractionResult;
      if (!e?.url || !e?.contentHash || !e?.funding || !e?.english || !Array.isArray(e?.deadlines)) throw new HttpError(400, "Invalid extraction payload");
      ex = e;
    }
    if (!ex) throw new HttpError(400, "Provide url (optionally with html) or an extraction");
    const saved = await saveOpportunity(uid(req), ex, { saved: true, discoveredVia: body.discoveredVia ?? (body.html ? "EXTENSION" : "MANUAL") });
    res.status(saved.created ? 201 : 200).json({
      opportunity: serializeOpportunity(saved.opportunity, await tz(uid(req))),
      created: saved.created,
      duplicate: !saved.created,
      changesDetected: saved.changes.map((c) => ({ field: c.label, old: c.oldValue, new: c.newValue })),
    });
  }),
);

const listQuery = z.object({
  q: z.string().optional(),
  country: z.string().optional(),
  university: z.string().optional(),
  area: z.string().optional(),
  funding: z.string().optional(),
  fullyFunded: z.coerce.boolean().optional(),
  freeOnly: z.coerce.boolean().optional(),
  fee: z.enum(["FREE", "WAIVER", "ANY"]).optional(),
  english: z.enum(["NOT_REQUIRED_INITIALLY", "WAIVER_POSSIBLE", "REQUIRED_AT_APPLICATION", "NEEDS_VERIFICATION"]).optional(),
  deadlineWithin: z.coerce.number().optional(),
  status: z.string().optional(),
  positionType: z.string().optional(),
  supervisorRequired: z.enum(["YES", "NO", "UNKNOWN"]).optional(),
  saved: z.coerce.boolean().optional(),
  shortlisted: z.coerce.boolean().optional(),
  discovered: z.coerce.boolean().optional(),
  includeClosed: z.coerce.boolean().optional(),
  includeArchived: z.coerce.boolean().optional(),
  verifiedOnly: z.coerce.boolean().optional(),
  sort: z.enum(["deadline", "newest", "funding", "cost", "alignment"]).optional(),
});

const FUNDING_RANK: Record<string, number> = { FULLY_FUNDED: 0, SALARIED_POSITION: 1, PARTIALLY_FUNDED: 2, FUNDING_COMPETITIVE: 3, SCHOLARSHIP_AVAILABLE: 4, FUNDING_UNKNOWN: 5, SELF_FUNDED: 6 };

opportunitiesRouter.get(
  "/opportunities",
  ah(async (req, res) => {
    const q = listQuery.parse(req.query);
    const userId = uid(req);
    const zone = await tz(userId);
    const where: Prisma.OpportunityWhereInput = { userId };
    if (!q.includeArchived) where.archived = false;
    if (q.saved !== undefined) where.saved = q.saved;
    if (q.shortlisted) where.shortlisted = true;
    if (q.discovered) where.saved = false;
    if (q.country) where.country = { contains: q.country };
    if (q.university) where.universityName = { contains: q.university };
    if (q.funding) where.fundingCategory = q.funding;
    if (q.fullyFunded) where.fundingCategory = "FULLY_FUNDED";
    if (q.freeOnly || q.fee === "FREE") where.feeStatus = "FREE";
    if (q.fee === "WAIVER") where.feeStatus = "FEE_WAIVER_AVAILABLE";
    if (q.english === "NOT_REQUIRED_INITIALLY") where.englishStatus = { in: ["REQUIRED_LATER", "NOT_REQUIRED"] };
    if (q.english === "REQUIRED_AT_APPLICATION") where.englishStatus = "REQUIRED_AT_APPLICATION";
    if (q.english === "NEEDS_VERIFICATION") where.englishStatus = { in: ["NEEDS_VERIFICATION", "REQUIRED_STAGE_UNCLEAR", "UNKNOWN"] };
    if (q.positionType) where.positionType = q.positionType;
    if (q.supervisorRequired) where.supervisorRequired = q.supervisorRequired;
    if (q.verifiedOnly) where.verificationStatus = "VERIFIED";
    if (q.q) where.OR = [{ title: { contains: q.q } }, { universityName: { contains: q.q } }, { department: { contains: q.q } }, { summary: { contains: q.q } }];

    const rows = await prisma.opportunity.findMany({ where, include: { applications: true, changes: { where: { status: "PENDING" } } }, orderBy: { createdAt: "desc" } });
    let items = rows.map((r) => serializeOpportunity(r, zone));
    if (!q.includeClosed && !q.status) items = items.filter((i) => i.status !== "CLOSED");
    if (q.status) items = items.filter((i) => q.status!.split(",").includes(i.status));
    if (q.english === "WAIVER_POSSIBLE") items = items.filter((i) => i.englishWaiverPossible || i.englishStatus === "WAIVER_POSSIBLE");
    if (q.area) items = items.filter((i) => i.researchAreas.some((a) => a.toLowerCase().includes(q.area!.toLowerCase())));
    if (q.deadlineWithin !== undefined) items = items.filter((i) => i.daysRemaining !== null && i.daysRemaining >= 0 && i.daysRemaining <= q.deadlineWithin!);

    let alignment: Record<string, string> = {};
    if (q.sort === "alignment" || items.length <= 300) {
      const bundle = await getProfileBundle(userId);
      alignment = Object.fromEntries(rows.map((r) => [r.id, matchAnalysis(bundle, r.extraction as unknown as ExtractionResult).researchAlignment.level]));
    }
    const withAlign = items.map((i) => ({ ...i, researchAlignment: alignment[i.id] ?? "UNKNOWN" }));
    const rankA: Record<string, number> = { HIGH: 0, MEDIUM: 1, LOW: 2, UNKNOWN: 3 };
    const byDeadline = (a: (typeof withAlign)[number], b: (typeof withAlign)[number]) => (a.daysRemaining ?? 1e9) - (b.daysRemaining ?? 1e9);
    switch (q.sort ?? "deadline") {
      case "deadline": withAlign.sort((a, b) => ((a.daysRemaining ?? -1) < 0 ? 1 : 0) - ((b.daysRemaining ?? -1) < 0 ? 1 : 0) || byDeadline(a, b)); break;
      case "newest": withAlign.sort((a, b) => +new Date(b.createdAt) - +new Date(a.createdAt)); break;
      case "funding": withAlign.sort((a, b) => (FUNDING_RANK[a.fundingCategory] ?? 9) - (FUNDING_RANK[b.fundingCategory] ?? 9) || byDeadline(a, b)); break;
      case "cost": withAlign.sort((a, b) => (a.feeStatus === "FREE" ? 0 : a.feeAmount ?? 1e6) - (b.feeStatus === "FREE" ? 0 : b.feeAmount ?? 1e6)); break;
      case "alignment": withAlign.sort((a, b) => rankA[a.researchAlignment] - rankA[b.researchAlignment] || byDeadline(a, b)); break;
    }
    res.json({ items: withAlign, total: withAlign.length });
  }),
);

opportunitiesRouter.get(
  "/opportunities/:id",
  ah(async (req, res) => {
    const userId = uid(req);
    const o = await prisma.opportunity.findFirst({
      where: { id: String(req.params.id), userId },
      include: { funding: true, deadlines: true, requirements: true, sources: true, applications: true, changes: true, supervisors: { orderBy: { relevance: "desc" } } },
    });
    if (!o) throw new HttpError(404, "Opportunity not found");
    const bundle = await getProfileBundle(userId);
    const app = o.applications[0];
    let docsReady: { ready: number; required: number } | undefined;
    if (app) {
      const docs = await prisma.applicationDocument.findMany({ where: { applicationId: app.id } });
      const req2 = docs.filter((d) => d.necessity === "REQUIRED" || d.necessity === "UNKNOWN");
      docsReady = { ready: req2.filter((d) => d.status === "READY" || d.status === "NOT_REQUIRED").length, required: req2.length };
    }
    res.json({ opportunity: serializeOpportunity(o, await tz(userId), true), match: matchAnalysis(bundle, o.extraction as unknown as ExtractionResult, docsReady) });
  }),
);

opportunitiesRouter.patch(
  "/opportunities/:id",
  ah(async (req, res) => {
    const userId = uid(req);
    const body = z
      .object({
        saved: z.boolean().optional(),
        shortlisted: z.boolean().optional(),
        archived: z.boolean().optional(),
        field: z.string().optional(),
        value: z.string().optional(),
        note: z.string().max(500).optional(),
      })
      .parse(req.body);
    const o = await prisma.opportunity.findFirst({ where: { id: String(req.params.id), userId } });
    if (!o) throw new HttpError(404, "Opportunity not found");
    if (body.field) {
      if (!isEditableField(body.field) || body.value === undefined) throw new HttpError(400, "Unsupported field edit");
      await setUserFact(userId, o.id, body.field, body.value, body.note);
    }
    const flags: Prisma.OpportunityUpdateInput = {};
    if (body.saved !== undefined) flags.saved = body.saved;
    if (body.shortlisted !== undefined) {
      flags.shortlisted = body.shortlisted;
      if (body.shortlisted) flags.saved = true;
    }
    if (body.archived !== undefined) flags.archived = body.archived;
    const updated = await prisma.opportunity.update({ where: { id: o.id }, data: flags });
    res.json({ opportunity: serializeOpportunity(updated, await tz(userId)) });
  }),
);

opportunitiesRouter.delete(
  "/opportunities/:id",
  ah(async (req, res) => {
    const r = await prisma.opportunity.deleteMany({ where: { id: String(req.params.id), userId: uid(req) } });
    if (!r.count) throw new HttpError(404, "Opportunity not found");
    res.json({ ok: true });
  }),
);

/** Attach an additional official source (e.g. graduate admissions page for English requirements). */
opportunitiesRouter.post(
  "/opportunities/:id/sources",
  ah(async (req, res) => {
    const body = analyzeBody.parse(req.body);
    const r = body.html ? await analyzeHtml(body.html, body.url, { useAI: body.useAI }) : await analyzeUrl(body.url, { useAI: body.useAI });
    if (!r.ok) throw new HttpError(422, `Crawl failed. Reason: ${r.error}`);
    const merged = await addSource(uid(req), String(req.params.id), r.extraction!);
    res.json(merged);
  }),
);

opportunitiesRouter.post(
  "/verify-opportunity",
  ah(async (req, res) => {
    const { id } = z.object({ id: z.string() }).parse(req.body);
    const r = await verifyOpportunity(uid(req), id);
    res.json({ ...r, changes: r.changes.map((c) => ({ field: c.label, old: c.oldValue, new: c.newValue })) });
  }),
);

opportunitiesRouter.post(
  "/changes/:id/resolve",
  ah(async (req, res) => {
    const { action } = z.object({ action: z.enum(["ACCEPT", "DISMISS"]) }).parse(req.body);
    await resolveChange(uid(req), String(req.params.id), action);
    res.json({ ok: true });
  }),
);

opportunitiesRouter.get(
  "/changes",
  ah(async (req, res) => {
    const changes = await prisma.changeLog.findMany({
      where: { opportunity: { userId: uid(req) }, status: "PENDING" },
      include: { opportunity: { select: { id: true, title: true, universityName: true } } },
      orderBy: { detectedAt: "desc" },
    });
    res.json({ items: changes });
  }),
);

/** GET /deadlines — every dated deadline of saved opportunities, with urgency in the user's timezone. */
opportunitiesRouter.get(
  "/deadlines",
  ah(async (req, res) => {
    const userId = uid(req);
    const zone = await tz(userId);
    const rows = await prisma.deadline.findMany({
      where: { opportunity: { userId, archived: false, OR: [{ saved: true }, { applications: { some: {} } }] }, kind: { notIn: ["START_DATE", "OTHER"] } },
      include: { opportunity: { select: { id: true, title: true, universityName: true, country: true, applications: { select: { id: true, stage: true } } } } },
      orderBy: { date: "asc" },
    });
    const items = rows.map((d) => {
      const iso = d.date ? d.date.toISOString().slice(0, 10) : null;
      const days = iso ? daysUntil(iso, new Date(), zone) : null;
      return { id: d.id, kind: d.kind, date: iso, dateText: d.dateText, time: d.time, timezone: d.timezone, round: d.round, certainty: d.certainty, yearInferred: d.yearInferred, snippet: d.snippet, sourceUrl: d.sourceUrl, daysRemaining: days, urgency: urgencyFor(days), opportunity: d.opportunity };
    });
    res.json({ items, timezone: zone });
  }),
);

opportunitiesRouter.get(
  "/requirements",
  ah(async (req, res) => {
    const { opportunityId } = z.object({ opportunityId: z.string() }).parse(req.query);
    const o = await prisma.opportunity.findFirst({ where: { id: opportunityId, userId: uid(req) }, include: { requirements: true } });
    if (!o) throw new HttpError(404, "Opportunity not found");
    res.json({ items: o.requirements });
  }),
);
