import type { Prisma } from "@prisma/client";
import { Router } from "express";
import { z } from "zod";
import { uid } from "../auth/middleware.js";
import { prisma } from "../db.js";
import { ah, HttpError } from "../http.js";
import { getProfileBundle } from "../services/profile.js";

export const profileRouter = Router();

profileRouter.get(
  "/profile",
  ah(async (req, res) => {
    res.json(await getProfileBundle(uid(req)));
  }),
);

const profileBody = z
  .object({
    fullName: z.string().max(200).nullable(),
    contactEmail: z.string().max(200).nullable(),
    phone: z.string().max(60).nullable(),
    address: z.string().max(500).nullable(),
    nationality: z.string().max(100).nullable(),
    dateOfBirth: z.string().max(40).nullable(),
    timezone: z.string().max(80),
    currentDegree: z.string().max(200).nullable(),
    field: z.string().max(200).nullable(),
    summary: z.string().max(5000).nullable(),
    skills: z.array(z.string().max(80)).max(200),
    programmingLanguages: z.array(z.string().max(60)).max(100),
    languages: z.array(z.object({ language: z.string(), level: z.string() })).max(30),
    englishMediumEducation: z.enum(["YES", "NO", "UNKNOWN"]),
    englishMediumEvidence: z.string().max(1000).nullable(),
    ieltsStatus: z.enum(["NOT_TAKEN", "PLANNED", "BOOKED", "TAKEN", "SCORE_RECEIVED"]),
    ieltsTestDate: z.string().max(40).nullable(),
    ieltsScores: z.object({ overall: z.number().nullable().optional(), listening: z.number().nullable().optional(), reading: z.number().nullable().optional(), writing: z.number().nullable().optional(), speaking: z.number().nullable().optional() }).nullable(),
    otherTests: z.array(z.object({ test: z.string(), score: z.string(), date: z.string().optional() })).max(20),
    preferredCountries: z.array(z.string().max(80)).max(60),
    notificationPrefs: z.object({ inApp: z.boolean(), browser: z.boolean(), email: z.boolean(), thresholds: z.array(z.number().int().min(0).max(120)).max(10) }),
    masterSop: z.string().max(50_000).nullable(),
    masterCoverLetter: z.string().max(50_000).nullable(),
  })
  .partial();

profileRouter.put(
  "/profile",
  ah(async (req, res) => {
    const body = profileBody.parse(req.body);
    if (body.timezone) {
      try {
        new Intl.DateTimeFormat("en", { timeZone: body.timezone });
      } catch {
        throw new HttpError(400, "Unknown timezone");
      }
    }
    await getProfileBundle(uid(req));
    const data = { ...body, ieltsScores: body.ieltsScores === null ? undefined : body.ieltsScores } as Prisma.ProfileUpdateInput;
    await prisma.profile.update({ where: { userId: uid(req) }, data });
    res.json(await getProfileBundle(uid(req)));
  }),
);

/** GET /profile/form-values — non-sensitive values the extension may suggest for application forms. */
profileRouter.get(
  "/profile/form-values",
  ah(async (req, res) => {
    const b = await getProfileBundle(uid(req));
    const p = b.profile;
    const [first, ...rest] = (p.fullName ?? "").trim().split(/\s+/);
    const latest = b.education.filter((e) => e.verified)[0];
    res.json({
      values: {
        fullName: p.fullName,
        firstName: first || null,
        lastName: rest.length ? rest.join(" ") : null,
        email: p.contactEmail,
        phone: p.phone,
        address: p.address,
        currentDegree: p.currentDegree,
        field: p.field,
        institution: latest?.institution ?? null,
        degree: latest?.degree ?? null,
        degreeField: latest?.field ?? null,
        graduationDate: latest?.endDate ?? null,
        grade: latest?.grade ?? null,
        thesisTitle: latest?.thesisTitle ?? null,
        researchInterests: b.interests.map((i) => i.name).join(", "),
        skills: (p.skills as string[]).join(", "),
        programmingLanguages: (p.programmingLanguages as string[]).join(", "),
      },
      note: "Sensitive fields (citizenship, date of birth, declarations, disability, criminal record, finances, consent) are never auto-filled.",
    });
  }),
);

// ── Education
const eduBody = z.object({
  degree: z.string().min(1).max(100),
  field: z.string().max(200).nullable().optional(),
  institution: z.string().min(1).max(300),
  country: z.string().max(100).nullable().optional(),
  startDate: z.string().max(40).nullable().optional(),
  endDate: z.string().max(40).nullable().optional(),
  status: z.enum(["COMPLETED", "IN_PROGRESS"]).optional(),
  grade: z.string().max(60).nullable().optional(),
  thesisTitle: z.string().max(500).nullable().optional(),
  mediumOfInstruction: z.string().max(60).nullable().optional(),
  sortOrder: z.number().int().optional(),
  verified: z.boolean().optional(),
});

profileRouter.post(
  "/profile/education",
  ah(async (req, res) => {
    const b = await getProfileBundle(uid(req));
    const e = await prisma.education.create({ data: { ...eduBody.parse(req.body), profileId: b.profile.id } });
    res.status(201).json({ education: e });
  }),
);
profileRouter.put(
  "/profile/education/:id",
  ah(async (req, res) => {
    const b = await getProfileBundle(uid(req));
    const r = await prisma.education.updateMany({ where: { id: String(req.params.id), profileId: b.profile.id }, data: eduBody.partial().parse(req.body) });
    if (!r.count) throw new HttpError(404, "Not found");
    res.json({ ok: true });
  }),
);
profileRouter.delete(
  "/profile/education/:id",
  ah(async (req, res) => {
    const b = await getProfileBundle(uid(req));
    await prisma.education.deleteMany({ where: { id: String(req.params.id), profileId: b.profile.id } });
    res.json({ ok: true });
  }),
);

// ── Research interests
profileRouter.put(
  "/profile/interests",
  ah(async (req, res) => {
    const { interests } = z.object({ interests: z.array(z.string().min(1).max(100)).max(50) }).parse(req.body);
    const userId = uid(req);
    const unique = [...new Set(interests.map((i) => i.trim()).filter(Boolean))];
    await prisma.$transaction([
      prisma.researchInterest.deleteMany({ where: { userId } }),
      prisma.researchInterest.createMany({ data: unique.map((name, i) => ({ userId, name, priority: unique.length - i })) }),
    ]);
    res.json({ interests: await prisma.researchInterest.findMany({ where: { userId }, orderBy: { priority: "desc" } }) });
  }),
);

// ── Publications, projects, experience, awards, …
const itemBody = z.object({
  kind: z.enum(["PUBLICATION", "PROJECT", "RESEARCH_EXPERIENCE", "WORK_EXPERIENCE", "TEACHING", "AWARD", "CERTIFICATION", "REFERENCE"]),
  title: z.string().min(1).max(500),
  organization: z.string().max(300).nullable().optional(),
  startDate: z.string().max(40).nullable().optional(),
  endDate: z.string().max(40).nullable().optional(),
  description: z.string().max(5000).nullable().optional(),
  url: z.string().max(500).nullable().optional(),
  verified: z.boolean().optional(),
});

profileRouter.post(
  "/profile/items",
  ah(async (req, res) => {
    const item = await prisma.profileItem.create({ data: { ...itemBody.parse(req.body), userId: uid(req) } });
    res.status(201).json({ item });
  }),
);
profileRouter.put(
  "/profile/items/:id",
  ah(async (req, res) => {
    const r = await prisma.profileItem.updateMany({ where: { id: String(req.params.id), userId: uid(req) }, data: itemBody.partial().parse(req.body) });
    if (!r.count) throw new HttpError(404, "Not found");
    res.json({ ok: true });
  }),
);
profileRouter.delete(
  "/profile/items/:id",
  ah(async (req, res) => {
    await prisma.profileItem.deleteMany({ where: { id: String(req.params.id), userId: uid(req) } });
    res.json({ ok: true });
  }),
);

/** Import CV proposals the user has reviewed and selected. */
profileRouter.post(
  "/profile/import",
  ah(async (req, res) => {
    const userId = uid(req);
    const { proposals, sourceDocumentId } = z
      .object({
        sourceDocumentId: z.string().optional(),
        proposals: z.array(z.object({ kind: z.string(), title: z.string().min(1).max(500), organization: z.string().optional(), dates: z.string().optional(), description: z.string().optional() })).max(300),
      })
      .parse(req.body);
    const b = await getProfileBundle(userId);
    let imported = 0;
    const skills = new Set(b.profile.skills as string[]);
    const langs = new Set(b.profile.programmingLanguages as string[]);
    const spoken = [...(b.profile.languages as { language: string; level: string }[])];
    for (const p of proposals) {
      if (p.kind === "SKILL") skills.add(p.title);
      else if (p.kind === "PROGRAMMING_LANGUAGE") langs.add(p.title);
      else if (p.kind === "LANGUAGE") {
        if (!spoken.some((l) => l.language.toLowerCase() === p.title.toLowerCase())) spoken.push({ language: p.title, level: "" });
      } else if (p.kind === "RESEARCH_INTEREST") {
        await prisma.researchInterest.upsert({ where: { userId_name: { userId, name: p.title } }, update: {}, create: { userId, name: p.title } });
      } else if (p.kind === "EDUCATION") {
        await prisma.education.create({ data: { profileId: b.profile.id, degree: p.title.slice(0, 100), institution: p.organization ?? "[institution — please edit]", endDate: p.dates, verified: true } });
      } else {
        const [start, end] = (p.dates ?? "").split(/\s*[–—-]\s*|\s+to\s+/);
        await prisma.profileItem.create({ data: { userId, kind: p.kind, title: p.title, organization: p.organization, startDate: start || null, endDate: end || null, description: p.description, sourceDocumentId, verified: true } });
      }
      imported++;
    }
    await prisma.profile.update({ where: { id: b.profile.id }, data: { skills: [...skills], programmingLanguages: [...langs], languages: spoken } });
    res.json({ imported, profile: await getProfileBundle(userId) });
  }),
);
