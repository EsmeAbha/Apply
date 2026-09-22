import * as cheerio from "cheerio";
import type { Element } from "domhandler";
import { fetcher } from "../crawler/fetcher.js";
import { prisma } from "../db.js";
import { RESEARCH_AREAS } from "../extraction/meta.js";
import { classifySource, hostOf, registrableDomain } from "../extraction/source.js";
import { normalizeWhitespace } from "../extraction/text.js";
import { HttpError } from "../http.js";

export interface FacultyCandidate {
  name: string;
  title?: string;
  department?: string;
  email?: string;
  researchAreas: string[];
  interestsText?: string;
  profileUrl?: string;
  snippet: string;
  relevance: number;
}

const TITLE_RE = /\b(Full Professor|Associate Professor|Assistant Professor|Professor|Senior Lecturer|Lecturer|Reader|Research Professor|Principal Investigator|Group Leader|Dr\.?|Prof\.?)\b/;
const NAME_RE = /^(?:(?:Prof(?:essor)?\.?|Dr\.?|Assoc\.? Prof\.?|Asst\.? Prof\.?)\s+)*([A-Z][\p{L}'’-]+(?:\s+(?:[A-Z]\.|van|von|de|der|da|di|[A-Z][\p{L}'’-]+)){1,3})$/u;

/**
 * Extract academic staff from an official faculty/people page. Only e-mails published on the
 * university's own domain for academic contact are kept; personal addresses are dropped.
 */
export function parseFacultyPage(html: string, url: string, interests: string[]): FacultyCandidate[] {
  const $ = cheerio.load(html);
  $("script, style, nav, footer, noscript").remove();
  const pageReg = registrableDomain(hostOf(url));
  const out: FacultyCandidate[] = [];
  const seen = new Set<string>();
  const dept = normalizeWhitespace($("h1").first().text()) || undefined;

  $("a[href^='mailto:']").each((_, a) => {
    const email = ($(a).attr("href") ?? "").slice(7).split("?")[0].trim().toLowerCase();
    const emailDomain = email.split("@")[1] ?? "";
    if (!emailDomain || registrableDomain(emailDomain) !== pageReg) return; // not an official institutional address
    // Smallest ancestor block that looks like one person's card.
    let block = $(a).parent();
    for (let i = 0; i < 5 && block.length; i++) {
      const t = normalizeWhitespace(block.text());
      if (t.length > 40 && (block.find("h2,h3,h4,strong,b,a").length > 1 || TITLE_RE.test(t))) break;
      block = block.parent();
    }
    const text = normalizeWhitespace(block.text()).replace(/\n/g, " ");
    if (text.length > 2000) return;
    let name: string | undefined;
    block.find("h2,h3,h4,h5,strong,b,a,.name").each((_, el) => {
      if (name) return;
      const t = normalizeWhitespace($(el as Element).text()).replace(/\n/g, " ");
      const m = NAME_RE.exec(t);
      if (m && !t.includes("@")) name = t;
    });
    if (!name || seen.has(name)) return;
    seen.add(name);
    const title = TITLE_RE.exec(text.replace(name, ""))?.[0] ?? (/^Prof/.test(name) ? "Professor" : /^Dr/.test(name) ? "Dr." : undefined);
    const interestsText = /research (interests?|areas?|focus)\s*:?\s*([^.]{5,300})/i.exec(text)?.[2];
    const areas = RESEARCH_AREAS.filter((r) => r.re.test(text)).map((r) => r.name);
    const profileHref = block.find("a").filter((_, el) => normalizeWhitespace($(el).text()) === name).attr("href");
    const relevance = areas.filter((a) => interests.some((i) => i.toLowerCase() === a.toLowerCase())).length;
    out.push({
      name,
      title,
      department: dept,
      email,
      researchAreas: areas,
      interestsText,
      profileUrl: profileHref ? new URL(profileHref, url).toString() : undefined,
      snippet: text.slice(0, 400),
      relevance,
    });
  });
  return out.sort((a, b) => b.relevance - a.relevance);
}

export async function discoverSupervisors(userId: string, opts: { url: string; html?: string; opportunityId?: string }) {
  const cls = classifySource(opts.url);
  if (cls.type !== "OFFICIAL_UNIVERSITY") {
    throw new HttpError(400, "Supervisor discovery only uses official university pages (faculty or people pages). Open the department's staff page and try again.");
  }
  let html = opts.html;
  if (!html) {
    const r = await fetcher.fetch(opts.url);
    if (r.status !== "OK" || !r.body) throw new HttpError(502, `Crawl failed. Reason: ${r.error}`);
    html = r.body;
  }
  if (opts.opportunityId) {
    const opp = await prisma.opportunity.findFirst({ where: { id: opts.opportunityId, userId } });
    if (!opp) throw new HttpError(404, "Opportunity not found");
  }
  const interests = (await prisma.researchInterest.findMany({ where: { userId } })).map((i) => i.name);
  const candidates = parseFacultyPage(html, opts.url, interests);
  const saved = [];
  for (const c of candidates) {
    const existing = await prisma.supervisor.findFirst({ where: { name: c.name, sourceUrl: opts.url, opportunityId: opts.opportunityId ?? null } });
    if (existing) {
      saved.push(existing);
      continue;
    }
    saved.push(
      await prisma.supervisor.create({
        data: {
          opportunityId: opts.opportunityId,
          name: c.name,
          title: c.title,
          department: c.department,
          email: c.email,
          researchAreas: c.researchAreas,
          profileUrl: c.profileUrl,
          sourceUrl: opts.url,
          snippet: c.snippet,
          relevance: c.relevance,
        },
      }),
    );
  }
  return saved.sort((a, b) => b.relevance - a.relevance);
}
