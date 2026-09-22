import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { extractOpportunity } from "../src/extraction/index.js";
import { extractDeadlines } from "../src/extraction/deadlines.js";
import { extractEnglish } from "../src/extraction/english.js";
import { extractFee } from "../src/extraction/fees.js";
import { extractFunding } from "../src/extraction/funding.js";
import { extractDocuments } from "../src/extraction/documents.js";
import { findDates, daysUntil, urgencyFor } from "../src/extraction/dates.js";
import { findMoney, type ExtractCtx } from "../src/extraction/common.js";
import { htmlToPageText } from "../src/extraction/text.js";
import { classifySource, normalizeUrl, registrableDomain } from "../src/extraction/source.js";

const REF = new Date("2026-09-22T12:00:00Z");
const fixture = (name: string) => readFileSync(new URL(`./fixtures/${name}.html`, import.meta.url), "utf8");
const extract = (name: string, url: string) => extractOpportunity(fixture(name), url, { referenceDate: REF });

const ctx: ExtractCtx = {
  url: "https://www.cs.example.ac.uk/phd",
  sourceType: "OFFICIAL_UNIVERSITY",
  pageTitle: "Test",
  accessedAt: REF.toISOString(),
  referenceDate: REF,
  dayFirst: true,
};
const segs = (html: string) => htmlToPageText(`<html><body>${html}</body></html>`, ctx.url).segments;

describe("date parsing", () => {
  it("parses textual, numeric and ISO dates", () => {
    expect(findDates("Deadline: 30 November 2026", REF)[0].date).toBe("2026-11-30");
    expect(findDates("Closing date 15.01.2027", REF)[0].date).toBe("2027-01-15");
    expect(findDates("due 2026-12-15", REF)[0].date).toBe("2026-12-15");
  });
  it("flags missing years instead of silently assuming them", () => {
    const d = findDates("Apply by December 1 for fall admission.", REF)[0];
    expect(d.yearInferred).toBe(true);
  });
  it("flags ambiguous numeric formats", () => {
    expect(findDates("03/04/2027", REF)[0].ambiguousFormat).toBe(true);
    expect(findDates("25/04/2027", REF)[0].ambiguousFormat).toBe(false);
  });
  it("ignores relative expressions", () => {
    expect(findDates("Interviews in the week of", REF)).toHaveLength(0);
    expect(findDates("Posted on Monday", REF)).toHaveLength(0);
  });
  it("captures time and timezone", () => {
    const d = findDates("Application deadline: 15 January 2027, 23:59 GMT", REF)[0];
    expect(d.time).toBe("23:59");
    expect(d.timezone).toBe("GMT");
  });
  it("computes urgency buckets", () => {
    expect(urgencyFor(daysUntil("2026-09-24", REF))).toBe("CRITICAL");
    expect(urgencyFor(daysUntil("2026-09-28", REF))).toBe("URGENT");
    expect(urgencyFor(daysUntil("2026-10-05", REF))).toBe("SOON");
    expect(urgencyFor(daysUntil("2026-10-20", REF))).toBe("UPCOMING");
    expect(urgencyFor(daysUntil("2027-01-20", REF))).toBe("LATER");
    expect(urgencyFor(daysUntil("2026-09-01", REF))).toBe("CLOSED");
    expect(urgencyFor(null)).toBe("UNKNOWN");
  });
});

describe("deadline extraction", () => {
  it("keeps application, funding and opening deadlines separate", () => {
    const r = extractDeadlines(
      segs(`<p>Applications open 1 October 2026 and close 30 November 2026.</p>
            <p>To be considered for scholarship funding, applications must be received by 1 November 2026.</p>
            <p>Expected start date: 1 October 2027.</p>`),
      ctx,
    );
    const kinds = Object.fromEntries(r.deadlines.map((d) => [d.kind, d.date]));
    expect(kinds.OPENING).toBe("2026-10-01");
    expect(kinds.APPLICATION).toBe("2026-11-30");
    expect(kinds.SCHOLARSHIP).toBe("2026-11-01");
    expect(kinds.START_DATE).toBe("2027-10-01");
  });
  it("labels multiple rounds instead of reporting a conflict", () => {
    const r = extractDeadlines(segs(`<p>Application deadlines: Round 1: 1 December 2026; Round 2: 15 February 2027</p>`), ctx);
    expect(r.deadlines.filter((d) => d.kind === "APPLICATION")).toHaveLength(2);
    expect(r.conflicts).toHaveLength(0);
  });
  it("does not treat interview dates as deadlines", () => {
    const r = extractDeadlines(segs(`<p>Application deadline: 15 January 2027. Interviews are expected on 8 February 2027.</p>`), ctx);
    expect(r.deadlines.filter((d) => d.kind === "APPLICATION").map((d) => d.date)).toEqual(["2027-01-15"]);
  });
  it("marks conflicting application deadlines", () => {
    const r = extract("conflicting_deadlines", "https://grad.southport.edu.au/phd-ds");
    expect(r.conflicts[0].field).toBe("deadline.APPLICATION");
    expect(r.deadlines.filter((d) => d.kind === "APPLICATION").every((d) => d.certainty === "CONFLICTING")).toBe(true);
  });
  it("detects rolling admissions", () => {
    const r = extractDeadlines(segs(`<p>Applications will be reviewed on a rolling basis until the position is filled.</p>`), ctx);
    expect(r.rolling.value).toBe(true);
  });
  it("returns no deadline rather than inventing one", () => {
    const r = extractOpportunity("<html><body><h1>PhD in AI</h1><p>We welcome applications.</p></body></html>", ctx.url, { referenceDate: REF });
    expect(r.deadlines).toHaveLength(0);
    expect(r.warnings.join(" ")).toMatch(/DEADLINE UNKNOWN/);
  });
});

describe("funding extraction", () => {
  it("recognises explicit full funding with stipend and tuition", () => {
    const f = extract("uk_funded_studentship", "https://www.cs.northvale.ac.uk/phd/nlp").funding;
    expect(f.category.value).toBe("FULLY_FUNDED");
    expect(f.category.certainty).toBe("VERIFIED");
    expect(f.tuition.value).toBe("COVERED");
    expect(f.stipend.value).toMatchObject({ amount: 19237, currency: "GBP", period: "YEAR" });
    expect(f.duration.value).toBe("3.5 years");
  });
  it("never infers full funding from a bare scholarship mention", () => {
    const f = extractFunding(segs(`<p>Scholarships are available for outstanding students.</p>`), ctx);
    expect(f.category.value).toBe("SCHOLARSHIP_AVAILABLE");
    expect(f.category.value).not.toBe("FULLY_FUNDED");
  });
  it("treats competitive funding as competitive", () => {
    const f = extractFunding(segs(`<p>A limited number of fully funded places are awarded on a competitive basis.</p>`), ctx);
    expect(f.category.value).toBe("FUNDING_COMPETITIVE");
  });
  it("detects salaried positions and benefits", () => {
    const f = extract("de_salaried_position", "https://jobs.tu-lindenberg.de/4711").funding;
    expect(f.salary.value).toMatch(/E13/);
    expect(f.benefits.map((b) => b.benefit)).toContain("Travel / conference allowance");
  });
  it("detects self-funded positions", () => {
    const f = extractFunding(segs(`<p>This is a self-funded project; applicants must secure their own funding.</p>`), ctx);
    expect(f.category.value).toBe("SELF_FUNDED");
  });
  it("returns UNKNOWN when nothing is stated", () => {
    const f = extractFunding(segs(`<p>Join our friendly research group.</p>`), ctx);
    expect(f.category.value).toBeNull();
    expect(f.category.certainty).toBe("UNKNOWN");
  });
  it("parses money amounts in several formats", () => {
    expect(findMoney("stipend of €2,500 per month")[0]).toMatchObject({ amount: 2500, currency: "EUR", period: "MONTH" });
    expect(findMoney("salary SEK 34 600 per month")[0]).toMatchObject({ amount: 34600, currency: "SEK" });
    expect(findMoney("3.200 EUR monthly")[0]).toMatchObject({ amount: 3200, currency: "EUR" });
  });
});

describe("application fee extraction", () => {
  it("detects free applications", () => {
    const f = extractFee(segs(`<p>There is no application fee for postgraduate research applications.</p>`), ctx);
    expect(f.status.value).toBe("FREE");
  });
  it("extracts fee amount and waiver", () => {
    const f = extract("us_program", "https://cs.eastbrook.edu/phd/admissions").fee;
    expect(f.status.value).toBe("FEE_REQUIRED");
    expect(f.amount.value).toMatchObject({ amount: 90, currency: "USD" });
    expect(f.waiver.value).toBe("AVAILABLE");
    expect(f.waiverEligibility).toMatch(/McNair/);
  });
  it("does not call an application free when other mandatory costs exist", () => {
    const f = extractFee(segs(`<p>There is no application fee.</p><p>International applicants must apply via uni-assist, which charges a processing fee of €75.</p>`), ctx);
    expect(f.status.value).toBe("FREE");
    expect(f.status.note).toMatch(/other mandatory costs/);
    expect(f.otherMandatoryCosts[0].label).toMatch(/uni-assist/);
  });
  it("is UNKNOWN when fees are not mentioned", () => {
    expect(extractFee(segs(`<p>Apply online.</p>`), ctx).status.value).toBeNull();
  });
});

describe("English (IELTS/TOEFL) extraction", () => {
  it("detects proof allowed after admission with scores", () => {
    const e = extract("uk_funded_studentship", "https://www.cs.northvale.ac.uk/phd/nlp").english;
    expect(e.status.value).toBe("REQUIRED_LATER");
    expect(e.canApplyBeforeResult.value).toBe(true);
    expect(e.conditionalAdmission.value).toBe(true);
    const ielts = e.tests.find((t) => t.test === "IELTS")!;
    expect(ielts.minOverall).toBe(6.5);
    expect(ielts.minSection).toBe(6);
    expect(e.waivers[0].reason).toBe("ENGLISH_MEDIUM_DEGREE");
    expect(e.summary).toMatch(/NOT REQUIRED AT INITIAL APPLICATION/);
  });
  it("detects proof required at application", () => {
    const e = extract("us_program", "https://cs.eastbrook.edu/phd/admissions").english;
    expect(e.status.value).toBe("REQUIRED_AT_APPLICATION");
    expect(e.canApplyBeforeResult.value).toBe(false);
    expect(e.tests.map((t) => [t.test, t.minOverall])).toEqual(expect.arrayContaining([["TOEFL", 90], ["IELTS", 7]]));
  });
  it("detects proof before enrolment", () => {
    const e = extractEnglish(segs(`<p>Proof of English proficiency (IELTS 6.5) is not required at the time of application but must be submitted before enrolment.</p>`), ctx);
    expect(e.status.value).toBe("REQUIRED_LATER");
    expect(e.stage.value).toBe("BEFORE_ENROLMENT");
  });
  it("flags requirements without a stage as needing verification", () => {
    const e = extract("de_salaried_position", "https://jobs.tu-lindenberg.de/4711").english;
    expect(e.status.value).toBe("REQUIRED_STAGE_UNCLEAR");
    expect(e.summary).toMatch(/NEEDS VERIFICATION/);
  });
  it("marks hedged wording as needing manual verification", () => {
    const e = extract("conflicting_deadlines", "https://grad.southport.edu.au/phd-ds").english;
    expect(e.status.value).toBe("NEEDS_VERIFICATION");
  });
  it("detects explicit 'not required'", () => {
    const e = extractEnglish(segs(`<p>An English language test is not required for this programme.</p>`), ctx);
    expect(e.status.value).toBe("NOT_REQUIRED");
  });
  it("reports conflicting statements rather than picking one", () => {
    const e = extractEnglish(
      segs(`<p>You must submit IELTS scores with your application by the application deadline.</p><p>IELTS results can be submitted later, before enrolment.</p>`),
      ctx,
    );
    expect(e.status.value).toBe("NEEDS_VERIFICATION");
    expect(e.status.certainty).toBe("CONFLICTING");
  });
  it("returns UNKNOWN when English is not mentioned", () => {
    expect(extractEnglish(segs(`<p>Apply online.</p>`), ctx).status.value).toBeNull();
  });
});

describe("document requirement extraction", () => {
  it("extracts list items with constraints", () => {
    const docs = extract("uk_funded_studentship", "https://www.cs.northvale.ac.uk/phd/nlp").documents;
    const by = Object.fromEntries(docs.map((d) => [d.key, d]));
    expect(by.CV.necessity).toBe("REQUIRED");
    expect(by.CV.maxPages).toBe(2);
    expect(by.COVER_LETTER.format).toBe("PDF");
    expect(by.RECOMMENDATION_LETTERS.count).toBe(2);
    expect(by.RESEARCH_PROPOSAL.necessity).toBe("OPTIONAL");
    expect(by.RESEARCH_PROPOSAL.maxWords).toBe(1500);
  });
  it("marks documents that are explicitly not required", () => {
    const docs = extract("us_program", "https://cs.eastbrook.edu/phd/admissions").documents;
    expect(docs.find((d) => d.key === "GRE")?.necessity).toBe("NOT_REQUIRED");
    expect(docs.find((d) => d.key === "WRITING_SAMPLE")?.necessity).toBe("OPTIONAL");
    expect(docs.find((d) => d.key === "RECOMMENDATION_LETTERS")?.count).toBe(3);
  });
  it("extracts documents from prose", () => {
    const docs = extractDocuments(segs(`<p>Your application should include a motivation letter, a CV, copies of your degree certificates and transcripts, and the names of two referees.</p>`), ctx);
    expect(docs.map((d) => d.key).sort()).toEqual(["CV", "DEGREE_CERTIFICATE", "MOTIVATION_LETTER", "RECOMMENDATION_LETTERS", "TRANSCRIPTS"]);
    expect(docs.every((d) => d.necessity === "REQUIRED")).toBe(true);
  });
});

describe("source verification", () => {
  it("classifies official, portal, government and third-party sources", () => {
    expect(classifySource("https://www.cs.ox.ac.uk/phd").type).toBe("OFFICIAL_UNIVERSITY");
    expect(classifySource("https://cs.stanford.edu/admissions").type).toBe("OFFICIAL_UNIVERSITY");
    expect(classifySource("https://www.tu-berlin.de/jobs").type).toBe("OFFICIAL_UNIVERSITY");
    expect(classifySource("https://www.jobbnorge.no/en/available-jobs/job/1").type).toBe("INSTITUTIONAL_PORTAL");
    expect(classifySource("https://www.daad.de/en/").type).toBe("GOVERNMENT");
    expect(classifySource("https://www.findaphd.com/phds/project/x").type).toBe("THIRD_PARTY");
    expect(classifySource("https://some-blog.example.com/phd").type).toBe("UNKNOWN");
    expect(classifySource("https://thenextweb.com/news").type).toBe("UNKNOWN");
  });
  it("uses the user's university domain list", () => {
    expect(classifySource("https://careers.myuni.example/job/1", ["myuni.example"]).type).toBe("OFFICIAL_UNIVERSITY");
  });
  it("marks third-party facts as POSSIBLE and warns", () => {
    const r = extract("third_party_listing", "https://www.findaphd.com/phds/project/123");
    expect(r.sourceType).toBe("THIRD_PARTY");
    expect(r.funding.category.certainty).toBe("POSSIBLE");
    expect(r.deadlines[0].certainty).toBe("POSSIBLE");
    expect(r.warnings[0]).toMatch(/THIRD-PARTY/);
  });
  it("stores evidence with URL, snippet and access date for every critical fact", () => {
    const r = extract("uk_funded_studentship", "https://www.cs.northvale.ac.uk/phd/nlp");
    for (const f of [r.funding.category, r.fee.status, r.english.status]) {
      expect(f.evidence[0].sourceUrl).toBe("https://www.cs.northvale.ac.uk/phd/nlp");
      expect(f.evidence[0].snippet.length).toBeGreaterThan(10);
      expect(f.evidence[0].accessedAt).toBe(r.accessedAt);
    }
    expect(r.deadlines[0].evidence[0].snippet).toMatch(/15 January 2027/);
  });
  it("normalises URLs for deduplication", () => {
    expect(normalizeUrl("http://www.Example.ac.uk/phd/?utm_source=x&b=2&a=1#top")).toBe("https://example.ac.uk/phd?a=1&b=2");
    expect(normalizeUrl("https://example.ac.uk/phd/")).toBe(normalizeUrl("https://www.example.ac.uk/phd"));
    expect(registrableDomain("cs.ox.ac.uk")).toBe("ox.ac.uk");
  });
});

describe("full-page extraction", () => {
  it("extracts metadata from JSON-LD", () => {
    const r = extract("de_salaried_position", "https://jobs.tu-lindenberg.de/4711");
    expect(r.university.value).toBe("Technische Universität Lindenberg");
    expect(r.country.value).toBe("Germany");
    expect(r.city.value).toBe("Lindenberg");
    expect(r.deadlines.find((d) => d.kind === "APPLICATION")?.date).toBe("2026-10-31");
    expect(r.applyUrl.value).toBe("https://jobs.tu-lindenberg.de/apply/4711");
  });
  it("detects closed positions", () => {
    const r = extract("closed_position", "https://www.westmoor.ac.uk/phd-cv");
    expect(r.positionStatus.value).toBe("CLOSED");
  });
  it("finds named supervisors with emails shown on the page", () => {
    const r = extract("uk_funded_studentship", "https://www.cs.northvale.ac.uk/phd/nlp");
    expect(r.supervisors[0]).toMatchObject({ name: "Dr. Amara Okafor", email: "a.okafor@cs.northvale.ac.uk" });
  });
  it("country inferred from domain is never VERIFIED", () => {
    const r = extract("us_program", "https://cs.eastbrook.edu/phd/admissions");
    expect(r.country.certainty).not.toBe("VERIFIED");
  });
});
