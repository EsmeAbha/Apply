import { randomUUID } from "node:crypto";
import * as cheerio from "cheerio";
import { config } from "../config.js";
import { prisma } from "../db.js";
import { classifySource, hostOf, normalizeUrl, registrableDomain } from "../extraction/source.js";
import { matchAnalysis } from "../services/matching.js";
import { notify } from "../services/notifications.js";
import { analyzeHtml, saveOpportunity } from "../services/opportunities.js";
import { getProfileBundle } from "../services/profile.js";
import { fetcher, type PoliteFetcher } from "./fetcher.js";

export interface DiscoveryJob {
  id: string;
  userId: string;
  status: "RUNNING" | "DONE" | "FAILED";
  startedAt: string;
  finishedAt?: string;
  pagesFetched: number;
  candidates: number;
  found: {
    id: string;
    title: string;
    url: string;
    isNew: boolean;
    alignment: string;
    university: string | null;
    country: string | null;
    funding: string;
    deadline: string;
    fee: string;
    english: string;
    documents: number;
    applyUrl: string | null;
  }[];
  leads: { url: string; title: string; reason: string }[];
  errors: { url: string; reason: string }[];
}

const jobs = new Map<string, DiscoveryJob>();
export const getJob = (id: string) => jobs.get(id);

const LINK_RE = /\b(ph\.?\s?d|doctoral|doctorate|doktorand|promotion|studentships?|fellowships?|doctoral researcher|research (assistant|associate|position)|early[- ]stage researcher|vacanc(y|ies)|positions?|scholarships?)\b/i;

/** Candidate links from a listing page (HTML) or an RSS/Atom feed. */
export function extractCandidateLinks(body: string, baseUrl: string, max = 20): { url: string; text: string }[] {
  const out: { url: string; text: string }[] = [];
  const seen = new Set<string>();
  const baseReg = registrableDomain(hostOf(baseUrl));
  const add = (href: string, text: string) => {
    let abs: string;
    try {
      abs = new URL(href, baseUrl).toString();
    } catch {
      return;
    }
    if (!/^https?:/.test(abs)) return;
    const n = normalizeUrl(abs);
    if (seen.has(n) || n === normalizeUrl(baseUrl)) return;
    const sameSite = registrableDomain(hostOf(abs)) === baseReg;
    const t = classifySource(abs).type;
    if (!sameSite && t !== "OFFICIAL_UNIVERSITY" && t !== "INSTITUTIONAL_PORTAL") return;
    if (!LINK_RE.test(text) && !LINK_RE.test(decodeURIComponent(new URL(abs).pathname).replace(/[-_/]/g, " "))) return;
    if (/\.(pdf|docx?|jpe?g|png|zip)$/i.test(new URL(abs).pathname)) return;
    seen.add(n);
    out.push({ url: abs, text: text.trim().slice(0, 200) });
  };
  if (/^\s*<\?xml|<rss|<feed/i.test(body.slice(0, 500))) {
    const $ = cheerio.load(body, { xmlMode: true });
    $("item").each((_, el) => add($(el).find("link").first().text(), $(el).find("title").first().text()));
    $("entry").each((_, el) => add($(el).find("link").attr("href") ?? "", $(el).find("title").first().text()));
  } else {
    const $ = cheerio.load(body);
    $("a[href]").each((_, el) => add($(el).attr("href") ?? "", $(el).text()));
  }
  return out.slice(0, max);
}

async function searchBrave(query: string): Promise<{ url: string; title: string }[]> {
  if (config.search.provider !== "brave" || !config.search.braveApiKey) return [];
  const res = await fetch(`https://api.search.brave.com/res/v1/web/search?q=${encodeURIComponent(query)}&count=20`, {
    headers: { accept: "application/json", "X-Subscription-Token": config.search.braveApiKey },
    signal: AbortSignal.timeout(15_000),
  });
  if (!res.ok) throw new Error(`Search API error HTTP ${res.status}`);
  const json = (await res.json()) as { web?: { results?: { url: string; title: string }[] } };
  return json.web?.results?.map((r) => ({ url: r.url, title: r.title })) ?? [];
}

export function startDiscovery(userId: string, opts: { seedIds?: string[]; urls?: string[]; query?: string; maxPerSeed?: number }, f: PoliteFetcher = fetcher): DiscoveryJob {
  const job: DiscoveryJob = { id: randomUUID(), userId, status: "RUNNING", startedAt: new Date().toISOString(), pagesFetched: 0, candidates: 0, found: [], leads: [], errors: [] };
  jobs.set(job.id, job);
  runDiscovery(job, opts, f).catch((e) => {
    job.status = "FAILED";
    job.errors.push({ url: "-", reason: (e as Error).message });
    job.finishedAt = new Date().toISOString();
  });
  return job;
}

async function runDiscovery(job: DiscoveryJob, opts: { seedIds?: string[]; urls?: string[]; query?: string; maxPerSeed?: number }, f: PoliteFetcher): Promise<void> {
  const seeds = await prisma.discoverySeed.findMany({ where: { userId: job.userId, enabled: true, ...(opts.seedIds?.length ? { id: { in: opts.seedIds } } : {}) } });
  const seedUrls = [...(opts.urls ?? []), ...(opts.urls?.length ? [] : seeds.map((s) => s.url))];
  const candidates: { url: string; text: string }[] = [];

  if (opts.query) {
    try {
      const results = await searchBrave(opts.query);
      for (const r of results) {
        const t = classifySource(r.url).type;
        if (t === "THIRD_PARTY") job.leads.push({ url: r.url, title: r.title, reason: "Third-party listing — open it to find the official university page, then analyse that page." });
        else candidates.push({ url: r.url, text: r.title });
      }
    } catch (e) {
      job.errors.push({ url: "search", reason: (e as Error).message });
    }
  }

  for (const seedUrl of seedUrls) {
    const res = await f.fetch(seedUrl, { accept: "any" });
    job.pagesFetched++;
    const seed = seeds.find((s) => s.url === seedUrl);
    if (seed) await prisma.discoverySeed.update({ where: { id: seed.id }, data: { lastCrawledAt: new Date(), lastStatus: res.status === "OK" ? "OK" : `${res.status}: ${res.error}` } });
    if (res.status !== "OK" || !res.body) {
      job.errors.push({ url: seedUrl, reason: res.error ?? res.status });
      continue;
    }
    if (classifySource(seedUrl).type === "THIRD_PARTY") {
      job.leads.push({ url: seedUrl, title: seedUrl, reason: "Seed is a third-party site — links found here are discovery leads only." });
    }
    // The seed page may itself be an opportunity.
    candidates.push({ url: seedUrl, text: "(seed page)" });
    candidates.push(...extractCandidateLinks(res.body, res.finalUrl || seedUrl, opts.maxPerSeed ?? 15));
  }

  const bundle = await getProfileBundle(job.userId);
  const unique = [...new Map(candidates.map((c) => [normalizeUrl(c.url), c])).values()];
  job.candidates = unique.length;
  for (const c of unique) {
    const type = classifySource(c.url).type;
    if (type === "THIRD_PARTY") {
      job.leads.push({ url: c.url, title: c.text, reason: "Third-party — verify with the university." });
      continue;
    }
    const res = await f.fetch(c.url);
    job.pagesFetched++;
    if (res.status !== "OK" || !res.body) {
      if (c.text !== "(seed page)") job.errors.push({ url: c.url, reason: res.error ?? res.status });
      continue;
    }
    const analysis = await analyzeHtml(res.body, res.finalUrl || c.url, { useAI: false });
    const ex = analysis.extraction!;
    await prisma.crawlResult.create({ data: { url: c.url, status: "OK", httpStatus: res.httpStatus, contentHash: ex.contentHash, title: ex.pageTitle, isCandidate: ex.isLikelyOpportunity, jobId: job.id } });
    if (!ex.isLikelyOpportunity) continue;
    const saved = await saveOpportunity(job.userId, ex, { saved: false, discoveredVia: opts.query ? "SEARCH" : "CRAWLER" });
    const m = matchAnalysis(bundle, ex);
    job.found.push({
      id: saved.opportunity.id,
      title: saved.opportunity.title,
      url: c.url,
      isNew: saved.created,
      alignment: m.researchAlignment.level,
      university: ex.university.value,
      country: ex.country.value,
      funding: ex.funding.category.value ?? "FUNDING_UNKNOWN",
      deadline: ex.deadlines.find((d) => d.kind === "APPLICATION")?.dateText ?? "UNKNOWN",
      fee: ex.fee.status.value ?? "UNKNOWN",
      english: ex.english.summary,
      documents: ex.documents.filter((d) => d.necessity === "REQUIRED").length,
      applyUrl: ex.applyUrl.value,
    });
    if (saved.created && (m.researchAlignment.level === "HIGH" || m.researchAlignment.level === "MEDIUM") && ex.positionStatus.value !== "CLOSED") {
      await notify(job.userId, {
        opportunityId: saved.opportunity.id,
        type: "NEW_MATCH",
        severity: "INFO",
        title: `New matching PhD opportunity: ${saved.opportunity.title}`,
        body: `${ex.university.value ?? ""} — research alignment ${m.researchAlignment.level} (${m.researchAlignment.matched.join(", ")}). Funding: ${(ex.funding.category.value ?? "UNKNOWN").replace(/_/g, " ")}.`,
        link: `/opportunities/${saved.opportunity.id}`,
        dedupeKey: `newmatch:${saved.opportunity.id}`,
      });
    }
  }
  job.status = "DONE";
  job.finishedAt = new Date().toISOString();
}

/** Search-engine links the user can open in their own browser (no scraping of search engines). */
export function searchStrategies(interests: string[], countries: string[]): { strategy: string; label: string; url: string }[] {
  const g = (q: string) => `https://www.google.com/search?q=${encodeURIComponent(q)}`;
  const topics = interests.slice(0, 4);
  const out: { strategy: string; label: string; url: string }[] = [];
  const academicSites = "(site:.ac.uk OR site:.edu OR site:.de OR site:.nl OR site:.se OR site:.fi OR site:.dk OR site:.no OR site:.ch OR site:.edu.au OR site:.ac.jp OR site:.edu.sg)";
  for (const t of topics) {
    out.push({ strategy: "PhD vacancy search", label: `"fully funded" PhD position "${t}"`, url: g(`"fully funded" PhD position "${t}" ${academicSites}`) });
    out.push({ strategy: "Research group search", label: `"${t}" research group "PhD position" open`, url: g(`"${t}" research group "open PhD position" ${academicSites}`) });
  }
  out.push({ strategy: "Scholarship search", label: "PhD scholarship computer science no application fee", url: g(`PhD scholarship computer science "no application fee" ${academicSites}`) });
  out.push({ strategy: "University search", label: "PhD computer science admissions IELTS can be submitted later", url: g(`PhD computer science admission "English" "can be submitted later" ${academicSites}`) });
  out.push({ strategy: "Department search", label: "department of computer science doctoral positions", url: g(`"department of computer science" "doctoral positions" ${academicSites}`) });
  out.push({ strategy: "Supervisor search", label: `professor "${topics[0] ?? "machine learning"}" "prospective PhD students"`, url: g(`professor "${topics[0] ?? "machine learning"}" "prospective PhD students" ${academicSites}`) });
  for (const c of countries.slice(0, 4)) {
    out.push({ strategy: "Country search", label: `PhD position ${topics[0] ?? "AI"} ${c}`, url: g(`PhD position "${topics[0] ?? "artificial intelligence"}" ${c} university vacancy`) });
  }
  out.push({ strategy: "Official job portals", label: "EURAXESS — EU research jobs portal", url: "https://euraxess.ec.europa.eu/jobs/search" });
  out.push({ strategy: "Official job portals", label: "Jobbnorge (Norwegian universities)", url: "https://www.jobbnorge.no/en/available-jobs" });
  out.push({ strategy: "Official job portals", label: "AcademicTransfer (Dutch universities)", url: "https://www.academictransfer.com/en/jobs/" });
  return out;
}
