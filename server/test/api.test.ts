import { readFileSync } from "node:fs";
import { readFile } from "node:fs/promises";
import http from "node:http";
import type { AddressInfo } from "node:net";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createApp } from "../src/app.js";
import { prisma } from "../src/db.js";
import { runNotificationScan, thresholdFor } from "../src/services/notifications.js";

const fixture = (name: string) => readFileSync(new URL(`./fixtures/${name}.html`, import.meta.url), "utf8");

// ── A local "university website" so tests never depend on live sites.
const pages: Record<string, { status: number; body: string; type?: string }> = {};
let base = "";
const site = http.createServer((req, res) => {
  const path = new URL(req.url ?? "/", "http://x").pathname.replace(/(.)\/$/, "$1");
  const p = pages[path];
  if (!p) {
    res.writeHead(404).end("not found");
    return;
  }
  res.writeHead(p.status, { "content-type": p.type ?? "text/html; charset=utf-8" }).end(p.body);
});

const app = createApp();
let token = "";
const auth = () => ({ Authorization: `Bearer ${token}` });

beforeAll(async () => {
  await new Promise<void>((r) => site.listen(0, "127.0.0.1", () => r()));
  base = `http://127.0.0.1:${(site.address() as AddressInfo).port}`;
  pages["/robots.txt"] = { status: 200, body: "User-agent: *\nDisallow: /private/\n", type: "text/plain" };
  pages["/phd/nlp"] = { status: 200, body: fixture("uk_funded_studentship") };
  pages["/phd/us"] = { status: 200, body: fixture("us_program") };
  pages["/phd/de"] = { status: 200, body: fixture("de_salaried_position") };
  pages["/private/secret"] = { status: 200, body: fixture("us_program") };
  pages["/login-only"] = { status: 403, body: "Forbidden" };
  pages["/vacancies"] = {
    status: 200,
    body: `<html><body><h1>Vacancies</h1><ul>
      <li><a href="/phd/nlp">PhD studentship in NLP</a></li>
      <li><a href="/phd/de">Doctoral researcher position</a></li>
      <li><a href="/about">About us</a></li></ul></body></html>`,
  };
});

afterAll(async () => {
  site.close();
  await prisma.$disconnect();
});

describe("authentication & security", () => {
  it("registers, stores only a password hash, and protects the API", async () => {
    const r = await request(app).post("/api/auth/register").send({ email: "Student@Example.com", password: "correct horse battery" });
    expect(r.status).toBe(201);
    token = r.body.token;
    const user = await prisma.user.findUnique({ where: { email: "student@example.com" } });
    expect(user!.passwordHash).not.toContain("correct horse");
    expect(user!.passwordHash.startsWith("scrypt$")).toBe(true);
    const session = await prisma.session.findFirst({ where: { userId: user!.id } });
    expect(session!.tokenHash).not.toBe(token);

    expect((await request(app).get("/api/opportunities")).status).toBe(401);
    expect((await request(app).post("/api/auth/login").send({ email: "student@example.com", password: "wrong password!" })).status).toBe(401);
    const login = await request(app).post("/api/auth/login").send({ email: "student@example.com", password: "correct horse battery" });
    expect(login.status).toBe(200);
  });

  it("creates a master profile with the stated academic direction", async () => {
    const r = await request(app).get("/api/profile").set(auth());
    expect(r.body.profile.currentDegree).toMatch(/Intelligent Systems/);
    expect(r.body.profile.ieltsStatus).toBe("NOT_TAKEN");
    expect(r.body.interests.map((i: { name: string }) => i.name)).toContain("Natural Language Processing");
  });
});

describe("URL analysis, saving and deduplication", () => {
  it("analyses a page and reports facts with evidence", async () => {
    const r = await request(app).post("/api/analyze-url").set(auth()).send({ url: `${base}/phd/nlp` });
    expect(r.status).toBe(200);
    expect(r.body.extraction.funding.category.value).toBe("FULLY_FUNDED");
    expect(r.body.extraction.deadlines[0].evidence[0].sourceUrl).toBe(`${base}/phd/nlp`);
    expect(r.body.match.researchAlignment.level).toBe("HIGH");
    expect(r.body.match.disclaimer).toMatch(/not a prediction/);
  });

  it("reports crawl failures instead of inventing data", async () => {
    const forbidden = await request(app).post("/api/analyze-url").set(auth()).send({ url: `${base}/login-only` });
    expect(forbidden.status).toBe(422);
    expect(forbidden.body.error).toMatch(/Crawl failed/);
    expect(forbidden.body.error).toMatch(/does not bypass/);
    const robots = await request(app).post("/api/analyze-url").set(auth()).send({ url: `${base}/private/secret` });
    expect(robots.status).toBe(422);
    expect(robots.body.fetchStatus).toBe("BLOCKED_BY_ROBOTS");
  });

  it("saves and deduplicates by normalised URL", async () => {
    const first = await request(app).post("/api/opportunities").set(auth()).send({ url: `${base}/phd/nlp` });
    expect(first.status).toBe(201);
    const again = await request(app).post("/api/opportunities").set(auth()).send({ url: `${base}/phd/nlp/?utm_source=newsletter` });
    expect(again.status).toBe(200);
    expect(again.body.duplicate).toBe(true);
    expect(again.body.opportunity.id).toBe(first.body.opportunity.id);
    expect(await prisma.opportunity.count()).toBe(1);
  });

  it("filters: free, fully funded, IELTS not required initially", async () => {
    await request(app).post("/api/opportunities").set(auth()).send({ url: `${base}/phd/us` });
    await request(app).post("/api/opportunities").set(auth()).send({ url: `${base}/phd/de` });
    const free = await request(app).get("/api/opportunities?freeOnly=true").set(auth());
    expect(free.body.items.map((i: { title: string }) => i.title).sort()).toEqual([
      "Doctoral Researcher (m/f/d) in Trustworthy Machine Learning",
      "Fully Funded PhD Studentship: Natural Language Processing for Low-Resource Languages",
    ]);
    const ielts = await request(app).get("/api/opportunities?english=NOT_REQUIRED_INITIALLY").set(auth());
    expect(ielts.body.items).toHaveLength(1);
    expect(ielts.body.items[0].englishStatus).toBe("REQUIRED_LATER");
    const waiver = await request(app).get("/api/opportunities?fee=WAIVER").set(auth());
    expect(waiver.body.items[0].feeStatus).toBe("FEE_WAIVER_AVAILABLE");
    const sorted = await request(app).get("/api/opportunities?sort=deadline").set(auth());
    const days = sorted.body.items.map((i: { daysRemaining: number }) => i.daysRemaining);
    expect(days).toEqual([...days].sort((a, b) => a - b));
  });

  it("merges a second source without overwriting, flagging conflicts", async () => {
    const opp = await prisma.opportunity.findFirst({ where: { officialUrl: `${base}/phd/de` } });
    // The US page disagrees with the DE page on deadline and funding → conflicts, not overwrites.
    const r = await request(app).post(`/api/opportunities/${opp!.id}/sources`).set(auth()).send({ url: `${base}/phd/us` });
    expect(r.status).toBe(200);
    expect(r.body.conflicts.map((c: { field: string }) => c.field)).toContain("deadline.APPLICATION");
    const detail = await request(app).get(`/api/opportunities/${opp!.id}`).set(auth());
    expect(detail.body.opportunity.verificationStatus).toBe("CONFLICTING");
    expect(detail.body.opportunity.primaryDeadline).toBe("2026-10-31");
  });
});

describe("change detection", () => {
  it("detects a changed deadline and never silently overwrites", async () => {
    const opp = await prisma.opportunity.findFirst({ where: { officialUrl: `${base}/phd/nlp` } });
    pages["/phd/nlp"] = { status: 200, body: fixture("uk_funded_studentship").replace("15 January 2027", "30 January 2027") };
    const v = await request(app).post("/api/verify-opportunity").set(auth()).send({ id: opp!.id });
    expect(v.body.ok).toBe(true);
    expect(v.body.changes).toContainEqual({ field: "Application deadline", old: "2027-01-15", new: "2027-01-30" });

    let detail = await request(app).get(`/api/opportunities/${opp!.id}`).set(auth());
    expect(detail.body.opportunity.primaryDeadline).toBe("2027-01-15"); // unchanged until accepted
    const change = detail.body.opportunity.changes.find((c: { field: string }) => c.field === "deadline.APPLICATION");
    expect(change.status).toBe("PENDING");
    const notif = await prisma.notification.findFirst({ where: { type: "CHANGE_DETECTED", opportunityId: opp!.id } });
    expect(notif!.title).toMatch(/CHANGE DETECTED/);

    await request(app).post(`/api/changes/${change.id}/resolve`).set(auth()).send({ action: "ACCEPT" }).expect(200);
    detail = await request(app).get(`/api/opportunities/${opp!.id}`).set(auth());
    expect(detail.body.opportunity.primaryDeadline).toBe("2027-01-30");
  });

  it("keeps stored data when re-verification fails", async () => {
    const opp = await prisma.opportunity.findFirst({ where: { officialUrl: `${base}/phd/nlp` } });
    pages["/phd/nlp"] = { status: 403, body: "Forbidden" };
    const v = await request(app).post("/api/verify-opportunity").set(auth()).send({ id: opp!.id });
    expect(v.body.ok).toBe(false);
    const after = await prisma.opportunity.findUnique({ where: { id: opp!.id } });
    expect(after!.fundingCategory).toBe("FULLY_FUNDED");
    expect(await prisma.notification.count({ where: { type: "CRAWL_FAILED" } })).toBe(1);
    pages["/phd/nlp"] = { status: 200, body: fixture("uk_funded_studentship") };
  });
});

describe("document vault", () => {
  let docId = "";
  it("encrypts files at rest and keeps every version", async () => {
    const cv1 = "Jane Doe\nEDUCATION\nMSc Intelligent Systems, Example University, 2025 - 2027\nBSc Computer Science and Engineering, Example Institute, 2019 - 2023\nPUBLICATIONS\nLow-resource speech recognition with self-supervised models. Workshop 2025.\nSKILLS\nPython, PyTorch, Transformers, SQL\n";
    const r1 = await request(app).post("/api/documents").set(auth()).field("type", "CV").field("name", "My CV").attach("file", Buffer.from(cv1), { filename: "cv.txt", contentType: "text/plain" });
    expect(r1.status).toBe(201);
    docId = r1.body.document.id;
    expect(r1.body.version.label).toBe("CV_v1");
    const r2 = await request(app).post(`/api/documents/${docId}/versions`).set(auth()).field("labelPrefix", "CV_PhD_NLP").attach("file", Buffer.from(cv1 + "AWARDS\nBest thesis award 2023\n"), { filename: "cv2.txt", contentType: "text/plain" });
    expect(r2.body.version.label).toBe("CV_PhD_NLP_v2");

    const versions = await prisma.documentVersion.findMany({ where: { documentId: docId }, orderBy: { versionNumber: "asc" } });
    expect(versions).toHaveLength(2);
    const onDisk = await readFile(versions[0].storagePath);
    expect(onDisk.toString("utf8")).not.toContain("Intelligent Systems");
    const dl = await request(app).get(`/api/documents/versions/${versions[0].id}/download`).set(auth()).buffer(true).parse((res, cb) => {
      const chunks: Buffer[] = [];
      res.on("data", (c: Buffer) => chunks.push(c));
      res.on("end", () => cb(null, Buffer.concat(chunks)));
    });
    expect((dl.body as Buffer).toString("utf8")).toBe(cv1);
  });

  it("proposes profile entries from a CV without importing them automatically", async () => {
    const v = await prisma.documentVersion.findFirst({ where: { documentId: docId, versionNumber: 1 } });
    const itemsBefore = await prisma.profileItem.count();
    const r = await request(app).post("/api/analyze-document").set(auth()).send({ versionId: v!.id });
    expect(r.status).toBe(200);
    const kinds = r.body.proposals.map((p: { kind: string }) => p.kind);
    expect(kinds).toContain("EDUCATION");
    expect(kinds).toContain("PUBLICATION");
    expect(r.body.proposals.find((p: { kind: string; title: string }) => p.kind === "PROGRAMMING_LANGUAGE" && p.title === "Python")).toBeTruthy();
    expect(await prisma.profileItem.count()).toBe(itemsBefore);
    const pub = r.body.proposals.find((p: { kind: string }) => p.kind === "PUBLICATION");
    await request(app).post("/api/profile/import").set(auth()).send({ proposals: [pub] }).expect(200);
    expect(await prisma.profileItem.count()).toBe(itemsBefore + 1);
  });
});

describe("applications", () => {
  let appId = "";
  it("builds an application package from the requirements and vault", async () => {
    const opp = await prisma.opportunity.findFirst({ where: { officialUrl: `${base}/phd/nlp` } });
    const r = await request(app).post("/api/applications").set(auth()).send({ opportunityId: opp!.id });
    expect(r.status).toBe(201);
    appId = r.body.application.id;
    const d = await request(app).get(`/api/applications/${appId}`).set(auth());
    const byKey = Object.fromEntries(d.body.documents.map((x: { requirementKey: string; status: string }) => [x.requirementKey, x.status]));
    expect(byKey.CV).toBe("READY");
    expect(byKey.RECOMMENDATION_LETTERS).toBe("MISSING");
    expect(byKey.ENGLISH_PROFICIENCY).toBe("PENDING");
    expect(d.body.readiness.note).toMatch(/not a probability/);
    expect(d.body.checklist.readyForFinalReview).toBe(false);
  });

  it("never marks an application submitted without explicit user confirmation", async () => {
    expect((await request(app).patch(`/api/applications/${appId}`).set(auth()).send({ stage: "SUBMITTED" })).status).toBe(409);
    expect((await request(app).post(`/api/applications/${appId}/confirm-submission`).set(auth()).send({ confirmation: "yes" })).status).toBe(400);
    const ok = await request(app).post(`/api/applications/${appId}/confirm-submission`).set(auth()).send({ confirmation: "I SUBMITTED THIS APPLICATION MYSELF", reference: "APP-123" });
    expect(ok.status).toBe(200);
    expect(ok.body.application.stage).toBe("SUBMITTED");
    expect(ok.body.application.submittedAt).toBeTruthy();
  });

  it("moves through pipeline stages", async () => {
    const r = await request(app).patch(`/api/applications/${appId}`).set(auth()).send({ stage: "INTERVIEW" });
    expect(r.body.application.stage).toBe("INTERVIEW");
  });
});

describe("document generation", () => {
  it("requires a master SOP and never generates from nothing", async () => {
    const opp = await prisma.opportunity.findFirst({ where: { officialUrl: `${base}/phd/us` } });
    const r = await request(app).post("/api/generate-sop").set(auth()).send({ opportunityId: opp!.id });
    expect(r.status).toBe(400);
  });

  it("tailors the master SOP, lists changes and flags unsupported claims", async () => {
    await request(app).put("/api/profile").set(auth()).send({ masterSop: "I am passionate about language technology for low-resource languages.\n\nDuring my Master's in Intelligent Systems I studied self-supervised learning.\n\nI hope to contribute to [UNIVERSITY]." }).expect(200);
    const opp = await prisma.opportunity.findFirst({ where: { officialUrl: `${base}/phd/us` } });
    const r = await request(app).post("/api/generate-sop").set(auth()).send({ opportunityId: opp!.id });
    expect(r.status).toBe(201);
    const g = r.body.generated;
    expect(g.content).toContain("Eastbrook University");
    expect(g.content).not.toContain("[UNIVERSITY]");
    expect(g.changes.map((c: { section: string }) => c.section)).toContain("Opening");
    const cmp = await request(app).get(`/api/generated/${g.id}`).set(auth());
    expect(cmp.body.comparison.some((p: { added: boolean }) => p.added)).toBe(true);

    const edited = await request(app).patch(`/api/generated/${g.id}`).set(auth()).send({ content: `${g.content}\n\nI published 7 papers at NeurIPS and won the Turing Award in 2024.` });
    const claims = edited.body.generated.warnings.map((w: { claim: string }) => w.claim);
    expect(claims).toEqual(expect.arrayContaining(["NeurIPS", "2024"]));
  });

  it("drafts supervisor emails that are never sent", async () => {
    const opp = await prisma.opportunity.findFirst({ where: { officialUrl: `${base}/phd/nlp` } });
    const r = await request(app).post("/api/email-drafts").set(auth()).send({ opportunityId: opp!.id, purpose: "INITIAL_CONTACT" });
    expect(r.status).toBe(201);
    expect(r.body.draft.status).toBe("DRAFT");
    expect(r.body.draft.to).toBe("a.okafor@cs.northvale.ac.uk");
    expect(r.body.draft.body).toContain("Dear Dr. Amara Okafor");
  });
});

describe("supervisor discovery", () => {
  it("keeps only official institutional emails from official pages", async () => {
    const opp = await prisma.opportunity.findFirst({ where: { officialUrl: `${base}/phd/nlp` } });
    const r = await request(app).post("/api/supervisors/discover").set(auth()).send({ url: "https://www.cs.northvale.ac.uk/people", html: fixture("faculty_page"), opportunityId: opp!.id });
    expect(r.status).toBe(200);
    const names = r.body.items.map((s: { name: string }) => s.name);
    expect(names[0]).toBe("Dr. Amara Okafor"); // most relevant to NLP / low-resource interests
    expect(r.body.items.every((s: { email: string }) => s.email.endsWith("northvale.ac.uk"))).toBe(true);
    const thirdParty = await request(app).post("/api/supervisors/discover").set(auth()).send({ url: "https://www.findaphd.com/x", html: fixture("faculty_page"), opportunityId: opp!.id });
    expect(thirdParty.status).toBe(400);
  });
});

describe("notification scheduling", () => {
  it("picks the right reminder threshold", () => {
    expect(thresholdFor(5, [30, 14, 7, 3, 1])).toBe(7);
    expect(thresholdFor(1, [30, 14, 7, 3, 1])).toBe(1);
    expect(thresholdFor(0, [30, 14, 7, 3, 1])).toBe(1);
    expect(thresholdFor(45, [30, 14, 7, 3, 1])).toBeNull();
    expect(thresholdFor(-1, [30, 14, 7, 3, 1])).toBeNull();
  });

  it("creates deadline reminders once, in the user's timezone", async () => {
    await prisma.notification.deleteMany({ where: { type: "DEADLINE" } });
    const now = new Date("2026-10-26T12:00:00Z"); // DE deadline 2026-10-31 → 5 days → 7-day reminder
    const a = await runNotificationScan(now);
    expect(a.created).toBeGreaterThan(0);
    const n = await prisma.notification.findFirst({ where: { type: "DEADLINE", title: { contains: "in 5 days" } } });
    expect(n).toBeTruthy();
    expect(n!.dedupeKey).toMatch(/:7$/);
    const b = await runNotificationScan(now);
    expect(await prisma.notification.count({ where: { type: "DEADLINE", title: { contains: "in 5 days" } } })).toBe(1);
    expect(b.created).toBe(0);
    const task = await prisma.task.findFirst({ where: { autoKey: { startsWith: "submit:" } } });
    expect(task).toBeTruthy();
  });
});

describe("discovery crawler", () => {
  it("discovers opportunities from a listing page, respecting robots.txt", async () => {
    await prisma.opportunity.deleteMany({ where: { officialUrl: `${base}/phd/de` } });
    const start = await request(app).post("/api/crawl").set(auth()).send({ urls: [`${base}/vacancies`] });
    expect(start.status).toBe(202);
    let job = start.body.job;
    for (let i = 0; i < 50 && job.status === "RUNNING"; i++) {
      await new Promise((r) => setTimeout(r, 100));
      job = (await request(app).get(`/api/crawl/${job.id}`).set(auth())).body.job;
    }
    expect(job.status).toBe("DONE");
    const urls = job.found.map((f: { url: string }) => f.url);
    expect(urls).toContain(`${base}/phd/de`);
    expect(urls).not.toContain(`${base}/about`);
    const de = job.found.find((f: { url: string }) => f.url === `${base}/phd/de`);
    expect(de.isNew).toBe(true);
    const nlp = job.found.find((f: { url: string }) => f.url === `${base}/phd/nlp`);
    expect(nlp.isNew).toBe(false); // deduplicated against the saved one
  });
});
