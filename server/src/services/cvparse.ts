/**
 * Rule-based CV analysis. Produces PROPOSALS that the user reviews and imports — nothing is added
 * to the verified profile automatically, and nothing is invented: every proposal quotes a CV line.
 */

export interface CvProposal {
  kind: "EDUCATION" | "PUBLICATION" | "PROJECT" | "RESEARCH_EXPERIENCE" | "WORK_EXPERIENCE" | "TEACHING" | "AWARD" | "CERTIFICATION" | "SKILL" | "PROGRAMMING_LANGUAGE" | "LANGUAGE" | "RESEARCH_INTEREST";
  title: string;
  organization?: string;
  dates?: string;
  description?: string;
  sourceLine: string;
}

const SECTIONS: { kind: CvProposal["kind"] | "SKILLS_BLOCK" | "IGNORE"; re: RegExp }[] = [
  { kind: "EDUCATION", re: /^(education|academic (background|qualifications?)|qualifications)\b/i },
  { kind: "PUBLICATION", re: /^(publications?|selected publications|papers|peer[- ]reviewed publications|conference papers|journal (articles|papers))\b/i },
  { kind: "RESEARCH_EXPERIENCE", re: /^(research (experience|projects?)|research)\b/i },
  { kind: "PROJECT", re: /^(projects?|selected projects|academic projects|personal projects)\b/i },
  { kind: "WORK_EXPERIENCE", re: /^((work|professional|industry|employment) (experience|history)|experience|employment)\b/i },
  { kind: "TEACHING", re: /^(teaching( experience)?|teaching assistant(ship)?s?)\b/i },
  { kind: "AWARD", re: /^(awards?|honou?rs|scholarships?|achievements|awards and honou?rs)\b/i },
  { kind: "CERTIFICATION", re: /^(certifications?|certificates|courses|online courses|trainings?)\b/i },
  { kind: "SKILLS_BLOCK", re: /^((technical )?skills|technical expertise|competencies|tools( and technologies)?|technologies)\b/i },
  { kind: "LANGUAGE", re: /^(languages?|language skills)\b/i },
  { kind: "RESEARCH_INTEREST", re: /^(research interests?|interests)\b/i },
  { kind: "IGNORE", re: /^(references|referees|contact|personal (details|information)|profile|summary|objective|about me|hobbies)\b/i },
];

const PROGRAMMING = ["Python", "Java", "C++", "C#", "C", "JavaScript", "TypeScript", "R", "MATLAB", "Julia", "Go", "Rust", "Scala", "SQL", "Bash", "Kotlin", "Swift", "PHP", "Haskell"];
const DEGREE_RE = /\b(B\.?Sc\.?|M\.?Sc\.?|B\.?S\.?|M\.?S\.?|B\.?Tech|M\.?Tech|B\.?E\.?|M\.?E\.?|Bachelor|Master|Ph\.?D|Doctor|MPhil|MRes|BEng|MEng|HSC|SSC|A-?Levels?)\b/i;
const DATE_RANGE_RE = /\b((?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Sept|Oct|Nov|Dec)[a-z]*\.?\s+)?(19|20)\d{2}\s*(?:[–—-]|to)\s*((?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Sept|Oct|Nov|Dec)[a-z]*\.?\s+)?((19|20)\d{2}|present|current|now|ongoing|expected\s+\d{4})\b|\b(19|20)\d{2}\b/i;

function isHeading(line: string): boolean {
  const t = line.replace(/[:：]$/, "").trim();
  return t.length > 2 && t.length < 45 && !/[.;]$/.test(t) && (t === t.toUpperCase() || SECTIONS.some((s) => s.re.test(t)));
}

export function parseCv(text: string): { proposals: CvProposal[]; sectionsFound: string[] } {
  const lines = text.split(/\r?\n/).map((l) => l.replace(/\s+/g, " ").trim()).filter(Boolean);
  const proposals: CvProposal[] = [];
  const sectionsFound: string[] = [];
  let current: (typeof SECTIONS)[number]["kind"] | null = null;
  let buffer: string[] = [];

  const flush = () => {
    if (!current || current === "IGNORE" || !buffer.length) {
      buffer = [];
      return;
    }
    if (current === "SKILLS_BLOCK" || current === "LANGUAGE" || current === "RESEARCH_INTEREST") {
      const joined = buffer.join(", ");
      const items = joined.split(/[,;•|·]|\s{2,}|:\s/).map((s) => s.replace(/^[-–*\s]+/, "").trim()).filter((s) => s.length > 1 && s.length < 50);
      for (const it of items) {
        const kind: CvProposal["kind"] = current === "LANGUAGE" ? "LANGUAGE" : current === "RESEARCH_INTEREST" ? "RESEARCH_INTEREST" : PROGRAMMING.some((p) => p.toLowerCase() === it.toLowerCase()) ? "PROGRAMMING_LANGUAGE" : "SKILL";
        if (/^(programming( languages)?|languages|frameworks|tools|libraries|skills)$/i.test(it)) continue;
        if (!proposals.some((p) => p.kind === kind && p.title.toLowerCase() === it.toLowerCase())) proposals.push({ kind, title: it, sourceLine: it });
      }
    } else {
      // Group bullet continuation lines into the preceding entry.
      const entries: string[][] = [];
      for (const l of buffer) {
        const isBullet = /^[-–•*▪◦]/.test(l);
        if (!entries.length || (!isBullet && (DATE_RANGE_RE.test(l) || DEGREE_RE.test(l) || current === "PUBLICATION" || /^\[?\d+[\].]/.test(l)))) entries.push([l]);
        else entries[entries.length - 1].push(l);
      }
      for (const e of entries) {
        const head = e[0].replace(/^[-–•*▪◦\d.\[\]\s]+/, "");
        const dates = DATE_RANGE_RE.exec(e.join(" "))?.[0];
        const kind = current as CvProposal["kind"];
        if (kind === "EDUCATION" && !DEGREE_RE.test(e.join(" "))) continue;
        proposals.push({
          kind,
          title: head.length > 200 ? head.slice(0, 197) + "…" : head,
          organization: e[1] && !/^[-–•*]/.test(e[1]) && e[1].length < 120 ? e[1] : undefined,
          dates,
          description: e.slice(1).join(" ").slice(0, 600) || undefined,
          sourceLine: e.join(" ").slice(0, 400),
        });
      }
    }
    buffer = [];
  };

  for (const line of lines) {
    const heading = line.replace(/[:：]$/, "").trim();
    const section = SECTIONS.find((s) => s.re.test(heading));
    if (section && isHeading(line)) {
      flush();
      current = section.kind;
      sectionsFound.push(heading);
      continue;
    }
    if (current) buffer.push(line);
  }
  flush();

  // Programming languages mentioned anywhere (word-boundary exact matches only).
  for (const p of PROGRAMMING) {
    if (p.length <= 2) continue; // "C", "R", "Go" are too ambiguous outside a skills section
    const re = new RegExp(`(^|[^A-Za-z])${p.replace(/[+#]/g, "\\$&")}([^A-Za-z]|$)`);
    if (re.test(text) && !proposals.some((x) => x.title.toLowerCase() === p.toLowerCase())) {
      proposals.push({ kind: "PROGRAMMING_LANGUAGE", title: p, sourceLine: `Mentioned in CV: ${p}` });
    }
  }
  return { proposals, sectionsFound };
}
