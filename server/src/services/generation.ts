import type { Prisma, Supervisor } from "@prisma/client";
import { diffWords } from "diff";
import { getProvider } from "../ai/provider.js";
import { fabricationCheck, type FabricationWarning } from "../ai/verify.js";
import { prisma } from "../db.js";
import type { ExtractionResult } from "../extraction/types.js";
import { HttpError } from "../http.js";
import { matchAnalysis } from "./matching.js";
import { getProfileBundle, verifiedProfileText, type ProfileBundle } from "./profile.js";

export type GenKind = "SOP" | "COVER_LETTER" | "RESEARCH_PROPOSAL";
export type Tone = "ACADEMIC" | "RESEARCH_FOCUSED" | "CONCISE" | "FORMAL";

export interface Change {
  section: string;
  original: string;
  customized: string;
  reason: string;
}

interface Ctx {
  bundle: ProfileBundle;
  ex: ExtractionResult;
  oppId: string;
  title: string;
  university: string;
  department: string | null;
  supervisor: string | null;
  matchedInterests: string[];
  relevantItems: { kind: string; title: string }[];
}

async function loadCtx(userId: string, opportunityId: string): Promise<Ctx> {
  const opp = await prisma.opportunity.findFirst({ where: { id: opportunityId, userId } });
  if (!opp) throw new HttpError(404, "Opportunity not found");
  const bundle = await getProfileBundle(userId);
  const ex = opp.extraction as unknown as ExtractionResult;
  const m = matchAnalysis(bundle, ex);
  const relevantTitles = new Set([...m.publicationAlignment.matched, ...m.experienceAlignment.matched]);
  return {
    bundle,
    ex,
    oppId: opp.id,
    title: ex.title.value ?? opp.title,
    university: ex.university.value ?? "[UNIVERSITY]",
    department: ex.department.value,
    supervisor: ex.supervisors[0]?.name ?? null,
    matchedInterests: m.researchAlignment.matched,
    relevantItems: bundle.items.filter((i) => i.verified && relevantTitles.has(i.title)).map((i) => ({ kind: i.kind, title: i.title })),
  };
}

/** Sources a generated document may draw on — used by the fabrication check. */
function sourceCorpus(c: Ctx, extra: string[] = []): string[] {
  const ex = c.ex;
  return [
    verifiedProfileText(c.bundle),
    [ex.title.value, ex.university.value, ex.department.value, ex.country.value, ex.city.value, ex.researchAreas.join(", "), ex.summary].filter(Boolean).join("\n"),
    ...ex.supervisors.map((s) => `${s.name} ${s.email ?? ""}`),
    ...ex.documents.map((d) => d.label),
    ...ex.deadlines.flatMap((d) => d.evidence.map((e) => e.snippet)),
    ex.funding.category.evidence.map((e) => e.snippet).join("\n"),
    new Date().toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric" }),
    String(new Date().getFullYear()),
    ...extra,
  ];
}

const list = (xs: string[]) => (xs.length <= 1 ? xs.join("") : `${xs.slice(0, -1).join(", ")} and ${xs[xs.length - 1]}`);

function replacePlaceholders(text: string, c: Ctx): { text: string; replaced: string[] } {
  const replaced: string[] = [];
  const map: [RegExp, string | null][] = [
    [/\[(UNIVERSITY|University|university)\]|\{\{\s*university\s*\}\}/g, c.university],
    [/\[(PROGRAM|PROGRAMME|Program|Programme|POSITION|Position)\]|\{\{\s*(program|programme|position)\s*\}\}/g, c.title],
    [/\[(DEPARTMENT|Department)\]|\{\{\s*department\s*\}\}/g, c.department],
    [/\[(SUPERVISOR|Supervisor)\]|\{\{\s*supervisor\s*\}\}/g, c.supervisor],
    [/\[(RESEARCH[_ ]AREA|Research Area)\]|\{\{\s*research_area\s*\}\}/g, c.matchedInterests[0] ?? c.ex.researchAreas[0] ?? null],
  ];
  let out = text;
  for (const [re, val] of map) {
    if (val && re.test(out)) {
      out = out.replace(re, val);
      replaced.push(val);
    }
  }
  return { text: out, replaced };
}

// ───────────────────────── Template generators (no AI) ─────────────────────────

function templateSop(c: Ctx, master: string): { content: string; changes: Change[] } {
  const changes: Change[] = [];
  const { text, replaced } = replacePlaceholders(master.trim(), c);
  if (replaced.length) changes.push({ section: "Placeholders", original: "[UNIVERSITY] / [PROGRAM] / …", customized: replaced.join(", "), reason: "Filled placeholders from your master SOP with facts from the official opportunity page." });
  const paras = text.split(/\n\s*\n/).map((p) => p.trim()).filter(Boolean);

  const opening = `I am applying for the ${c.title} at ${c.university}${c.department ? ` (${c.department})` : ""}.`;
  if (!paras.length) paras.push("[ADD YOUR MASTER SOP CONTENT]");
  if (!paras[0].includes(c.university)) {
    changes.push({ section: "Opening", original: paras[0], customized: `${opening} ${paras[0]}`, reason: "Names the specific position and university from the official source." });
    paras[0] = `${opening} ${paras[0]}`;
  }

  const why: string[] = [];
  if (c.matchedInterests.length) why.push(`This opportunity aligns closely with my research interests in ${list(c.matchedInterests.slice(0, 3).map((s) => s.toLowerCase()))}.`);
  else why.push(`[EXPLAIN HOW THIS OPPORTUNITY RELATES TO YOUR RESEARCH INTERESTS — the page's stated areas are: ${c.ex.researchAreas.join(", ") || "not stated"}.]`);
  if (c.relevantItems.length) why.push(`My ${c.relevantItems[0].kind === "PUBLICATION" ? "publication" : "work on"} “${c.relevantItems[0].title}” is directly relevant to this area.`);
  if (c.supervisor) why.push(`I would particularly value the opportunity to work with ${c.supervisor}. [ADD ONE SPECIFIC, GENUINE REASON — e.g. a paper of theirs you have read.]`);
  else why.push(`[ADD A SPECIFIC REASON FOR CHOOSING ${c.university.toUpperCase()} — e.g. a research group or recent work you have read.]`);
  const whyPara = why.join(" ");
  const insertAt = Math.max(1, paras.length - 1);
  paras.splice(insertAt, 0, whyPara);
  changes.push({ section: `Why ${c.university}`, original: "(new paragraph)", customized: whyPara, reason: "Connects your verified interests/work with the advertised research areas. Bracketed text must be completed by you." });

  const last = paras[paras.length - 1];
  if (!last.includes(c.university)) {
    const closing = `${last} I would welcome the opportunity to pursue doctoral research at ${c.university}.`;
    changes.push({ section: "Closing", original: last, customized: closing, reason: "Ties the closing to this university." });
    paras[paras.length - 1] = closing;
  }
  return { content: paras.join("\n\n"), changes };
}

function templateCoverLetter(c: Ctx, tone: Tone): { content: string; changes: Change[] } {
  const p = c.bundle.profile;
  const edu = c.bundle.education.filter((e) => e.verified);
  const current = edu.find((e) => e.status === "IN_PROGRESS") ?? edu[0];
  const date = new Date().toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric" });
  const salutation = c.supervisor ? `Dear ${c.supervisor},` : tone === "FORMAL" ? "Dear Members of the Selection Committee," : "Dear Hiring Committee,";
  const sign = tone === "FORMAL" || tone === "ACADEMIC" ? "Yours sincerely," : "Kind regards,";
  const degreeLine = current
    ? `I am currently ${current.status === "IN_PROGRESS" ? "completing" : "a graduate of"} a ${current.degree}${current.field ? ` in ${current.field}` : ""} at ${current.institution}${current.thesisTitle ? `, where my thesis is titled “${current.thesisTitle}”` : ""}.`
    : p.currentDegree
      ? `I am currently pursuing a ${p.currentDegree.replace(/\s*\(in progress\)/i, "")}${p.field ? ` in ${p.field}` : ""}.`
      : "[ADD YOUR CURRENT DEGREE AND INSTITUTION]";
  const exp = c.relevantItems.length
    ? `Relevant to this position, ${c.relevantItems.slice(0, 3).map((i) => `“${i.title}”`).join(", ")} ${c.relevantItems.length > 1 ? "reflect" : "reflects"} my experience in this area.`
    : "[ADD YOUR MOST RELEVANT PROJECT OR RESEARCH EXPERIENCE — only real, verifiable experience.]";
  const m = matchAnalysis(c.bundle, c.ex);
  const skills = m.technicalSkills.matched.length ? `The position calls for skills I use regularly, including ${list(m.technicalSkills.matched.slice(0, 5))}.` : "";
  const interests = c.matchedInterests.length ? `My research interests in ${list(c.matchedInterests.slice(0, 3).map((s) => s.toLowerCase()))} align with the focus of this position.` : "";
  const researchPara =
    tone === "RESEARCH_FOCUSED"
      ? `I am especially motivated by the research questions this position addresses. [DESCRIBE ONE OR TWO RESEARCH QUESTIONS YOU WOULD LIKE TO PURSUE, grounded in the advertised project.] ${interests}`
      : interests;
  const enclosures = c.ex.documents.filter((d) => d.necessity === "REQUIRED" && d.key !== "COVER_LETTER").map((d) => d.label);

  const opening =
    tone === "CONCISE"
      ? `I am applying for the ${c.title} at ${c.university}.`
      : `I am writing to apply for the ${c.title} at ${c.university}${c.department ? `, ${c.department}` : ""}. Having read the official position description, I believe my background is a good fit for this opportunity.`;
  const body = tone === "CONCISE" ? [opening, `${degreeLine} ${exp}`, skills + (interests ? ` ${interests}` : "")] : [opening, degreeLine, exp, skills, researchPara];
  const closing =
    tone === "CONCISE"
      ? "Thank you for your consideration."
      : `Thank you for considering my application. I would be glad to discuss how I could contribute to research at ${c.university}.`;
  const content = [
    [p.fullName ?? "[YOUR NAME]", p.contactEmail, p.phone].filter(Boolean).join(" · "),
    date,
    "",
    salutation,
    "",
    ...body.filter((x) => x && x.trim()).flatMap((x) => [x, ""]),
    closing,
    "",
    sign,
    p.fullName ?? "[YOUR NAME]",
    ...(enclosures.length ? ["", `Enclosures: ${enclosures.join("; ")}`] : []),
  ].join("\n");
  const changes: Change[] = [
    { section: "Opening", original: "", customized: opening, reason: "References the exact position and university from the official source." },
    { section: "Background", original: "", customized: degreeLine, reason: "Uses only your verified education entries." },
    { section: "Relevant experience", original: "", customized: exp, reason: c.relevantItems.length ? "Selected from your verified profile items that share topics with the position." : "No matching verified experience — placeholder left for you." },
  ];
  if (enclosures.length) changes.push({ section: "Enclosures", original: "", customized: enclosures.join("; "), reason: "Lists the documents the source says are required." });
  return { content, changes };
}

function templateProposal(c: Ctx): { content: string; changes: Change[] } {
  const skills = [...(c.bundle.profile.skills as string[]), ...(c.bundle.profile.programmingLanguages as string[])];
  const areas = c.matchedInterests.length ? c.matchedInterests : c.ex.researchAreas;
  const thesis = c.bundle.education.find((e) => e.verified && e.thesisTitle)?.thesisTitle;
  const a1 = areas[0] ?? "[AREA]";
  const a2 = areas[1] ?? "[APPLICATION DOMAIN]";
  const content = `RESEARCH PROPOSAL — DRAFT
Position: ${c.title} — ${c.university}

1. Working title
[WORKING TITLE] — suggested direction: ${a1}${areas[1] ? ` for ${a2}` : ""}

2. Background and motivation
${thesis ? `This proposal builds on my Master's thesis, “${thesis}”.` : "[SUMMARISE YOUR MASTER'S RESEARCH OR THE WORK THAT MOTIVATES THIS PROPOSAL.]"} My research interests include ${list(c.bundle.interests.slice(0, 4).map((i) => i.name.toLowerCase()))}.
${c.relevantItems.length ? `Relevant prior work: ${c.relevantItems.map((i) => `“${i.title}”`).join(", ")}.` : "[ADD ANY RELEVANT PUBLICATIONS OR PROJECTS — only real work.]"}
[CITE 3–5 KEY PAPERS FROM THE FIELD AND FROM THE TARGET GROUP.]

3. Research questions (suggestions — rewrite in your own words)
RQ1: [e.g. How can ${a1.toLowerCase()} methods be adapted to ${a2.toLowerCase()}?]
RQ2: [e.g. What evaluation methodology is appropriate for …?]
RQ3: [OPTIONAL]

4. Methodology
[DESCRIBE DATA, METHODS AND EVALUATION.] ${skills.length ? `Tools and skills from my profile relevant to the methodology: ${skills.slice(0, 8).join(", ")}.` : ""}

5. Fit with ${c.university}${c.supervisor ? ` and ${c.supervisor}` : ""}
The advertised research areas (${c.ex.researchAreas.join(", ") || "see source"}) overlap with this proposal. [EXPLAIN SPECIFICALLY HOW YOUR PROPOSAL CONNECTS TO THE GROUP'S CURRENT WORK.]

6. Indicative timeline (suggested structure — adapt to the programme length)
Year 1: literature review, baseline replication, first research question.
Year 2: core methods and experiments, first publications.
Year 3: extensions, evaluation, thesis writing.

7. Expected contributions
[LIST 2–3 CONCRETE, REALISTIC CONTRIBUTIONS.]

8. References
[ADD REFERENCES]`;
  return {
    content,
    changes: [
      { section: "Structure", original: "", customized: "8-section proposal skeleton", reason: "Standard PhD proposal structure; bracketed parts must be written by you." },
      { section: "Background", original: "", customized: thesis ?? "(placeholder)", reason: "Uses your verified thesis title and research interests only." },
      { section: "Fit", original: "", customized: c.ex.researchAreas.join(", "), reason: "Research areas taken from the official opportunity page." },
    ],
  };
}

// ───────────────────────── AI path (optional) ─────────────────────────

const AI_SYSTEM = `You help a PhD applicant tailor application documents.
Hard rules:
- Use ONLY facts from the applicant's VERIFIED PROFILE and the OPPORTUNITY FACTS provided. Never invent publications, projects, awards, skills, grades, supervisors, research experience, numbers or achievements.
- If a strong document needs information that is missing, insert a bracketed placeholder like [ADD: specific reason you chose this group] instead of making something up.
- Keep the applicant's own voice; preserve their master text where possible.
- Output plain text only (no markdown headings unless the document type needs sections).`;

async function aiGenerate(kind: GenKind, c: Ctx, base: string, tone: Tone): Promise<{ content: string; provider: string } | null> {
  const provider = getProvider();
  if (!provider) return null;
  const facts = {
    position: c.title,
    university: c.university,
    department: c.department,
    researchAreas: c.ex.researchAreas,
    supervisorNamedOnPage: c.supervisor,
    requiredDocuments: c.ex.documents.filter((d) => d.necessity === "REQUIRED").map((d) => d.label),
    matchedInterests: c.matchedInterests,
  };
  const instructions: Record<GenKind, string> = {
    SOP: "Rewrite the MASTER SOP into a version tailored to this opportunity. Keep its structure and all true content; tailor the opening, add a paragraph on why this specific opportunity, and tailor the closing.",
    COVER_LETTER: `Write a cover letter for this position in a ${tone.toLowerCase().replace("_", "-")} tone (about 350 words; CONCISE tone about 200 words).`,
    RESEARCH_PROPOSAL: "Draft a research proposal skeleton (title, background, research questions, methodology, fit, timeline, contributions, references) with the applicant's real background filled in and placeholders elsewhere.",
  };
  try {
    const content = await provider.complete({
      system: AI_SYSTEM,
      prompt: `${instructions[kind]}

VERIFIED PROFILE:
${verifiedProfileText(c.bundle)}

OPPORTUNITY FACTS (from the official source):
${JSON.stringify(facts, null, 2)}

${base ? `MASTER TEXT:\n${base}` : ""}`,
      maxTokens: 8000,
    });
    return { content, provider: provider.name };
  } catch {
    return null;
  }
}

// ───────────────────────── Public API ─────────────────────────

export async function generateDocument(userId: string, opts: { opportunityId: string; kind: GenKind; tone?: Tone; useAI?: boolean; masterText?: string }) {
  const c = await loadCtx(userId, opts.opportunityId);
  const tone = opts.tone ?? "ACADEMIC";
  let base = "";
  if (opts.kind === "SOP") {
    base = opts.masterText ?? c.bundle.profile.masterSop ?? "";
    if (!base.trim()) {
      const latest = await prisma.documentVersion.findFirst({ where: { document: { userId, type: "SOP" }, extractedText: { not: null } }, orderBy: { createdAt: "desc" } });
      base = latest?.extractedText ?? "";
    }
    if (!base.trim()) throw new HttpError(400, "Add your master SOP first (Research → Master SOP, or upload an SOP in Documents). The generator only tailors your own text.");
  }
  if (opts.kind === "COVER_LETTER") base = c.bundle.profile.masterCoverLetter ?? "";

  const template = opts.kind === "SOP" ? templateSop(c, base) : opts.kind === "COVER_LETTER" ? templateCoverLetter(c, tone) : templateProposal(c);
  let content = template.content;
  let provider = "TEMPLATE";
  let changes = template.changes;
  if (opts.useAI) {
    const ai = await aiGenerate(opts.kind, c, base, tone);
    if (ai) {
      content = ai.content;
      provider = ai.provider;
      changes = [{ section: "Whole document", original: base ? "(master text)" : "", customized: "(AI-tailored draft)", reason: "Tailored by the AI provider from your verified profile and the official opportunity facts. Review every sentence." }];
    }
  }
  const warnings: FabricationWarning[] = fabricationCheck(content, sourceCorpus(c, [base]));
  const app = await prisma.application.findUnique({ where: { userId_opportunityId: { userId, opportunityId: c.oppId } } });
  const previous = await prisma.generatedDocument.count({ where: { userId, opportunityId: c.oppId, kind: opts.kind } });
  const kindLabel = opts.kind === "SOP" ? "SOP" : opts.kind === "COVER_LETTER" ? "Cover letter" : "Research proposal";
  return prisma.generatedDocument.create({
    data: {
      userId,
      opportunityId: c.oppId,
      applicationId: app?.id,
      kind: opts.kind,
      tone,
      title: `${kindLabel} — ${c.university} — v${previous + 1}`,
      content,
      baseContent: base || null,
      changes: changes as unknown as Prisma.InputJsonValue,
      warnings: warnings as unknown as Prisma.InputJsonValue,
      provider,
      version: previous + 1,
    },
  });
}

/** Word-level comparison of a generated SOP with the master version. */
export function compareWithMaster(base: string, content: string) {
  return diffWords(base, content).map((p) => ({ value: p.value, added: !!p.added, removed: !!p.removed }));
}

export async function recheckGenerated(userId: string, id: string, content: string) {
  const g = await prisma.generatedDocument.findFirst({ where: { id, userId } });
  if (!g) throw new HttpError(404, "Draft not found");
  if (!g.opportunityId) return prisma.generatedDocument.update({ where: { id }, data: { content } });
  const c = await loadCtx(userId, g.opportunityId);
  const warnings = fabricationCheck(content, sourceCorpus(c, [g.baseContent ?? ""]));
  return prisma.generatedDocument.update({ where: { id }, data: { content, warnings: warnings as unknown as Prisma.InputJsonValue, status: "DRAFT" } });
}

// ───────────────────────── Supervisor emails ─────────────────────────

export type EmailPurpose = "INITIAL_CONTACT" | "AVAILABILITY" | "FUNDING" | "RESEARCH_INTEREST" | "FOLLOW_UP" | "CLARIFICATION";

export async function draftEmail(userId: string, opts: { opportunityId?: string; supervisorId?: string; purpose: EmailPurpose; question?: string }) {
  let supervisor: Supervisor | null = null;
  if (opts.supervisorId) {
    supervisor = await prisma.supervisor.findUnique({ where: { id: opts.supervisorId } });
    if (!supervisor) throw new HttpError(404, "Supervisor not found");
  }
  const bundle = await getProfileBundle(userId);
  const p = bundle.profile;
  let c: Ctx | null = null;
  if (opts.opportunityId) c = await loadCtx(userId, opts.opportunityId);
  const name = supervisor?.name ?? c?.supervisor ?? null;
  const greet = name ? `Dear ${name},` : "Dear Professor [SURNAME],";
  const me = p.fullName ?? "[YOUR NAME]";
  const degree = p.currentDegree ? `I am currently pursuing a ${p.currentDegree.replace(/\s*\(in progress\)/i, "")}${p.field ? ` (${p.field})` : ""}.` : "[ADD YOUR CURRENT DEGREE]";
  const interests = c?.matchedInterests.length ? c.matchedInterests : bundle.interests.slice(0, 3).map((i) => i.name);
  const supAreas = (supervisor?.researchAreas as string[] | undefined) ?? [];
  const overlap = supAreas.filter((a) => interests.some((i) => i.toLowerCase() === a.toLowerCase()));
  const topic = c ? `the ${c.title} at ${c.university}` : `doctoral opportunities in your group${supervisor?.department ? ` (${supervisor.department})` : ""}`;
  const workLine = c?.relevantItems.length ? `My work on “${c.relevantItems[0].title}” is closely related.` : "[ADD ONE RELEVANT PROJECT OR PAPER OF YOURS — only real work.]";
  const theirWork = "[MENTION ONE SPECIFIC PAPER OR PROJECT OF THEIRS THAT YOU HAVE ACTUALLY READ, AND WHY IT INTERESTS YOU.]";

  const bodies: Record<EmailPurpose, { subject: string; body: string }> = {
    INITIAL_CONTACT: {
      subject: `Prospective PhD applicant — ${interests[0] ?? "research interest"}${c ? ` (${c.title})` : ""}`,
      body: `${greet}\n\nMy name is ${me}. ${degree} I am writing to express my interest in ${topic}.\n\nMy research interests include ${list(interests.map((s) => s.toLowerCase()))}${overlap.length ? `, which overlap with your work on ${list(overlap.map((s) => s.toLowerCase()))}` : ""}. ${theirWork} ${workLine}\n\nI would be grateful to know whether you expect to supervise new PhD students and whether you would be open to a short conversation. I have attached my CV for your reference.\n\nKind regards,\n${me}${p.contactEmail ? `\n${p.contactEmail}` : ""}`,
    },
    AVAILABILITY: {
      subject: `Enquiry about PhD supervision availability`,
      body: `${greet}\n\nMy name is ${me}. ${degree} I am planning to apply for ${topic} and would like to ask whether you are accepting new PhD students for the upcoming intake.\n\n${theirWork}\n\nThank you for your time.\n\nKind regards,\n${me}`,
    },
    FUNDING: {
      subject: `Question about funding for ${c ? c.title : "PhD positions"}`,
      body: `${greet}\n\nMy name is ${me}. ${degree} I am interested in ${topic}. Could you let me know whether funding (tuition coverage and a stipend or salary) is available for this position, and whether it is guaranteed or competitive?\n\nKind regards,\n${me}`,
    },
    RESEARCH_INTEREST: {
      subject: `Research interest in ${interests[0] ?? "your group's work"}`,
      body: `${greet}\n\nMy name is ${me}. ${degree} I have been following work in ${list(interests.slice(0, 2).map((s) => s.toLowerCase()))}. ${theirWork}\n\n${workLine} I would value any advice on how I might contribute to your group as a PhD student.\n\nKind regards,\n${me}`,
    },
    FOLLOW_UP: {
      subject: `Follow-up: prospective PhD applicant`,
      body: `${greet}\n\nI am following up on my email from [DATE] regarding ${topic}. I understand you are busy, and I would be grateful for any brief response on whether you are considering new PhD students.\n\nKind regards,\n${me}`,
    },
    CLARIFICATION: {
      subject: `Question about the application for ${c ? c.title : "the PhD programme"}`,
      body: `${greet}\n\nI am preparing an application for ${topic} and would like to clarify the following: ${opts.question ?? "[YOUR QUESTION — e.g. whether IELTS results can be submitted after the application deadline]"}\n\nThank you for your help.\n\nKind regards,\n${me}`,
    },
  };
  const draft = bodies[opts.purpose];
  const corpus = [verifiedProfileText(bundle), c ? sourceCorpus(c).join("\n") : "", supervisor ? `${supervisor.name} ${supervisor.department ?? ""} ${supAreas.join(" ")}` : "", opts.question ?? ""];
  const warnings = fabricationCheck(draft.body, corpus);
  return prisma.emailDraft.create({
    data: {
      userId,
      opportunityId: opts.opportunityId,
      supervisorId: supervisor?.id,
      purpose: opts.purpose,
      to: supervisor?.email ?? c?.ex.supervisors[0]?.email ?? null,
      subject: draft.subject,
      body: draft.body,
      warnings: warnings as unknown as Prisma.InputJsonValue,
    },
  });
}
