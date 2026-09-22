import { evidence, fact, unknown, type ExtractCtx } from "./common.js";
import { countryFromHost, hostOf, KNOWN_COUNTRIES, registrableDomain } from "./source.js";
import type { PageText } from "./text.js";
import type { Fact, SupervisorMention } from "./types.js";

export const RESEARCH_AREAS: { name: string; re: RegExp }[] = [
  { name: "Artificial Intelligence", re: /\b(artificial intelligence|\bAI\b)/ },
  { name: "Machine Learning", re: /\bmachine learning\b/i },
  { name: "Deep Learning", re: /\b(deep learning|neural networks?)\b/i },
  { name: "Large Language Models", re: /\b(large language models?|LLMs?|foundation models?|generative AI)\b/i },
  { name: "Natural Language Processing", re: /\b(natural language processing|NLP|computational linguistics|language technolog(y|ies))\b/i },
  { name: "Computer Vision", re: /\b(computer vision|image (analysis|processing|understanding)|visual recognition)\b/i },
  { name: "Data Science", re: /\b(data science|data mining|big data|data analytics)\b/i },
  { name: "Intelligent Systems", re: /\bintelligent systems?\b/i },
  { name: "Computer Science", re: /\bcomputer science\b/i },
  { name: "Cybersecurity", re: /\b(cyber ?security|information security|computer security|network security|privacy|cryptograph(y|ic))\b/i },
  { name: "Dependable and Secure Computing", re: /\b(dependab(le|ility)|secure computing|fault[- ]toleran(t|ce)|resilien(t|ce) (systems|computing)|trustworthy (AI|systems|computing))\b/i },
  { name: "Low-resource Languages", re: /\b(low[- ]resource(d)? languages?|under[- ]resourced languages?|multilingual)\b/i },
  { name: "Conversational AI", re: /\b(conversational (AI|agents?|systems?)|dialog(ue)? systems?|chatbots?|spoken dialog)\b/i },
  { name: "Self-supervised Learning", re: /\b(self[- ]supervised|representation learning|contrastive learning)\b/i },
  { name: "Reinforcement Learning", re: /\breinforcement learning\b/i },
  { name: "Robotics", re: /\brobotics?\b/i },
  { name: "Human-Computer Interaction", re: /\b(human[- ]computer interaction|HCI)\b/i },
  { name: "Speech Processing", re: /\b(speech (recognition|processing|synthesis)|ASR)\b/i },
  { name: "Explainable AI", re: /\b(explainab(le|ility)|interpretab(le|ility)|XAI)\b/i },
  { name: "Distributed Systems", re: /\b(distributed systems?|cloud computing|edge computing)\b/i },
  { name: "Software Engineering", re: /\bsoftware engineering\b/i },
  { name: "Bioinformatics", re: /\b(bioinformatics|computational biology)\b/i },
  { name: "Medical AI", re: /\b(medical (imaging|AI)|health(care)? (AI|informatics)|clinical (NLP|data))\b/i },
];

const POSITION_WORDS = /\b(ph\.?d\.?|doctoral|doctorate|doktorand|promotion|studentship|fellowship|scholarship|researcher)\b/i;
const UNI_NAME_RE = /\b((?:[A-Z][\w'’&.-]*\s+){0,5}(?:University|Universität|Universiteit|Université|Universidad|Università|Universitet|Universitat|Yliopisto|Institute of Technology|Polytechnic|Politecnico|Technische Universität|Hochschule|College|Institute|School of [A-Z][\w]+)(?:\s+(?:of|for|in|de|di|zu|für)\s+(?:[A-Z][\w'’.-]*\s*){1,4})?)/;
const DEPT_RE = /\b((?:Department|Dept\.?|Faculty|School|Institute|Division|Centre|Center|Chair|Group) (?:of|for) [A-Z][\w,&' -]{3,80}?)(?=[.,;|()]|\s+(?:at|is|in|invites|seeks|offers|has|–|-)\b|$)/;

interface JobPostingLd {
  "@type"?: string | string[];
  title?: string;
  validThrough?: string;
  datePosted?: string;
  hiringOrganization?: { name?: string } | string;
  jobLocation?: { address?: { addressCountry?: string | { name?: string }; addressLocality?: string } } | { address?: { addressCountry?: string | { name?: string }; addressLocality?: string } }[];
  baseSalary?: { currency?: string; value?: { value?: number; minValue?: number; maxValue?: number; unitText?: string } };
  url?: string;
}

export function findJobPosting(jsonLd: unknown[]): JobPostingLd | null {
  for (const item of jsonLd) {
    if (!item || typeof item !== "object") continue;
    const t = (item as JobPostingLd)["@type"];
    if (t === "JobPosting" || (Array.isArray(t) && t.includes("JobPosting"))) return item as JobPostingLd;
  }
  return null;
}

function cleanTitle(s: string): string {
  return s.replace(/\s*[|–—-]\s*(jobs?|vacanc(y|ies)|careers?|home|news)\b.*$/i, "").replace(/\s+/g, " ").trim();
}

export interface MetaResult {
  title: Fact<string>;
  university: Fact<string>;
  department: Fact<string>;
  country: Fact<string>;
  city: Fact<string>;
  positionType: Fact<"PHD_POSITION" | "PHD_PROGRAM" | "SCHOLARSHIP" | "FELLOWSHIP">;
  researchAreas: string[];
  applyUrl: Fact<string>;
  supervisorRequired: Fact<boolean>;
  supervisors: SupervisorMention[];
  positionStatus: Fact<"OPEN" | "CLOSED">;
  degreeRequirement: Fact<string>;
  jobPosting: JobPostingLd | null;
  isLikelyOpportunity: boolean;
  signals: string[];
}

export function extractMeta(page: PageText, ctx: ExtractCtx, knownUniversityName?: string): MetaResult {
  const host = hostOf(ctx.url);
  const jp = findJobPosting(page.jsonLd);

  // ── Title
  const rawTitle = jp?.title || page.h1 || page.ogTitle || page.title;
  const title: Fact<string> = rawTitle ? fact(ctx, cleanTitle(rawTitle), "HIGH", rawTitle, undefined, jp?.title ? "STRUCTURED_DATA" : "RULE") : unknown();

  // ── University
  let university: Fact<string> = unknown();
  const org = typeof jp?.hiringOrganization === "string" ? jp.hiringOrganization : jp?.hiringOrganization?.name;
  if (org) university = fact(ctx, org.trim(), "HIGH", `hiringOrganization: ${org}`, undefined, "STRUCTURED_DATA");
  else if (knownUniversityName) university = fact(ctx, knownUniversityName, "HIGH", `Domain ${registrableDomain(host)} is registered to ${knownUniversityName}`);
  else {
    for (const candidate of [page.ogSiteName, page.title, page.h1, ...page.segments.slice(0, 40).map((s) => s.text)]) {
      if (!candidate) continue;
      const m = UNI_NAME_RE.exec(candidate);
      if (m && m[1].split(/\s+/).length <= 9) {
        const name = m[1].trim().replace(/^(The|At|the|at)\s+/, "").replace(/[\s,.-]+$/, "");
        const conf = candidate === page.ogSiteName || candidate === page.title ? "MEDIUM" : "LOW";
        university = fact(ctx, name, conf, candidate);
        break;
      }
    }
  }

  // ── Department
  let department: Fact<string> = unknown();
  for (const s of [page.h1, page.title, ...page.segments.slice(0, 60).map((x) => x.text)]) {
    const m = s ? DEPT_RE.exec(s) : null;
    if (m && !(university.value ?? "").includes(m[1].trim())) {
      department = fact(ctx, m[1].trim(), "MEDIUM", s);
      break;
    }
  }

  // ── Country / city
  let country: Fact<string> = unknown();
  let city: Fact<string> = unknown();
  const jl = Array.isArray(jp?.jobLocation) ? jp?.jobLocation[0] : jp?.jobLocation;
  const ldCountry = jl?.address?.addressCountry;
  const ldCountryName = typeof ldCountry === "string" ? ldCountry : ldCountry?.name;
  if (ldCountryName) country = fact(ctx, ldCountryName, "HIGH", `jobLocation.addressCountry: ${ldCountryName}`, undefined, "STRUCTURED_DATA");
  if (jl?.address?.addressLocality) city = fact(ctx, jl.address.addressLocality, "HIGH", `jobLocation.addressLocality: ${jl.address.addressLocality}`, undefined, "STRUCTURED_DATA");
  if (!country.value) {
    const loc = page.segments.find((s) => /\b(location|place of work|based in|located in|country)\b/i.test(s.text) && KNOWN_COUNTRIES.some((c) => new RegExp(`\\b${c}\\b`).test(s.text)));
    if (loc) {
      const c = KNOWN_COUNTRIES.find((c) => new RegExp(`\\b${c}\\b`).test(loc.text))!;
      country = fact(ctx, normalizeCountry(c), "MEDIUM", loc.text);
    } else {
      const inferred = countryFromHost(host);
      if (inferred) country = { value: inferred, confidence: "MEDIUM", certainty: "LIKELY", evidence: [evidence(ctx, `Domain: ${host}`)], note: "Inferred from the website's domain." };
    }
  }

  // ── Position type
  const typeText = `${title.value ?? ""} ${page.metaDescription}`;
  let positionType: MetaResult["positionType"] = unknown();
  if (/\b(fellowship)\b/i.test(typeText)) positionType = fact(ctx, "FELLOWSHIP", "MEDIUM", typeText.trim());
  else if (/\b(scholarship|studentship|bursary)\b/i.test(typeText)) positionType = fact(ctx, "SCHOLARSHIP", "MEDIUM", typeText.trim());
  else if (/\b(position|vacanc|job|post|researcher|candidate|employee|assistant|stelle|doktorand)\w*/i.test(typeText)) positionType = fact(ctx, "PHD_POSITION", "MEDIUM", typeText.trim());
  else if (/\b(program(me)?|admission|graduate school|doctoral school|degree)\b/i.test(typeText)) positionType = fact(ctx, "PHD_PROGRAM", "MEDIUM", typeText.trim());

  // ── Research areas (title weighted; body needs ≥2 mentions to avoid navigation noise)
  const researchAreas: string[] = [];
  const body = page.fullText;
  for (const a of RESEARCH_AREAS) {
    const inTitle = a.re.test(title.value ?? "") || a.re.test(page.segments.slice(0, 4).map((s) => s.text).join(" "));
    const count = (body.match(new RegExp(a.re.source, a.re.flags.includes("g") ? a.re.flags : a.re.flags + "g")) ?? []).length;
    if (inTitle || count >= 2) researchAreas.push(a.name);
  }

  // ── Apply URL
  let applyUrl: Fact<string> = unknown();
  const applyLink = page.links.find((l) => /^(apply( now| online| here| for (this|the) (job|position))?|application (form|portal)|start (your )?application|submit (an |your )?application|online application|to the application|søk (på )?stillingen|sök (tjänsten|jobbet)|jetzt bewerben|hae (tätä )?paikkaa)$/i.test(l.text.trim()) || (/\bapply\b/i.test(l.text) && /apply|application|bewerb|recruit|portal/i.test(l.href) && l.text.length < 60));
  if (applyLink) applyUrl = fact(ctx, applyLink.href, "HIGH", `Link "${applyLink.text}" → ${applyLink.href}`);
  else if (jp?.url && jp.url !== ctx.url) applyUrl = fact(ctx, jp.url, "MEDIUM", `JobPosting url: ${jp.url}`, undefined, "STRUCTURED_DATA");

  // ── Supervisor requirement
  let supervisorRequired: Fact<boolean> = unknown();
  const svReq = page.segments.find((s) => /\b(must|should|need to|required to|are expected to|are encouraged to|we (strongly )?recommend)\b[^.]{0,60}\b(contact|identify|find|secure|approach|obtain)[^.]{0,50}\b(supervisor|advisor|professor|faculty member|potential mentor)|supervisor'?s? (consent|agreement|acceptance|approval|confirmation)[^.]{0,40}(required|must|needed)|(acceptance|confirmation) (letter )?from (a|the|your) (prospective |potential )?(supervisor|professor)/i.test(s.text));
  if (svReq) {
    const weak = /\b(encouraged|recommend|should)\b/i.test(svReq.text) && !/\b(must|required|need to)\b/i.test(svReq.text);
    supervisorRequired = fact(ctx, true, weak ? "MEDIUM" : "HIGH", svReq.text, weak ? "Contacting a supervisor is recommended, not strictly required." : undefined);
  } else {
    const noSv = page.segments.find((s) => /\b(no need to|do not need to|not necessary to|not required to)\b[^.]{0,40}\b(contact|find|secure)[^.]{0,30}\b(supervisor|professor)/i.test(s.text));
    if (noSv) supervisorRequired = fact(ctx, false, "HIGH", noSv.text);
  }

  // ── Supervisors named on the page (only with explicit role words)
  const supervisors: SupervisorMention[] = [];
  const emailsOnPage = page.links.filter((l) => l.href.startsWith("mailto:")).map((l) => ({ text: l.text, email: l.href.slice(7).split("?")[0] }));
  for (const s of page.segments) {
    const m = /\b(?:supervisor|principal investigator|PI|main supervisor|supervised by|contact person|for (?:further |more )?(?:information|questions)[^.]{0,30}contact|questions (?:about|regarding) the position)[^.:]{0,20}[:,]?\s*((?:Prof(?:essor)?\.?|Dr\.?|Assoc\.? Prof\.?|Assistant Prof(?:essor)?\.?)\s+[A-Z][\p{L}'’-]+(?:\s+[A-Z][\p{L}'’.-]+){0,3})/u.exec(s.text);
    if (m) {
      const name = m[1].trim().replace(/[.,]$/, "");
      if (supervisors.some((x) => x.name === name)) continue;
      const emailInText = /[\w.+-]+@[\w-]+(\.[\w-]+)+/.exec(s.text)?.[0];
      const lastName = name.split(/\s+/).pop()!.toLowerCase();
      const email = emailInText ?? emailsOnPage.find((e) => e.email.toLowerCase().includes(lastName.slice(0, 5)) || e.text.toLowerCase().includes(lastName))?.email;
      supervisors.push({ name, title: /Prof/.test(name) ? "Professor" : /Dr/.test(name) ? "Dr." : undefined, email, evidence: [evidence(ctx, s.text)] });
    }
  }

  // ── Position status
  let positionStatus: Fact<"OPEN" | "CLOSED"> = unknown();
  const closed = page.segments.find((s) => /\b(position has been filled|(this|the) (position|vacancy|call|job) (is|has been) (closed|filled|withdrawn|cancelled)|applications? (are|is) (now )?closed|no longer accepting applications|(call|recruitment) (is )?closed|application period has (ended|closed)|this (job|advert) (has )?expired)\b/i.test(s.text));
  if (closed) positionStatus = fact(ctx, "CLOSED", "HIGH", closed.text);
  if (jp?.validThrough) {
    const vt = jp.validThrough.slice(0, 10);
    if (/^\d{4}-\d{2}-\d{2}$/.test(vt) && vt < ctx.referenceDate.toISOString().slice(0, 10) && !positionStatus.value) {
      positionStatus = fact(ctx, "CLOSED", "MEDIUM", `JobPosting validThrough: ${jp.validThrough}`, undefined, "STRUCTURED_DATA");
    }
  }

  // ── Degree requirement (quoted, not interpreted)
  let degreeRequirement: Fact<string> = unknown();
  const deg = page.segments.find((s) => /\b(master'?s? degree|MSc|M\.Sc\.|master of science|equivalent degree|degree in (computer science|informatics|engineering|a relevant|a related)|hold (a|an) (master|degree)|completed (a|an) (master|degree))\b/i.test(s.text) && /\b(require|must|should|hold|have|completed|qualif|eligib|expected|candidate|applicant)\w*/i.test(s.text) && !/\b(English|IELTS|TOEFL|language of instruction)\b/.test(s.text));
  if (deg) degreeRequirement = fact(ctx, deg.text.length > 300 ? deg.text.slice(0, 297) + "…" : deg.text, "HIGH", deg.text);

  // ── Is this an opportunity page at all?
  const signals: string[] = [];
  if (POSITION_WORDS.test(title.value ?? "")) signals.push("PhD/doctoral keyword in title");
  if (jp) signals.push("JobPosting structured data");
  if (applyUrl.value) signals.push("Apply link");
  if (/\b(application deadline|closing date|apply by|deadline)\b/i.test(body)) signals.push("Deadline wording");
  if (/\b(ph\.?d\.?|doctoral|doctorate)\b/i.test(body)) signals.push("PhD/doctoral wording in body");
  const isLikelyOpportunity = (signals.includes("PhD/doctoral keyword in title") && signals.length >= 2) || (signals.includes("PhD/doctoral wording in body") && signals.length >= 3);

  return { title, university, department, country, city, positionType, researchAreas, applyUrl, supervisorRequired, supervisors, positionStatus, degreeRequirement, jobPosting: jp, isLikelyOpportunity, signals };
}

function normalizeCountry(c: string): string {
  if (c === "USA") return "United States";
  if (c === "UK") return "United Kingdom";
  if (c === "Korea") return "South Korea";
  return c;
}
