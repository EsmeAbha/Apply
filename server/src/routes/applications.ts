import { Router } from "express";
import JSZip from "jszip";
import { z } from "zod";
import { uid } from "../auth/middleware.js";
import { prisma } from "../db.js";
import type { ExtractionResult } from "../extraction/types.js";
import { ah, HttpError } from "../http.js";
import {
  computeChecklist,
  confirmSubmission,
  createApplication,
  readiness,
  rebuildPackage,
  setChecklistItem,
  setStage,
  STAGES,
  type Stage,
} from "../services/applications.js";
import { readVersion } from "../services/documents.js";
import { matchAnalysis } from "../services/matching.js";
import { serializeOpportunity } from "../services/opportunities.js";
import { getProfileBundle } from "../services/profile.js";

export const applicationsRouter = Router();

applicationsRouter.get(
  "/applications",
  ah(async (req, res) => {
    const userId = uid(req);
    const zone = (await prisma.profile.findUnique({ where: { userId } }))?.timezone ?? "UTC";
    const apps = await prisma.application.findMany({ where: { userId }, include: { opportunity: true, documents: true }, orderBy: { updatedAt: "desc" } });
    res.json({
      stages: STAGES,
      items: apps.map((a) => {
        const required = a.documents.filter((d) => d.necessity === "REQUIRED" || d.necessity === "UNKNOWN");
        return {
          id: a.id,
          stage: a.stage,
          decision: a.decision,
          submittedAt: a.submittedAt,
          updatedAt: a.updatedAt,
          opportunity: serializeOpportunity(a.opportunity, zone),
          documentsReady: required.filter((d) => d.status === "READY" || d.status === "NOT_REQUIRED").length,
          documentsRequired: required.length,
        };
      }),
    });
  }),
);

applicationsRouter.post(
  "/applications",
  ah(async (req, res) => {
    const { opportunityId, stage } = z.object({ opportunityId: z.string(), stage: z.enum(STAGES).optional() }).parse(req.body);
    const app = await createApplication(uid(req), opportunityId, stage as Stage | undefined);
    res.status(201).json({ application: app });
  }),
);

async function loadApp(userId: string, id: string) {
  const app = await prisma.application.findFirst({
    where: { id, userId },
    include: { opportunity: { include: { sources: true, changes: { where: { status: "PENDING" } } } }, documents: { include: { documentVersion: { select: { id: true, label: true, originalName: true } } } }, generated: { orderBy: { updatedAt: "desc" } } },
  });
  if (!app) throw new HttpError(404, "Application not found");
  return app;
}

applicationsRouter.get(
  "/applications/:id",
  ah(async (req, res) => {
    const userId = uid(req);
    const app = await loadApp(userId, String(req.params.id));
    const zone = (await prisma.profile.findUnique({ where: { userId } }))?.timezone ?? "UTC";
    const ex = app.opportunity.extraction as unknown as ExtractionResult;
    const r = await readiness(app.id);
    const bundle = await getProfileBundle(userId);
    res.json({
      application: { id: app.id, stage: app.stage, decision: app.decision, notes: app.notes, portalUrl: app.portalUrl, portalUsername: app.portalUsername, submittedAt: app.submittedAt, submissionConfirmation: app.submissionConfirmation, createdAt: app.createdAt },
      opportunity: serializeOpportunity(app.opportunity, zone),
      extraction: ex,
      documents: app.documents,
      generated: app.generated.map((g) => ({ id: g.id, kind: g.kind, title: g.title, status: g.status, version: g.version, updatedAt: g.updatedAt })),
      checklist: await computeChecklist(app.id),
      readiness: r,
      match: matchAnalysis(bundle, ex, { ready: r.requiredReady, required: r.requiredTotal }),
      pendingChanges: app.opportunity.changes,
      ieltsStatus: bundle.profile.ieltsStatus,
    });
  }),
);

applicationsRouter.patch(
  "/applications/:id",
  ah(async (req, res) => {
    const userId = uid(req);
    const body = z
      .object({ stage: z.enum(STAGES).optional(), decision: z.enum(["ACCEPTED", "REJECTED", "WAITLISTED", "WITHDRAWN"]).optional(), notes: z.string().max(10_000).optional(), portalUrl: z.string().url().or(z.literal("")).optional(), portalUsername: z.string().max(200).optional() })
      .parse(req.body);
    await loadApp(userId, String(req.params.id));
    if (body.stage) await setStage(userId, String(req.params.id), body.stage as Stage, body.decision);
    const app = await prisma.application.update({
      where: { id: String(req.params.id) },
      data: { notes: body.notes, portalUrl: body.portalUrl === "" ? null : body.portalUrl, portalUsername: body.portalUsername, ...(body.decision && !body.stage ? { decision: body.decision } : {}) },
    });
    res.json({ application: app });
  }),
);

applicationsRouter.delete(
  "/applications/:id",
  ah(async (req, res) => {
    const r = await prisma.application.deleteMany({ where: { id: String(req.params.id), userId: uid(req) } });
    if (!r.count) throw new HttpError(404, "Application not found");
    res.json({ ok: true });
  }),
);

applicationsRouter.post(
  "/applications/:id/checklist",
  ah(async (req, res) => {
    const { key, done } = z.object({ key: z.string(), done: z.boolean() }).parse(req.body);
    if (key === "final") throw new HttpError(400, "Final approval is recorded by confirming your submission on the final review page.");
    res.json(await setChecklistItem(uid(req), String(req.params.id), key, done));
  }),
);

applicationsRouter.post(
  "/applications/:id/refresh-package",
  ah(async (req, res) => {
    await loadApp(uid(req), String(req.params.id));
    await rebuildPackage(String(req.params.id));
    res.json(await readiness(String(req.params.id)));
  }),
);

applicationsRouter.patch(
  "/applications/:id/documents/:key",
  ah(async (req, res) => {
    const userId = uid(req);
    await loadApp(userId, String(req.params.id));
    const body = z.object({ status: z.enum(["MISSING", "DRAFT", "CUSTOMIZED", "READY", "PENDING", "NOT_REQUIRED"]).optional(), documentVersionId: z.string().nullable().optional(), countReady: z.number().int().min(0).optional(), notes: z.string().max(1000).optional() }).parse(req.body);
    if (body.documentVersionId) {
      const v = await prisma.documentVersion.findUnique({ where: { id: body.documentVersionId }, include: { document: true } });
      if (!v || v.document.userId !== userId) throw new HttpError(404, "Document version not found");
    }
    const doc = await prisma.applicationDocument.update({
      where: { applicationId_requirementKey: { applicationId: String(req.params.id), requirementKey: String(req.params.key) } },
      data: body,
    });
    res.json({ document: doc });
  }),
);

/** The user confirms they submitted on the official portal. The app itself never submits. */
applicationsRouter.post(
  "/applications/:id/confirm-submission",
  ah(async (req, res) => {
    const { confirmation, reference } = z.object({ confirmation: z.string(), reference: z.string().max(200).optional() }).parse(req.body);
    res.json({ application: await confirmSubmission(uid(req), String(req.params.id), confirmation, reference) });
  }),
);

/** Download a ZIP of the application package: attached vault files, generated drafts and a review summary. */
applicationsRouter.get(
  "/applications/:id/package",
  ah(async (req, res) => {
    const userId = uid(req);
    const app = await loadApp(userId, String(req.params.id));
    const ex = app.opportunity.extraction as unknown as ExtractionResult;
    const zip = new JSZip();
    const lines = [
      `APPLICATION PACKAGE — ${app.opportunity.title}`,
      `University: ${ex.university.value ?? "UNKNOWN"}`,
      `Official source: ${app.opportunity.officialUrl}`,
      `Application URL: ${ex.applyUrl.value ?? "UNKNOWN"}`,
      `Deadlines: ${ex.deadlines.filter((d) => d.kind !== "START_DATE" && d.kind !== "OTHER").map((d) => `${d.kind} ${d.date ?? d.dateText} (${d.certainty})`).join("; ") || "UNKNOWN"}`,
      `Funding: ${(ex.funding.category.value ?? "UNKNOWN").replace(/_/g, " ")}`,
      `English: ${ex.english.summary}`,
      `Last verified: ${app.opportunity.lastVerifiedAt?.toISOString() ?? "never"}`,
      "",
      "Documents:",
    ];
    for (const d of app.documents) {
      lines.push(`- ${d.label}: ${d.status}${d.documentVersion ? ` (${d.documentVersion.label})` : ""}`);
      if (d.documentVersionId) {
        const { version, data } = await readVersion(userId, d.documentVersionId);
        zip.file(`documents/${d.requirementKey}_${version.label}_${version.originalName}`, data);
      }
    }
    for (const g of app.generated.filter((x, i, arr) => arr.findIndex((y) => y.kind === x.kind) === i)) {
      zip.file(`drafts/${g.kind}_v${g.version}${g.status === "APPROVED" ? "_APPROVED" : "_DRAFT"}.txt`, g.content);
    }
    lines.push("", "This package was prepared by PhD Application Intelligence Assistant. Submit it yourself on the official portal.");
    zip.file("README_REVIEW.txt", lines.join("\n"));
    const buf = await zip.generateAsync({ type: "nodebuffer" });
    const safe = app.opportunity.title.replace(/[^A-Za-z0-9]+/g, "_").slice(0, 60);
    res.setHeader("Content-Type", "application/zip");
    res.setHeader("Content-Disposition", `attachment; filename="${safe}_package.zip"`);
    res.send(buf);
  }),
);
