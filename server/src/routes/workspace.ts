import { Router } from "express";
import PDFDocument from "pdfkit";
import { Document as DocxDocument, Packer, Paragraph, TextRun } from "docx";
import { z } from "zod";
import { aiStatus } from "../ai/provider.js";
import { uid } from "../auth/middleware.js";
import { config } from "../config.js";
import { getJob, searchStrategies, startDiscovery } from "../crawler/discovery.js";
import { prisma } from "../db.js";
import { ah, HttpError } from "../http.js";
import { rebuildPackage } from "../services/applications.js";
import { saveTextVersion } from "../services/documents.js";
import { compareWithMaster, draftEmail, generateDocument, recheckGenerated, type GenKind } from "../services/generation.js";
import { runNotificationScan } from "../services/notifications.js";
import { getProfileBundle } from "../services/profile.js";
import { discoverSupervisors } from "../services/supervisors.js";

export const workspaceRouter = Router();

// ───────────── Document generation ─────────────
const genBody = z.object({
  opportunityId: z.string(),
  tone: z.enum(["ACADEMIC", "RESEARCH_FOCUSED", "CONCISE", "FORMAL"]).optional(),
  useAI: z.boolean().optional(),
  masterText: z.string().max(50_000).optional(),
});

async function afterGenerate(userId: string, opportunityId: string) {
  const app = await prisma.application.findUnique({ where: { userId_opportunityId: { userId, opportunityId } } });
  if (app) await rebuildPackage(app.id);
}

for (const [path, kind] of [["/generate-sop", "SOP"], ["/generate-cover-letter", "COVER_LETTER"], ["/generate-research-proposal", "RESEARCH_PROPOSAL"]] as const) {
  workspaceRouter.post(
    path,
    ah(async (req, res) => {
      const body = genBody.parse(req.body);
      const doc = await generateDocument(uid(req), { ...body, kind: kind as GenKind });
      await afterGenerate(uid(req), body.opportunityId);
      res.status(201).json({ generated: doc });
    }),
  );
}

workspaceRouter.get(
  "/generated",
  ah(async (req, res) => {
    const { opportunityId } = z.object({ opportunityId: z.string().optional() }).parse(req.query);
    const items = await prisma.generatedDocument.findMany({
      where: { userId: uid(req), ...(opportunityId ? { opportunityId } : {}) },
      orderBy: { updatedAt: "desc" },
      include: { opportunity: { select: { id: true, title: true, universityName: true } } },
    });
    res.json({ items });
  }),
);

workspaceRouter.get(
  "/generated/:id",
  ah(async (req, res) => {
    const g = await prisma.generatedDocument.findFirst({ where: { id: String(req.params.id), userId: uid(req) }, include: { opportunity: { select: { id: true, title: true, universityName: true } } } });
    if (!g) throw new HttpError(404, "Draft not found");
    res.json({ generated: g, comparison: g.baseContent ? compareWithMaster(g.baseContent, g.content) : null });
  }),
);

workspaceRouter.get("/generated/:id/export", ah(async (req, res) => {
  const format = z.object({ format: z.enum(["pdf", "docx"]) }).parse(req.query).format;
  const g = await prisma.generatedDocument.findFirst({ where: { id: String(req.params.id), userId: uid(req) } });
  if (!g) throw new HttpError(404, "Draft not found");
  const filename = g.title.replace(/[^A-Za-z0-9]+/g, "_").slice(0, 80);
  if (format === "docx") {
    const doc = new DocxDocument({ sections: [{ properties: {}, children: g.content.split(/\r?\n/).map((line) => new Paragraph({ children: [new TextRun(line)] })) }] });
    const buffer = await Packer.toBuffer(doc);
    res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.wordprocessingml.document");
    res.setHeader("Content-Disposition", `attachment; filename="${filename}.docx"`);
    res.send(buffer);
    return;
  }
  const chunks: Buffer[] = [];
  const pdf = new PDFDocument({ margin: 54 });
  pdf.on("data", (chunk: Buffer) => chunks.push(chunk));
  pdf.on("end", () => {
    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Disposition", `attachment; filename="${filename}.pdf"`);
    res.send(Buffer.concat(chunks));
  });
  pdf.fontSize(11).text(g.content, { lineGap: 4 });
  pdf.end();
}));

workspaceRouter.patch(
  "/generated/:id",
  ah(async (req, res) => {
    const userId = uid(req);
    const body = z.object({ content: z.string().max(100_000).optional(), status: z.enum(["DRAFT", "APPROVED"]).optional() }).parse(req.body);
    let g = await prisma.generatedDocument.findFirst({ where: { id: String(req.params.id), userId } });
    if (!g) throw new HttpError(404, "Draft not found");
    if (body.content !== undefined && body.content !== g.content) g = await recheckGenerated(userId, g.id, body.content);
    if (body.status) g = await prisma.generatedDocument.update({ where: { id: g.id }, data: { status: body.status } });
    if (g.opportunityId) await afterGenerate(userId, g.opportunityId);
    res.json({ generated: g });
  }),
);

workspaceRouter.delete(
  "/generated/:id",
  ah(async (req, res) => {
    await prisma.generatedDocument.deleteMany({ where: { id: String(req.params.id), userId: uid(req) } });
    res.json({ ok: true });
  }),
);

/** Save a generated draft into the vault as a new, versioned document (never overwrites the master). */
workspaceRouter.post(
  "/generated/:id/save-to-vault",
  ah(async (req, res) => {
    const userId = uid(req);
    const g = await prisma.generatedDocument.findFirst({ where: { id: String(req.params.id), userId }, include: { opportunity: true } });
    if (!g) throw new HttpError(404, "Draft not found");
    const uni = (g.opportunity?.universityName ?? "Opportunity").replace(/[^A-Za-z0-9]+/g, "");
    const type = g.kind === "COVER_LETTER" ? "COVER_LETTER" : g.kind === "RESEARCH_PROPOSAL" ? "RESEARCH_PROPOSAL" : "SOP";
    const r = await saveTextVersion(userId, { name: g.title, type, labelPrefix: `${type}_${uni}`, text: g.content, notes: `Generated draft (${g.provider}), status ${g.status}`, relevantProgram: g.opportunity?.title });
    res.status(201).json({ document: r.document, version: { id: r.version.id, label: r.version.label } });
  }),
);

// ───────────── Supervisors & emails ─────────────
workspaceRouter.post(
  "/supervisors/discover",
  ah(async (req, res) => {
    const body = z.object({ url: z.string().url(), html: z.string().max(5_000_000).optional(), opportunityId: z.string() }).parse(req.body);
    res.json({ items: await discoverSupervisors(uid(req), body) });
  }),
);

workspaceRouter.get(
  "/supervisors",
  ah(async (req, res) => {
    const { opportunityId } = z.object({ opportunityId: z.string().optional() }).parse(req.query);
    const userId = uid(req);
    const items = await prisma.supervisor.findMany({
      where: opportunityId ? { opportunityId, opportunity: { userId } } : { opportunity: { userId } },
      orderBy: { relevance: "desc" },
      include: { opportunity: { select: { id: true, title: true } } },
    });
    res.json({ items });
  }),
);

workspaceRouter.delete(
  "/supervisors/:id",
  ah(async (req, res) => {
    const s = await prisma.supervisor.findUnique({ where: { id: String(req.params.id) }, include: { opportunity: true } });
    if (!s || (s.opportunity && s.opportunity.userId !== uid(req))) throw new HttpError(404, "Not found");
    await prisma.supervisor.delete({ where: { id: s.id } });
    res.json({ ok: true });
  }),
);

workspaceRouter.post(
  "/email-drafts",
  ah(async (req, res) => {
    const body = z.object({ opportunityId: z.string().optional(), supervisorId: z.string().optional(), purpose: z.enum(["INITIAL_CONTACT", "AVAILABILITY", "FUNDING", "RESEARCH_INTEREST", "FOLLOW_UP", "CLARIFICATION"]), question: z.string().max(2000).optional() }).parse(req.body);
    res.status(201).json({ draft: await draftEmail(uid(req), body) });
  }),
);

workspaceRouter.get(
  "/email-drafts",
  ah(async (req, res) => {
    const items = await prisma.emailDraft.findMany({ where: { userId: uid(req) }, orderBy: { updatedAt: "desc" }, include: { opportunity: { select: { id: true, title: true } }, supervisor: { select: { id: true, name: true } } } });
    res.json({ items });
  }),
);

/** Emails are never sent by the app. The user copies the text or opens their own mail client, then may mark it sent. */
workspaceRouter.patch(
  "/email-drafts/:id",
  ah(async (req, res) => {
    const body = z.object({ to: z.string().max(200).nullable().optional(), subject: z.string().max(300).optional(), body: z.string().max(20_000).optional(), status: z.enum(["DRAFT", "APPROVED", "MARKED_SENT"]).optional() }).parse(req.body);
    const r = await prisma.emailDraft.updateMany({ where: { id: String(req.params.id), userId: uid(req) }, data: body });
    if (!r.count) throw new HttpError(404, "Draft not found");
    res.json({ ok: true });
  }),
);

workspaceRouter.delete(
  "/email-drafts/:id",
  ah(async (req, res) => {
    await prisma.emailDraft.deleteMany({ where: { id: String(req.params.id), userId: uid(req) } });
    res.json({ ok: true });
  }),
);

// ───────────── References, interview preparation & safe form memory ─────────────
const referenceBody = z.object({
  applicationId: z.string().nullable().optional(), name: z.string().min(1).max(200), email: z.string().email().nullable().optional(),
  institution: z.string().max(300).nullable().optional(), relationship: z.string().max(200).nullable().optional(), status: z.enum(["NOT_REQUESTED", "REQUESTED", "REMINDED", "RECEIVED", "DECLINED"]).optional(),
  requestedAt: z.string().nullable().optional(), deadline: z.string().nullable().optional(), receivedAt: z.string().nullable().optional(), notes: z.string().max(2000).nullable().optional(),
});
const referenceDates = (b: Partial<z.infer<typeof referenceBody>>) => ({ ...b, requestedAt: b.requestedAt ? new Date(b.requestedAt) : b.requestedAt === null ? null : undefined, deadline: b.deadline ? new Date(b.deadline) : b.deadline === null ? null : undefined, receivedAt: b.receivedAt ? new Date(b.receivedAt) : b.receivedAt === null ? null : undefined });

workspaceRouter.get("/reference-requests", ah(async (req, res) => {
  const items = await prisma.referenceRequest.findMany({ where: { userId: uid(req) }, orderBy: [{ status: "asc" }, { deadline: "asc" }], include: { application: { include: { opportunity: { select: { id: true, title: true } } } } } });
  res.json({ items });
}));
workspaceRouter.post("/reference-requests", ah(async (req, res) => {
  const b = referenceBody.parse(req.body);
  if (b.applicationId) {
    const app = await prisma.application.findFirst({ where: { id: b.applicationId, userId: uid(req) } });
    if (!app) throw new HttpError(404, "Application not found");
  }
  res.status(201).json({ item: await prisma.referenceRequest.create({ data: { ...referenceDates(b), name: b.name, userId: uid(req) } }) });
}));
workspaceRouter.patch("/reference-requests/:id", ah(async (req, res) => {
  const r = await prisma.referenceRequest.updateMany({ where: { id: String(req.params.id), userId: uid(req) }, data: referenceDates(referenceBody.partial().parse(req.body)) });
  if (!r.count) throw new HttpError(404, "Reference request not found");
  res.json({ ok: true });
}));
workspaceRouter.delete("/reference-requests/:id", ah(async (req, res) => {
  await prisma.referenceRequest.deleteMany({ where: { id: String(req.params.id), userId: uid(req) } });
  res.json({ ok: true });
}));

workspaceRouter.get("/applications/:id/interview-prep", ah(async (req, res) => {
  const app = await prisma.application.findFirst({ where: { id: String(req.params.id), userId: uid(req) }, include: { opportunity: true } });
  if (!app) throw new HttpError(404, "Application not found");
  const existing = await prisma.interviewPrep.findUnique({ where: { applicationId: app.id } });
  res.json({ prep: existing });
}));
workspaceRouter.post("/applications/:id/interview-prep/generate", ah(async (req, res) => {
  const app = await prisma.application.findFirst({ where: { id: String(req.params.id), userId: uid(req) }, include: { opportunity: true } });
  if (!app) throw new HttpError(404, "Application not found");
  const ex = app.opportunity.extraction as { title?: { value?: string | null }; university?: { value?: string | null }; researchAreas?: string[]; degreeRequirement?: { value?: string | null }; funding?: { category?: { value?: string | null } }; english?: { summary?: string } };
  const questions = [
    { category: "Motivation", question: `Why do you want to pursue this PhD at ${ex.university?.value ?? "this university"}?`, answer: "" },
    { category: "Research fit", question: `How does your background prepare you for ${ex.title?.value ?? app.opportunity.title}?`, answer: "" },
    { category: "Research plan", question: `What research question would you explore in ${ex.researchAreas?.join(", ") || "this area"}, and how would you investigate it?`, answer: "" },
    { category: "Evidence", question: "Describe one project, paper, or research experience that demonstrates your preparation.", answer: "" },
    { category: "Practical", question: `What do you understand about the funding and English requirements? ${ex.funding?.category?.value ?? "Funding is not confirmed."} / ${ex.english?.summary ?? "English requirements need verification."}`, answer: "" },
  ];
  const prep = await prisma.interviewPrep.upsert({ where: { applicationId: app.id }, update: { questions }, create: { applicationId: app.id, questions } });
  res.json({ prep });
}));
workspaceRouter.patch("/applications/:id/interview-prep", ah(async (req, res) => {
  const app = await prisma.application.findFirst({ where: { id: String(req.params.id), userId: uid(req) } });
  if (!app) throw new HttpError(404, "Application not found");
  const b = z.object({ questions: z.array(z.object({ category: z.string(), question: z.string(), answer: z.string().max(10_000) })).max(50), notes: z.string().max(10_000).nullable().optional() }).parse(req.body);
  res.json({ prep: await prisma.interviewPrep.upsert({ where: { applicationId: app.id }, update: b, create: { applicationId: app.id, ...b } }) });
}));

workspaceRouter.get("/form-answers", ah(async (req, res) => {
  const { siteKey } = z.object({ siteKey: z.string().max(300).optional() }).parse(req.query);
  res.json({ items: await prisma.applicationFormAnswer.findMany({ where: { userId: uid(req), approved: true, ...(siteKey ? { siteKey } : {}) }, orderBy: { updatedAt: "desc" } }) });
}));
workspaceRouter.post("/form-answers", ah(async (req, res) => {
  const b = z.object({ applicationId: z.string().nullable().optional(), siteKey: z.string().min(1).max(300), fieldKey: z.string().min(1).max(300), label: z.string().min(1).max(300), value: z.string().max(5000), approved: z.boolean().default(false) }).parse(req.body);
  if (b.applicationId && !(await prisma.application.findFirst({ where: { id: b.applicationId, userId: uid(req) } }))) throw new HttpError(404, "Application not found");
  res.status(201).json({ item: await prisma.applicationFormAnswer.upsert({ where: { userId_siteKey_fieldKey: { userId: uid(req), siteKey: b.siteKey, fieldKey: b.fieldKey } }, update: b, create: { ...b, userId: uid(req) } }) });
}));

// ───────────── Tasks ─────────────
workspaceRouter.get(
  "/tasks",
  ah(async (req, res) => {
    const items = await prisma.task.findMany({ where: { userId: uid(req) }, orderBy: [{ done: "asc" }, { dueDate: "asc" }], include: { opportunity: { select: { id: true, title: true } } } });
    res.json({ items });
  }),
);
const taskBody = z.object({ title: z.string().min(1).max(300), notes: z.string().max(2000).nullable().optional(), dueDate: z.string().nullable().optional(), done: z.boolean().optional(), opportunityId: z.string().nullable().optional(), applicationId: z.string().nullable().optional() });
workspaceRouter.post(
  "/tasks",
  ah(async (req, res) => {
    const b = taskBody.parse(req.body);
    const t = await prisma.task.create({ data: { ...b, dueDate: b.dueDate ? new Date(b.dueDate) : null, userId: uid(req) } });
    res.status(201).json({ task: t });
  }),
);
workspaceRouter.patch(
  "/tasks/:id",
  ah(async (req, res) => {
    const b = taskBody.partial().parse(req.body);
    const r = await prisma.task.updateMany({ where: { id: String(req.params.id), userId: uid(req) }, data: { ...b, dueDate: b.dueDate === undefined ? undefined : b.dueDate ? new Date(b.dueDate) : null } });
    if (!r.count) throw new HttpError(404, "Task not found");
    res.json({ ok: true });
  }),
);
workspaceRouter.delete(
  "/tasks/:id",
  ah(async (req, res) => {
    await prisma.task.deleteMany({ where: { id: String(req.params.id), userId: uid(req) } });
    res.json({ ok: true });
  }),
);

// ───────────── Notifications ─────────────
workspaceRouter.get(
  "/notifications",
  ah(async (req, res) => {
    const { unread, since } = z.object({ unread: z.coerce.boolean().optional(), since: z.string().optional() }).parse(req.query);
    const where = { userId: uid(req), ...(unread ? { readAt: null } : {}), ...(since ? { createdAt: { gt: new Date(since) } } : {}) };
    const [items, unreadCount] = await Promise.all([
      prisma.notification.findMany({ where, orderBy: { createdAt: "desc" }, take: 200 }),
      prisma.notification.count({ where: { userId: uid(req), readAt: null } }),
    ]);
    res.json({ items, unreadCount });
  }),
);
workspaceRouter.post(
  "/notifications/:id/read",
  ah(async (req, res) => {
    await prisma.notification.updateMany({ where: { id: String(req.params.id), userId: uid(req) }, data: { readAt: new Date() } });
    res.json({ ok: true });
  }),
);
workspaceRouter.post(
  "/notifications/read-all",
  ah(async (req, res) => {
    await prisma.notification.updateMany({ where: { userId: uid(req), readAt: null }, data: { readAt: new Date() } });
    res.json({ ok: true });
  }),
);
workspaceRouter.post(
  "/notifications/scan",
  ah(async (_req, res) => {
    res.json(await runNotificationScan());
  }),
);

// ───────────── Discovery / crawler ─────────────
workspaceRouter.post(
  "/crawl",
  ah(async (req, res) => {
    const body = z.object({ seedIds: z.array(z.string()).optional(), urls: z.array(z.string().url()).max(20).optional(), query: z.string().max(300).optional(), maxPerSeed: z.number().int().min(1).max(40).optional() }).parse(req.body ?? {});
    const job = startDiscovery(uid(req), body);
    res.status(202).json({ job });
  }),
);
workspaceRouter.get(
  "/crawl/:jobId",
  ah(async (req, res) => {
    const job = getJob(String(req.params.jobId));
    if (!job || job.userId !== uid(req)) throw new HttpError(404, "Job not found");
    res.json({ job });
  }),
);
workspaceRouter.get(
  "/seeds",
  ah(async (req, res) => {
    res.json({ items: await prisma.discoverySeed.findMany({ where: { userId: uid(req) }, orderBy: { createdAt: "desc" } }) });
  }),
);
workspaceRouter.post(
  "/seeds",
  ah(async (req, res) => {
    const b = z.object({ url: z.string().url(), label: z.string().max(200).optional(), kind: z.enum(["PAGE", "FEED"]).optional() }).parse(req.body);
    const s = await prisma.discoverySeed.upsert({ where: { userId_url: { userId: uid(req), url: b.url } }, update: { label: b.label, kind: b.kind, enabled: true }, create: { ...b, userId: uid(req) } });
    res.status(201).json({ seed: s });
  }),
);
workspaceRouter.patch(
  "/seeds/:id",
  ah(async (req, res) => {
    const b = z.object({ enabled: z.boolean().optional(), label: z.string().max(200).optional() }).parse(req.body);
    await prisma.discoverySeed.updateMany({ where: { id: String(req.params.id), userId: uid(req) }, data: b });
    res.json({ ok: true });
  }),
);
workspaceRouter.delete(
  "/seeds/:id",
  ah(async (req, res) => {
    await prisma.discoverySeed.deleteMany({ where: { id: String(req.params.id), userId: uid(req) } });
    res.json({ ok: true });
  }),
);
workspaceRouter.get(
  "/discovery/strategies",
  ah(async (req, res) => {
    const b = await getProfileBundle(uid(req));
    res.json({ items: searchStrategies(b.interests.map((i) => i.name), b.profile.preferredCountries as string[]) });
  }),
);

// ───────────── Settings / status ─────────────
workspaceRouter.get(
  "/settings/status",
  ah(async (_req, res) => {
    res.json({
      ai: aiStatus(),
      search: { provider: config.search.provider, enabled: config.search.provider === "brave" && !!config.search.braveApiKey },
      scheduler: config.scheduler,
      emailNotifications: !!(config.smtp.url && config.smtp.from),
      crawler: { userAgent: config.crawler.userAgent, minDelayMs: config.crawler.minDelayMs, respectsRobotsTxt: true },
    });
  }),
);
