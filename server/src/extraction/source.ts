import type { Certainty, Confidence, SourceType } from "./types.js";

const TRACKING_PARAMS = /^(utm_|fbclid|gclid|mc_|ref$|source$|trk)/i;

/** Canonical form used for deduplication: lowercase host without www, no fragment, no tracking params, no trailing slash. */
export function normalizeUrl(raw: string): string {
  try {
    const u = new URL(raw.trim());
    u.hash = "";
    if (u.pathname.length > 1 && u.pathname.endsWith("/")) u.pathname = u.pathname.replace(/\/+$/, "");
    u.hostname = u.hostname.toLowerCase().replace(/^www\./, "");
    const keep = [...u.searchParams.entries()].filter(([k]) => !TRACKING_PARAMS.test(k)).sort(([a], [b]) => a.localeCompare(b));
    u.search = "";
    for (const [k, v] of keep) u.searchParams.append(k, v);
    let s = u.toString();
    if (u.pathname !== "/" && s.endsWith("/")) s = s.slice(0, -1);
    if (u.pathname === "/" && !u.search) s = s.replace(/\/$/, "");
    return s.replace(/^http:\/\//, "https://");
  } catch {
    return raw.trim();
  }
}

const MULTI_PART_SUFFIXES = [
  "ac.uk", "co.uk", "org.uk", "gov.uk", "edu.au", "gov.au", "com.au", "ac.nz", "govt.nz", "ac.jp", "go.jp", "ac.kr", "go.kr",
  "edu.sg", "gov.sg", "ac.at", "ac.be", "edu.cn", "ac.cn", "ac.in", "edu.in", "ac.il", "ac.za", "edu.hk", "edu.tw", "ac.th",
  "edu.my", "edu.pk", "ac.bd", "edu.bd", "ac.ir", "edu.tr", "edu.br", "edu.mx", "edu.ar", "ac.ae", "edu.sa", "gc.ca", "qc.ca",
];

/** Registrable domain, e.g. "cs.ox.ac.uk" -> "ox.ac.uk", "jobs.uni-stuttgart.de" -> "uni-stuttgart.de". */
export function registrableDomain(hostname: string): string {
  const host = hostname.toLowerCase().replace(/^www\./, "");
  const parts = host.split(".");
  for (const suffix of MULTI_PART_SUFFIXES) {
    if (host.endsWith("." + suffix)) {
      const n = suffix.split(".").length + 1;
      return parts.slice(-n).join(".");
    }
  }
  return parts.slice(-2).join(".");
}

export function hostOf(url: string): string {
  try {
    return new URL(url).hostname.toLowerCase().replace(/^www\./, "");
  } catch {
    return "";
  }
}

// Aggregators / blogs — useful for DISCOVERY only; never authoritative.
const THIRD_PARTY_DOMAINS = [
  "findaphd.com", "phdportal.com", "scholarshipdb.net", "academicpositions.com", "academicpositions.net", "jobs.ac.uk",
  "opportunitydesk.org", "scholars4dev.com", "afterschoolafrica.com", "scholarshipportal.com", "mastersportal.com",
  "linkedin.com", "indeed.com", "glassdoor.com", "researchgate.net", "facebook.com", "twitter.com", "x.com", "reddit.com",
  "medium.com", "youtube.com", "studyportals.com", "phdfinder.com", "nature.com", "newscientist.com", "timeshighereducation.com",
  "careers.timeshighereducation.com", "higheredjobs.com", "chronicle.com", "euraxess.org", "scholarshipsads.com",
  "scholarship-positions.com", "wemakescholars.com", "blogspot.com", "wordpress.com", "telegram.me", "t.me",
];

// Recruitment systems that universities publish their own official vacancies through.
const INSTITUTIONAL_PORTALS = [
  "jobbnorge.no", "varbi.com", "academictransfer.com", "myworkdayjobs.com", "workday.com", "successfactors.eu",
  "successfactors.com", "jobs.ethz.ch", "recruitingapp-5118.de", "recruitingapp-5128.de", "softgarden.io", "emply.com",
  "hr-manager.net", "tietoenator.com", "saimaa.fi", "rekrytointi.com", "jobs.smartrecruiters.com", "pageuppeople.com",
  "taleo.net", "jobs.lu.se", "jobs.dtu.dk", "ams.aalto.fi",
];

const GOVERNMENT_DOMAINS = [
  "europa.eu", "daad.de", "gov.uk", "ukri.org", "nsf.gov", "study-in-germany.de", "campusfrance.org",
  "studyinnorway.no", "studyinsweden.se", "studyinfinland.fi", "studyindenmark.dk", "nuffic.nl", "studyinholland.nl",
  "mext.go.jp", "jsps.go.jp", "studyinkorea.go.kr", "canada.ca", "educanada.ca", "studyaustralia.gov.au", "education.govt.nz",
  "sbfi.admin.ch", "si.se", "oead.at", "chevening.org", "cscuk.fcdo.gov.uk", "erasmus-plus.ec.europa.eu",
];

const ACADEMIC_HOST_PATTERNS: RegExp[] = [
  /\.edu$/, /\.edu\.[a-z]{2}$/, /\.ac\.[a-z]{2}$/,
  /(^|\.)(uni|univ|universit[a-z]*|hochschule[a-z]*)[-a-z0-9]*\.[a-z]{2,}$/,
  /(^|\.)(tu|th|fh|hs)-[a-z]+\.[a-z]{2,}$/,
  /(^|[.-])(university|universit[aeéày]|uni-|tu-|kth|chalmers|ethz|epfl|tudelft|tue|utwente|uva|vu|rug|leidenuniv|uu|lu|su|gu|liu|umu|ntnu|uio|uib|uit|aalto|helsinki|tuni|oulu|dtu|ku|au|sdu|aau|kuleuven|ugent|uantwerpen|ucl|imperial|ox|cam|ed|manchester|kcl|lse|tcd|ucd|tum|lmu|rwth|kit|mpg|mpi|inria|cnrs|polytechnique|sorbonne|polimi|unibo|unimi|upc|uam|ucm|tuwien|univie|mcgill|utoronto|ubc|uwaterloo|ualberta|anu|unimelb|sydney|unsw|monash|auckland|otago|nus|ntu|kaist|snu|postech|u-tokyo|kyoto-u|titech|osaka-u|tohoku|a-star|mbzuai|kaust|ist|ista|cispa|dfki|fraunhofer|helmholtz)\./,
];

export function classifySource(url: string, knownUniversityDomains: string[] = []): { type: SourceType; reason: string } {
  const host = hostOf(url);
  if (!host) return { type: "UNKNOWN", reason: "Invalid URL" };
  const reg = registrableDomain(host);
  const matches = (list: string[]) => list.some((d) => host === d || host.endsWith("." + d));

  if (matches(THIRD_PARTY_DOMAINS)) return { type: "THIRD_PARTY", reason: `${reg} is an aggregator/third-party site — use for discovery only` };
  if (knownUniversityDomains.some((d) => host === d || host.endsWith("." + d))) {
    return { type: "OFFICIAL_UNIVERSITY", reason: `${reg} matches a university domain in your database` };
  }
  if (matches(INSTITUTIONAL_PORTALS)) {
    return { type: "INSTITUTIONAL_PORTAL", reason: `${reg} is a recruitment system universities use for official vacancies — confirm the employer` };
  }
  if (matches(GOVERNMENT_DOMAINS) || host.includes("fulbright") || /\.gov(\.[a-z]{2})?$/.test(host) || /\.gc\.ca$/.test(host) || /\.admin\.ch$/.test(host)) {
    return { type: "GOVERNMENT", reason: `${reg} is a government / official funding body domain` };
  }
  if (ACADEMIC_HOST_PATTERNS.some((re) => re.test(host))) {
    return { type: "OFFICIAL_UNIVERSITY", reason: `${reg} looks like an academic institution domain` };
  }
  return { type: "UNKNOWN", reason: `${reg} is not a recognised university domain — verify it is official` };
}

/** Map source trust + extraction confidence to a user-facing certainty level. */
export function certaintyFor(sourceType: SourceType, confidence: Confidence): Certainty {
  if (sourceType === "USER_ENTERED") return "USER_ENTERED";
  if (sourceType === "THIRD_PARTY") return "POSSIBLE";
  if (sourceType === "OFFICIAL_UNIVERSITY" || sourceType === "GOVERNMENT") {
    return confidence === "HIGH" ? "VERIFIED" : confidence === "MEDIUM" ? "LIKELY" : "POSSIBLE";
  }
  // Institutional portal or unknown domain: never "VERIFIED" without the university page.
  return confidence === "LOW" ? "POSSIBLE" : "LIKELY";
}

export function sourceTypeLabel(t: SourceType): string {
  switch (t) {
    case "OFFICIAL_UNIVERSITY": return "Official university website";
    case "INSTITUTIONAL_PORTAL": return "Official recruitment portal";
    case "GOVERNMENT": return "Government / official funder";
    case "THIRD_PARTY": return "THIRD-PARTY — VERIFY WITH UNIVERSITY";
    case "USER_ENTERED": return "Entered by you";
    default: return "Unrecognised source — verify it is official";
  }
}

const TLD_COUNTRY: Record<string, string> = {
  uk: "United Kingdom", de: "Germany", nl: "Netherlands", se: "Sweden", fi: "Finland", dk: "Denmark", no: "Norway",
  fr: "France", be: "Belgium", ch: "Switzerland", au: "Australia", nz: "New Zealand", jp: "Japan", kr: "South Korea",
  sg: "Singapore", ie: "Ireland", at: "Austria", it: "Italy", es: "Spain", ca: "Canada", pt: "Portugal", pl: "Poland",
  cz: "Czech Republic", ee: "Estonia", lu: "Luxembourg", is: "Iceland", il: "Israel", hk: "Hong Kong", tw: "Taiwan",
  cn: "China", in: "India", ae: "United Arab Emirates", sa: "Saudi Arabia", qa: "Qatar", za: "South Africa", br: "Brazil",
  gr: "Greece", hu: "Hungary", si: "Slovenia", sk: "Slovakia", lt: "Lithuania", lv: "Latvia", cy: "Cyprus", mt: "Malta",
  tr: "Turkey", my: "Malaysia", th: "Thailand", bd: "Bangladesh", pk: "Pakistan",
};

/** Country inferred from domain — always returned as LIKELY, never VERIFIED. */
export function countryFromHost(host: string): string | null {
  const tld = host.split(".").pop() ?? "";
  if (TLD_COUNTRY[tld]) return TLD_COUNTRY[tld];
  if (/\.edu$/.test(host)) return "United States";
  return null;
}

export const KNOWN_COUNTRIES = [
  "United States", "USA", "Canada", "United Kingdom", "UK", "Germany", "Netherlands", "Sweden", "Finland", "Denmark", "Norway",
  "France", "Belgium", "Switzerland", "Australia", "New Zealand", "Japan", "South Korea", "Korea", "Singapore", "Ireland",
  "Austria", "Italy", "Spain", "Portugal", "Poland", "Czech Republic", "Estonia", "Luxembourg", "Iceland", "Israel",
  "Hong Kong", "Taiwan", "China", "India", "United Arab Emirates", "Saudi Arabia", "Qatar", "South Africa", "Brazil", "Greece",
];
