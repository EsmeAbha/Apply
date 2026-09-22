import type { Prisma } from "@prisma/client";
import { prisma } from "../db.js";
import type { ExtractionResult } from "../extraction/types.js";
import { HttpError } from "../http.js";

export const STAGES = [
  "DISCOVERED",
  "SHORTLISTED",
  "REQUIREMENTS_VERIFIED",
  "DOCUMENTS_PREPARING",
  "READY_TO_APPLY",
  "APPLICATION_STARTED",
  "AWAITING_USER_REVIEW",
  "SUBMITTED",
  "INTERVIEW",
  "DECISION",
] as const;
export type Stage = (typeof STAGES)[number];

/** Vault document types that can satisfy a requirement key. */
const VAULT_TYPES: Record<string, string[]> = {
  CV: ["CV"],
  TRANSCRIPTS: ["TRANSCRIPT"],
  TRANSCRIPT_BACHELOR: ["TRANSCRIPT"],
  TRANSCRIPT_MASTER: ["TRANSCRIPT"],
  DEGREE_CERTIFICATE: ["DEGREE", "CERTIFICATE"],
  PASSPORT: ["PASSPORT"],
  ENGLISH_PROFICIENCY: ["ENGLISH_TEST"],
  RECOMMENDATION_LETTERS: ["RECOMMENDATION"],
  PUBLICATIONS: ["PUBLICATION"],
  MASTER_THESIS: ["THESIS"],
  WRITING_SAMPLE: ["PUBLICATION", "THESIS"],
  SOP: ["SOP"],
  MOTIVATION_LETTER: ["SOP", "COVER_LETTER"],
  COVER_LETTER: ["COVER_LETTER"],
  PERSONAL_STATEMENT: ["SOP"],
  RESEARCH_PROPOSAL: ["RESEARCH_PROPOSAL"],
  RESEARCH_STATEMENT: ["RESEARCH_PROPOSAL", "SOP"],
};
/** Documents that must be tailored per application (a master copy alone is "needs customisation"). */
const TAILORED = new Set(["SOP", "MOTIVATION_LETTER", "COVER_LETTER", "PERSONAL_STATEMENT", "RESEARCH_PROPOSAL", "RESEARCH_STATEMENT", "STUDY_PLAN"]);
const GENERATED_KIND: Record<string, string> = { SOP: "SOP", MOTIVATION_LETTER: "SOP", PERSONAL_STATEMENT: "SOP", COVER_LETTER: "COVER_LETTER", RESEARCH_PROPOSAL: "RESEARCH_PROPOSAL", RESEARCH_STATEMENT: "RESEARCH_PROPOSAL" };

const FALLBACK_DOCS = [
  { key: "CV", label: "CV / Résumé" },
  { key: "MOTIVATION_LETTER", label: "Motivation letter / SOP" },
  { key: "TRANSCRIPTS", label: "Academic transcripts" },
  { key: "DEGREE_CERTIFICATE", label: "Degree certificate(s)" },
  { key: "RECOMMENDATION_LETTERS", label: "Recommendation letters" },
];

export async function createApplication(userId: string, opportunityId: string, stage: Stage = "SHORTLISTED") {
  const opp = await prisma.opportunity.findFirst({ where: { id: opportunityId, userId } });
  if (!opp) throw new HttpError(404, "Opportunity not found");
  const existing = await prisma.application.findUnique({ where: { userId_opportunityId: { userId, opportunityId } } });
  if (existing) return existing;
  const app = await prisma.application.create({ data: { userId, opportunityId, stage, checklist: {} } });
  await prisma.opportunity.update({ where: { id: opportunityId }, data: { saved: true, shortlisted: true } });
  await rebuildPackage(app.id);
  return app;
}

/** (Re)build the application package from the opportunity's document requirements and the vault. */
export async function rebuildPackage(applicationId: string): Promise<void> {
  const app = await prisma.application.findUnique({ where: { id: applicationId }, include: { opportunity: true, documents: true } });
  if (!app) throw new HttpError(404, "Application not found");
  const ex = app.opportunity.extraction as unknown as ExtractionResult;
  const reqs = ex.documents.filter((d) => d.necessity !== "NOT_REQUIRED");
  const list = reqs.length
    ? reqs.map((d) => ({ key: d.key, label: d.label, necessity: d.necessity, count: d.count }))
    : FALLBACK_DOCS.map((d) => ({ ...d, necessity: "UNKNOWN" as const, count: undefined }));
  const englishNeeded = ex.english.status.value && !["NOT_REQUIRED"].includes(ex.english.status.value);
  if (englishNeeded && !list.some((d) => d.key === "ENGLISH_PROFICIENCY")) {
    list.push({ key: "ENGLISH_PROFICIENCY", label: `English proficiency proof — ${ex.english.summary}`, necessity: ex.english.status.value === "REQUIRED_AT_APPLICATION" ? "REQUIRED" : "CONDITIONAL", count: undefined });
  }

  const vault = await prisma.document.findMany({ where: { userId: app.userId, status: { not: "ARCHIVED" } }, include: { versions: { orderBy: { versionNumber: "desc" }, take: 1 } } });
  const generated = await prisma.generatedDocument.findMany({ where: { userId: app.userId, opportunityId: app.opportunityId }, orderBy: { updatedAt: "desc" } });
  const profile = await prisma.profile.findUnique({ where: { userId: app.userId } });

  for (const item of list) {
    const existing = app.documents.find((d) => d.requirementKey === item.key);
    const types = VAULT_TYPES[item.key] ?? [];
    const vaultDocs = vault.filter((v) => types.includes(v.type) && v.versions.length);
    let status = "MISSING";
    let documentVersionId: string | null = null;
    let generatedDocumentId: string | null = null;
    let countReady: number | null = null;
    let notes: string | null = null;

    const gen = GENERATED_KIND[item.key] ? generated.find((g) => g.kind === GENERATED_KIND[item.key]) : undefined;
    if (gen) {
      generatedDocumentId = gen.id;
      status = gen.status === "APPROVED" ? "READY" : "CUSTOMIZED";
      notes = gen.status === "APPROVED" ? "Tailored draft approved by you." : "Tailored draft — review and approve.";
    } else if (vaultDocs.length) {
      documentVersionId = vaultDocs[0].versions[0].id;
      status = TAILORED.has(item.key) ? "DRAFT" : "READY";
      if (TAILORED.has(item.key)) notes = "Master version available — generate a tailored version.";
    }
    if (item.key === "RECOMMENDATION_LETTERS") {
      countReady = vaultDocs.length;
      const need = item.count ?? null;
      status = need ? (countReady >= need ? "READY" : countReady > 0 ? "DRAFT" : "MISSING") : countReady > 0 ? "READY" : "MISSING";
      notes = need ? `${countReady}/${need} letters in your vault` : `${countReady} letter(s) in your vault; required number not stated`;
    }
    if (item.key === "ENGLISH_PROFICIENCY" && status === "MISSING") {
      const ielts = profile?.ieltsStatus ?? "NOT_TAKEN";
      status = ielts === "SCORE_RECEIVED" ? "MISSING" : "PENDING";
      notes = `IELTS status: ${ielts.replace(/_/g, " ").toLowerCase()}. ${ex.english.summary}`;
    }
    // Never downgrade a status the user set manually to READY/NOT_REQUIRED.
    if (existing && (existing.status === "NOT_REQUIRED" || (existing.status === "READY" && status === "MISSING" && !existing.documentVersionId && !existing.generatedDocumentId))) continue;
    await prisma.applicationDocument.upsert({
      where: { applicationId_requirementKey: { applicationId, requirementKey: item.key } },
      update: { label: item.label, necessity: item.necessity, status, documentVersionId, generatedDocumentId, count: item.count ?? null, countReady, notes },
      create: { applicationId, requirementKey: item.key, label: item.label, necessity: item.necessity, status, documentVersionId, generatedDocumentId, count: item.count ?? null, countReady, notes },
    });
  }
}

export interface ChecklistItem {
  key: string;
  label: string;
  done: boolean;
  auto: boolean;
  detail: string;
  confirmedByUser?: boolean;
}

export async function computeChecklist(applicationId: string) {
  const app = await prisma.application.findUnique({ where: { id: applicationId }, include: { opportunity: true, documents: true } });
  if (!app) throw new HttpError(404, "Application not found");
  const ex = app.opportunity.extraction as unknown as ExtractionResult;
  const manual = (app.checklist ?? {}) as Record<string, { done: boolean; at?: string }>;
  const required = app.documents.filter((d) => d.necessity === "REQUIRED" || d.necessity === "UNKNOWN");
  const readyReq = required.filter((d) => d.status === "READY" || d.status === "NOT_REQUIRED");
  const docStatus = (keys: string[]) => {
    const d = app.documents.find((x) => keys.includes(x.requirementKey));
    if (!d) return { done: true, detail: "Not required by the source." };
    return { done: d.status === "READY" || d.status === "NOT_REQUIRED", detail: `${d.label}: ${d.status}` };
  };
  const appDl = ex.deadlines.find((d) => d.kind === "APPLICATION");
  const certOk = (c?: string) => c === "VERIFIED" || c === "USER_ENTERED";
  const englishKnown = ex.english.status.value && !["NEEDS_VERIFICATION", "REQUIRED_STAGE_UNCLEAR"].includes(ex.english.status.value);

  const items: ChecklistItem[] = [
    { key: "eligibility", label: "Eligibility verified", auto: false, done: false, detail: ex.degreeRequirement.value ? `Requirement: ${ex.degreeRequirement.value}` : "Check the degree and eligibility requirements on the official page." },
    { key: "deadline", label: "Deadline verified", auto: true, done: !!appDl && certOk(appDl.certainty) && !ex.conflicts.some((c) => c.field.startsWith("deadline")), detail: appDl ? `${appDl.date} (${appDl.certainty})` : "Deadline UNKNOWN" },
    { key: "funding", label: "Funding verified", auto: true, done: certOk(ex.funding.category.certainty), detail: `${(ex.funding.category.value ?? "FUNDING_UNKNOWN").replace(/_/g, " ")} (${ex.funding.category.certainty})` },
    { key: "fee", label: "Application fee checked", auto: true, done: ex.fee.status.value !== null, detail: ex.fee.status.value === "FREE" ? "No application fee" : ex.fee.status.value ? `Fee: ${ex.fee.amount.value ? `${ex.fee.amount.value.currency} ${ex.fee.amount.value.amount}` : "amount not stated"}${ex.fee.waiver.value === "AVAILABLE" ? " (waiver available)" : ""}` : "Fee UNKNOWN" },
    { key: "english", label: "IELTS / English requirement checked", auto: true, done: !!englishKnown, detail: ex.english.summary },
    { key: "documents", label: "Documents checked", auto: true, done: required.length > 0 && readyReq.length === required.length, detail: `${readyReq.length}/${required.length} required documents ready` },
    { key: "sop", label: "SOP / motivation letter prepared", auto: true, ...docStatus(["SOP", "MOTIVATION_LETTER", "PERSONAL_STATEMENT"]) },
    { key: "cover", label: "Cover letter prepared", auto: true, ...docStatus(["COVER_LETTER"]) },
    { key: "proposal", label: "Research proposal prepared", auto: true, ...docStatus(["RESEARCH_PROPOSAL", "RESEARCH_STATEMENT"]) },
    { key: "recommendations", label: "Recommendation letters ready", auto: true, ...docStatus(["RECOMMENDATION_LETTERS"]) },
    { key: "form", label: "Application form reviewed", auto: false, done: false, detail: "Review every field on the official portal, especially declarations." },
    { key: "final", label: "Final user approval", auto: false, done: false, detail: "You confirm everything is correct. The app never submits for you." },
  ];
  for (const it of items) {
    const m = manual[it.key];
    if (m?.done) {
      it.done = true;
      it.confirmedByUser = true;
    }
  }
  const allButFinal = items.filter((i) => i.key !== "final").every((i) => i.done);
  return { items, readyForFinalReview: allButFinal, complete: items.every((i) => i.done) };
}

export async function setChecklistItem(userId: string, applicationId: string, key: string, done: boolean) {
  const app = await prisma.application.findFirst({ where: { id: applicationId, userId } });
  if (!app) throw new HttpError(404, "Application not found");
  const checklist = { ...((app.checklist ?? {}) as Record<string, unknown>), [key]: { done, at: new Date().toISOString() } };
  await prisma.application.update({ where: { id: applicationId }, data: { checklist: checklist as Prisma.InputJsonValue } });
  return computeChecklist(applicationId);
}

export async function setStage(userId: string, applicationId: string, stage: Stage, decision?: string) {
  const app = await prisma.application.findFirst({ where: { id: applicationId, userId } });
  if (!app) throw new HttpError(404, "Application not found");
  if (!STAGES.includes(stage)) throw new HttpError(400, "Unknown stage");
  if (stage === "SUBMITTED" && !app.submittedAt) {
    throw new HttpError(409, "Use “Confirm I submitted” on the final review page — the app records submission only after your explicit confirmation.");
  }
  return prisma.application.update({ where: { id: applicationId }, data: { stage, ...(decision ? { decision } : {}) } });
}

/** The user states they submitted on the official portal themselves. The app never submits anything. */
export async function confirmSubmission(userId: string, applicationId: string, confirmation: string, reference?: string) {
  if (confirmation !== "I SUBMITTED THIS APPLICATION MYSELF") {
    throw new HttpError(400, "Type the confirmation phrase exactly to record your submission.");
  }
  const app = await prisma.application.findFirst({ where: { id: applicationId, userId } });
  if (!app) throw new HttpError(404, "Application not found");
  return prisma.application.update({
    where: { id: applicationId },
    data: { stage: "SUBMITTED", submittedAt: new Date(), submissionConfirmation: reference ?? null, checklist: { ...((app.checklist ?? {}) as object), final: { done: true, at: new Date().toISOString() } } },
  });
}

export async function readiness(applicationId: string) {
  const docs = await prisma.applicationDocument.findMany({ where: { applicationId } });
  const required = docs.filter((d) => d.necessity === "REQUIRED" || d.necessity === "UNKNOWN");
  const ready = required.filter((d) => d.status === "READY" || d.status === "NOT_REQUIRED").length;
  return {
    requiredReady: ready,
    requiredTotal: required.length,
    percent: required.length ? Math.round((ready / required.length) * 100) : 0,
    items: docs.map((d) => ({ key: d.requirementKey, label: d.label, necessity: d.necessity, status: d.status, count: d.count, countReady: d.countReady, notes: d.notes })),
    note: "Readiness reflects document completion only — it is not a probability of admission.",
  };
}
