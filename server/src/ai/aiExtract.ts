import { englishSummary } from "../extraction/english.js";
import { certaintyFor } from "../extraction/source.js";
import type { DeadlineFact, Evidence, ExtractionResult, FundingCategory, EnglishStatus } from "../extraction/types.js";
import { getProvider, parseJsonResponse } from "./provider.js";
import { verifyQuote } from "./verify.js";

interface AiField<T> {
  value: T | null;
  quote: string | null;
}

interface AiExtraction {
  application_deadline?: AiField<string>;
  funding_deadline?: AiField<string>;
  funding_category?: AiField<FundingCategory>;
  tuition?: AiField<"COVERED" | "PARTIAL" | "NOT_COVERED">;
  application_fee?: AiField<string>;
  english_status?: AiField<EnglishStatus>;
  ambiguities?: string[];
}

const SYSTEM = `You extract facts about a PhD opportunity from the text of a single web page.
Rules:
- Only report a value if the page states it explicitly. Otherwise return null for both value and quote.
- For every non-null value, "quote" must be copied VERBATIM from the page (a full sentence or table row, 20-300 characters). Do not paraphrase.
- Never infer "fully funded" from the mere mention of a scholarship.
- Dates must be YYYY-MM-DD and only when the page gives day, month and year.
- Respond with a single JSON object and nothing else.`;

function buildPrompt(pageText: string, missing: string[]): string {
  return `Fields needed (the rule-based extractor could not find these): ${missing.join(", ")}.

Return JSON with this shape (omit fields not listed above):
{
  "application_deadline": {"value": "YYYY-MM-DD" | null, "quote": string | null},
  "funding_deadline": {"value": "YYYY-MM-DD" | null, "quote": string | null},
  "funding_category": {"value": "FULLY_FUNDED" | "PARTIALLY_FUNDED" | "SALARIED_POSITION" | "SCHOLARSHIP_AVAILABLE" | "FUNDING_COMPETITIVE" | "SELF_FUNDED" | null, "quote": string | null},
  "tuition": {"value": "COVERED" | "PARTIAL" | "NOT_COVERED" | null, "quote": string | null},
  "application_fee": {"value": "FREE" | "<amount with currency>" | null, "quote": string | null},
  "english_status": {"value": "REQUIRED_AT_APPLICATION" | "REQUIRED_LATER" | "NOT_REQUIRED" | "WAIVER_POSSIBLE" | "REQUIRED_STAGE_UNCLEAR" | null, "quote": string | null},
  "ambiguities": [string]   // wording on the page that is unclear and needs human verification
}

PAGE TEXT:
"""
${pageText.slice(0, 60_000)}
"""`;
}

/**
 * Optional AI pass. Only fills fields the deterministic extractor left UNKNOWN, and only when the
 * model's quote is found verbatim on the page. Rejected claims are reported, never stored.
 */
export async function augmentWithAI(ex: ExtractionResult, pageText: string): Promise<{ extraction: ExtractionResult; accepted: string[]; rejected: string[] }> {
  const provider = getProvider();
  if (!provider) return { extraction: ex, accepted: [], rejected: [] };

  const missing: string[] = [];
  if (!ex.deadlines.some((d) => d.kind === "APPLICATION")) missing.push("application_deadline");
  if (!ex.deadlines.some((d) => d.kind === "FUNDING" || d.kind === "SCHOLARSHIP")) missing.push("funding_deadline");
  if (ex.funding.category.value === null) missing.push("funding_category");
  if (ex.funding.tuition.value === null) missing.push("tuition");
  if (ex.fee.status.value === null) missing.push("application_fee");
  if (["UNKNOWN", "NEEDS_VERIFICATION", "REQUIRED_STAGE_UNCLEAR", null].includes(ex.english.status.value)) missing.push("english_status");
  if (!missing.length) return { extraction: ex, accepted: [], rejected: [] };

  let raw: string;
  try {
    raw = await provider.complete({ system: SYSTEM, prompt: buildPrompt(pageText, missing), maxTokens: 4000 });
  } catch (e) {
    return { extraction: { ...ex, warnings: [...ex.warnings, `AI extraction unavailable: ${(e as Error).message}`] }, accepted: [], rejected: [] };
  }
  const parsed = parseJsonResponse<AiExtraction>(raw);
  if (!parsed) return { extraction: ex, accepted: [], rejected: ["AI response was not valid JSON — ignored."] };

  const next: ExtractionResult = structuredClone(ex);
  const accepted: string[] = [];
  const rejected: string[] = [];
  const ev = (quote: string): Evidence => ({ sourceUrl: ex.url, sourceTitle: ex.pageTitle, sourceType: ex.sourceType, snippet: quote, accessedAt: ex.accessedAt, method: "AI_QUOTE_VERIFIED" });
  const check = <T>(name: string, f?: AiField<T>): f is { value: T; quote: string } => {
    if (!f || f.value === null || f.value === undefined) return false;
    if (!verifyQuote(f.quote, pageText)) {
      rejected.push(`${name}: “${String(f.value)}” — quote not found on the page, discarded.`);
      return false;
    }
    return true;
  };
  const cert = certaintyFor(ex.sourceType, "MEDIUM");
  const note = "AI-extracted; the supporting quote was verified verbatim on the page.";

  const addDeadline = (kind: DeadlineFact["kind"], f: { value: string; quote: string }) => {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(f.value) || !f.quote.includes(f.value.slice(0, 4))) {
      rejected.push(`${kind} deadline: ${f.value} — date/year not literally present in the quote, discarded.`);
      return;
    }
    next.deadlines.push({ kind, date: f.value, dateText: f.value, rolling: false, yearInferred: false, confidence: "MEDIUM", certainty: cert, evidence: [ev(f.quote)], note });
    accepted.push(`${kind.toLowerCase()} deadline`);
  };
  if (missing.includes("application_deadline") && check("application_deadline", parsed.application_deadline)) addDeadline("APPLICATION", parsed.application_deadline);
  if (missing.includes("funding_deadline") && check("funding_deadline", parsed.funding_deadline)) addDeadline("FUNDING", parsed.funding_deadline);
  if (missing.includes("funding_category") && check("funding_category", parsed.funding_category)) {
    const v = parsed.funding_category.value;
    if (v === "FULLY_FUNDED" && !/fully[- ]funded|full (funding|scholarship)|tuition[^.]*(and|plus)[^.]*(stipend|salary)|(stipend|salary)[^.]*(and|plus)[^.]*tuition/i.test(parsed.funding_category.quote)) {
      rejected.push("funding_category: FULLY_FUNDED — the quote does not explicitly state full funding, discarded.");
    } else {
      next.funding.category = { value: v, confidence: "MEDIUM", certainty: cert, evidence: [ev(parsed.funding_category.quote)], note };
      accepted.push("funding category");
    }
  }
  if (missing.includes("tuition") && check("tuition", parsed.tuition)) {
    next.funding.tuition = { value: parsed.tuition.value, confidence: "MEDIUM", certainty: cert, evidence: [ev(parsed.tuition.quote)], note };
    accepted.push("tuition");
  }
  if (missing.includes("application_fee") && check("application_fee", parsed.application_fee)) {
    const v = parsed.application_fee.value;
    if (v === "FREE") next.fee.status = { value: "FREE", confidence: "MEDIUM", certainty: cert, evidence: [ev(parsed.application_fee.quote)], note };
    else next.fee.status = { value: "FEE_REQUIRED", confidence: "MEDIUM", certainty: cert, evidence: [ev(parsed.application_fee.quote)], note: `${note} Stated fee: ${v}` };
    accepted.push("application fee");
  }
  if (missing.includes("english_status") && check("english_status", parsed.english_status)) {
    next.english.status = { value: parsed.english_status.value, confidence: "MEDIUM", certainty: cert, evidence: [ev(parsed.english_status.quote)], note };
    next.english.summary = englishSummary(next.english.status.value, next.english.stage.value, next.english.tests, next.english.waivers);
    accepted.push("English requirement");
  }
  if (parsed.ambiguities?.length) next.warnings.push(...parsed.ambiguities.slice(0, 5).map((a) => `AI flagged ambiguity: ${a}`));
  if (rejected.length) next.warnings.push(`${rejected.length} AI-suggested value(s) were discarded because they could not be verified on the page.`);
  return { extraction: next, accepted, rejected };
}
