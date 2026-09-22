import { evidence, parseCount, withHeading, type ExtractCtx } from "./common.js";
import { certaintyFor } from "./source.js";
import type { Segment } from "./text.js";
import type { Confidence, DocumentRequirement, Necessity } from "./types.js";

interface DocType {
  key: string;
  label: string;
  re: RegExp;
}

// Order matters: more specific patterns first so that "research statement" is not also counted as a "statement of purpose".
export const DOC_TYPES: DocType[] = [
  { key: "RESEARCH_PROPOSAL", label: "Research proposal", re: /\b(research (proposal|plan|project (outline|description|proposal))|project proposal|thesis proposal|research outline|doctoral (research )?proposal|exposé|expose)\b/i },
  { key: "RESEARCH_STATEMENT", label: "Research statement", re: /\bresearch (statement|interests statement|summary)\b|\bstatement of research (interests|experience)\b/i },
  { key: "SOP", label: "Statement of purpose", re: /\b(statement of purpose|SoP|academic statement|statement of academic purpose)\b/i },
  { key: "MOTIVATION_LETTER", label: "Motivation letter", re: /\b(motivation(al)? letter|letter of motivation|motivation statement|statement of motivation)\b/i },
  { key: "COVER_LETTER", label: "Cover letter", re: /\b(cover(ing)? letter|letter of application|application letter)\b/i },
  { key: "PERSONAL_STATEMENT", label: "Personal statement", re: /\b(personal (statement|history statement)|diversity statement)\b/i },
  { key: "STUDY_PLAN", label: "Study plan", re: /\bstudy plan\b/i },
  { key: "CV", label: "CV / Résumé", re: /\b(curriculum vitae|CV|résumé|resume|academic CV)\b/ },
  { key: "TRANSCRIPT_BACHELOR", label: "Bachelor's transcript", re: /\b(bachelor'?s?|undergraduate|BSc|B\.Sc\.)[^.]{0,30}\b(transcripts?|grade (reports?|sheets?)|marksheets?|records?)\b/i },
  { key: "TRANSCRIPT_MASTER", label: "Master's transcript", re: /\b(master'?s?|graduate|MSc|M\.Sc\.)[^.]{0,30}\b(transcripts?|grade (reports?|sheets?)|marksheets?|records?)\b/i },
  { key: "TRANSCRIPTS", label: "Academic transcripts", re: /\b(transcripts?( of records)?|academic records?|grade (reports?|sheets?|transcripts?)|marksheets?|diploma supplement|official records of (your )?studies)\b/i },
  { key: "DEGREE_CERTIFICATE", label: "Degree certificate(s)", re: /\b(degree certificates?|diplomas?|certificates? of (your )?(degree|graduation)|graduation certificates?|proof of (degree|graduation))\b/i },
  { key: "ENGLISH_PROFICIENCY", label: "English proficiency proof (IELTS/TOEFL…)", re: /\b(IELTS|TOEFL|English (language )?(proficiency|test (scores?|results?)|certificate)|proof of English|language certificate)\b/i },
  { key: "RECOMMENDATION_LETTERS", label: "Recommendation letters", re: /\b(letters? of (recommendation|reference)|recommendation letters?|reference letters?|referees?|references|letters? from (two|three|\d) (referees|academics))\b/i },
  { key: "PASSPORT", label: "Passport / ID copy", re: /\b(passport|copy of (your )?(ID|identity (card|document))|national ID)\b/i },
  { key: "WRITING_SAMPLE", label: "Writing sample", re: /\b(writing sample|sample of (academic )?writing|written work|thesis excerpt)\b/i },
  { key: "PUBLICATIONS", label: "Publications list / copies", re: /\b(list of publications|publication list|copies of (your )?publications|publications \(if any\)|publications)\b/i },
  { key: "PORTFOLIO", label: "Portfolio", re: /\bportfolio\b/i },
  { key: "GRE", label: "GRE scores", re: /\bGRE\b/ },
  { key: "GMAT", label: "GMAT scores", re: /\bGMAT\b/ },
  { key: "MASTER_THESIS", label: "Master's thesis (copy/abstract)", re: /\b(master'?s? thesis|MSc thesis|thesis abstract|copy of (your )?thesis|dissertation)\b/i },
  { key: "SUPERVISOR_CONSENT", label: "Supervisor consent / acceptance letter", re: /\b(supervisor'?s? (consent|agreement|acceptance|confirmation|support letter|letter)|letter of acceptance from (a|the|your) (supervisor|professor)|acceptance letter from)\b/i },
  { key: "PROOF_OF_FUNDING", label: "Proof of funding", re: /\b(proof of (funding|financial (means|resources|support))|financial (statement|guarantee)|bank statement)\b/i },
];

const REQUIRED_CONTEXT = /\b(documents?|materials?|how to apply|application (package|should|must|requirements?|includes?)|to apply|submit|upload|attach|enclose|include|required|checklist|your application)\b/i;
const TEXT_SUBMISSION_CONTEXT = /\b(submit|upload|attach|enclose|please (send|provide|include)|application (must|should) (include|contain)|applications? (must|should) be accompanied|(the )?following (documents|materials)|required documents|supporting documents|application documents|(your|the) application (should|must) (include|contain|consist))\b/i;
const OPTIONAL_RE = /\b(optional(ly)?|if (available|applicable|any)|(may|can) (also )?(include|submit|attach|add)|recommended but not required|encouraged|where (available|applicable))\b/i;
const NOT_REQUIRED_RE = /\b((is|are) not (required|needed|necessary|accepted|considered)|will not be considered|no longer (required|accepted)|not required)\b/i;
const CONDITIONAL_RE = /\b(if (you|applicable|required|requested|your)|only (for|if|when)|applicants? (from|who|whose)|non-native|international applicants|upon request|on request)\b/i;
const REQUIRED_RE = /\b(must|required|mandatory|need to|needs to|should (include|contain|submit|upload)|please (submit|upload|include|attach|send)|essential|obligatory|include(s)?:|the following)\b/i;

// " and " only separates list items when a new noun phrase follows ("… a CV and two references").
const LIST_JOINER = /^ (and|as well as) (a|an|the|your|two|three|four|copies|copy|names?|\d|official|certified|letters?|proof)\b/i;

/** The comma/semicolon-delimited clause containing [start,end), keeping parenthesised details. */
function clauseAround(text: string, start: number, end: number): string {
  let depth = 0;
  let right = text.length;
  for (let i = end; i < text.length; i++) {
    const c = text[i];
    if (c === "(") depth++;
    else if (c === ")") depth = Math.max(0, depth - 1);
    else if (depth === 0 && (c === "," || c === ";" || c === "•" || LIST_JOINER.test(text.slice(i, i + 30)))) {
      right = i;
      break;
    }
  }
  let left = 0;
  depth = 0;
  for (let i = start - 1; i >= 0; i--) {
    const c = text[i];
    if (c === ")") depth++;
    else if (c === "(") depth = Math.max(0, depth - 1);
    else if (depth === 0 && (c === "," || c === ";" || c === "•" || c === ":" || (text.slice(Math.max(0, i - 4), i + 1) === " and " && LIST_JOINER.test(text.slice(i - 4, i + 30))))) {
      left = i + 1;
      break;
    }
  }
  return text.slice(left, right);
}

/** Short single-sentence segment — a negation anywhere in it applies to the document it names. */
function isShortSentence(text: string): boolean {
  return text.length < 160;
}

function numberAfter(re: RegExp, text: string): number | undefined {
  const m = re.exec(text);
  if (!m) return undefined;
  return parseCount(m[1]);
}

export function extractDocuments(segments: Segment[], ctx: ExtractCtx): DocumentRequirement[] {
  const found = new Map<string, DocumentRequirement>();

  for (const seg of segments) {
    const full = withHeading(seg);
    const inDocsContext = (REQUIRED_CONTEXT.test(seg.heading) && (seg.isListItem || TEXT_SUBMISSION_CONTEXT.test(seg.text) || seg.text.length < 200)) || TEXT_SUBMISSION_CONTEXT.test(seg.text);
    if (!inDocsContext) continue;
    // Skip pure navigation/footer-like tiny segments that just mention "CV" etc.
    if (seg.text.length < 3) continue;

    let remaining = seg.text;
    for (const dt of DOC_TYPES) {
      const m = dt.re.exec(remaining);
      if (!m) continue;
      // Remove the matched phrase so broader patterns (TRANSCRIPTS) don't double-count specific ones.
      remaining = remaining.slice(0, m.index) + " ".repeat(m[0].length) + remaining.slice(m.index + m[0].length);
      // References to "reference" in generic sentences ("for reference") are not documents.
      if (dt.key === "RECOMMENDATION_LETTERS" && /\bfor (future )?reference\b|\breference (number|code|id)\b/i.test(seg.text)) continue;
      if (dt.key === "PUBLICATIONS" && !seg.isListItem && !/(list of|copies of|include|submit|attach)/i.test(seg.text)) continue;

      const clause = clauseAround(seg.text, m.index, m.index + m[0].length);
      const local = seg.text.slice(Math.max(0, m.index - 60), m.index + m[0].length + 80);
      let necessity: Necessity = "UNKNOWN";
      let confidence: Confidence = "LOW";
      if (NOT_REQUIRED_RE.test(clause) || (NOT_REQUIRED_RE.test(local) && !seg.isListItem && isShortSentence(seg.text))) {
        necessity = "NOT_REQUIRED";
        confidence = "HIGH";
      } else if (OPTIONAL_RE.test(clause)) {
        necessity = "OPTIONAL";
        confidence = "HIGH";
      } else if (CONDITIONAL_RE.test(clause) || (CONDITIONAL_RE.test(local) && !/\bthe following\b/i.test(local))) {
        necessity = "CONDITIONAL";
        confidence = "MEDIUM";
      } else if (REQUIRED_RE.test(seg.text) || (seg.isListItem && REQUIRED_CONTEXT.test(seg.heading))) {
        necessity = "REQUIRED";
        confidence = REQUIRED_RE.test(seg.text) ? "HIGH" : "MEDIUM";
      } else if (seg.isListItem) {
        necessity = "REQUIRED";
        confidence = "LOW";
      }

      const item: DocumentRequirement = {
        key: dt.key,
        label: dt.label,
        necessity,
        confidence,
        certainty: certaintyFor(ctx.sourceType, confidence),
        evidence: [evidence(ctx, full)],
      };
      const lower = clause;
      item.maxPages = numberAfter(/\b(?:max(?:imum)?(?: of)?|up to|no more than|not exceed(?:ing)?|at most|limit(?:ed)? to)\s+(\d+|one|two|three|four|five|six|ten)\s+(?:A4\s+)?pages?\b/i, lower) ?? numberAfter(/\b(\d+|one|two|three|four|five)[- ]pages?\s*(?:max(?:imum)?|limit|long)?\b/i, lower);
      item.maxWords = numberAfter(/\b(?:max(?:imum)?(?: of)?|up to|no more than|not exceed(?:ing)?|at most|limit(?:ed)? to)\s+([\d,]+)\s+words\b/i, lower.replace(/(\d),(\d{3})/g, "$1$2")) ?? numberAfter(/\b([\d]{3,4})[- ]words?\b/i, lower);
      const size = /\b(\d+(?:\.\d+)?)\s?MB\b/i.exec(lower);
      if (size) item.maxSizeMb = Number(size[1]);
      const fmt = /\b(PDF|DOCX?|Word|JPE?G|PNG)\b(?:\s*(?:format|file|only))?/i.exec(lower);
      if (fmt) item.format = fmt[1].toUpperCase().replace("WORD", "DOC/DOCX");
      if (dt.key === "RECOMMENDATION_LETTERS") {
        item.count = numberAfter(/\b(\d|one|two|three|four|five)\s+(?:(?:academic|professional|confidential)\s+)?(?:letters?|referees?|references|recommend)/i, lower) ?? numberAfter(/\b(?:names? (?:and contact details )?of|contact details (?:for|of))\s+(\d|two|three|four)\b/i, lower);
      }
      if (seg.text.length < 600) item.instructions = seg.text;

      const prev = found.get(dt.key);
      if (!prev) found.set(dt.key, item);
      else {
        // Merge: keep strongest necessity signal and any additional constraints.
        const rank = (n: Necessity, c: Confidence) => (n === "REQUIRED" ? 3 : n === "CONDITIONAL" ? 2 : n === "OPTIONAL" ? 2 : 0) * 10 + (c === "HIGH" ? 3 : c === "MEDIUM" ? 2 : 1);
        if (rank(item.necessity, item.confidence) > rank(prev.necessity, prev.confidence)) {
          prev.necessity = item.necessity;
          prev.confidence = item.confidence;
          prev.certainty = item.certainty;
        }
        prev.maxPages ??= item.maxPages;
        prev.maxWords ??= item.maxWords;
        prev.maxSizeMb ??= item.maxSizeMb;
        prev.format ??= item.format;
        prev.count ??= item.count;
        if (prev.evidence.length < 3) prev.evidence.push(...item.evidence);
      }
    }
  }

  // If only a generic TRANSCRIPTS entry exists alongside specific ones, keep both (they are distinct asks).
  return [...found.values()];
}
