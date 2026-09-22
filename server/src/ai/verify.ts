/**
 * Anti-hallucination guards.
 *  - verifyQuote: an AI-extracted fact is accepted only if its supporting quote appears verbatim in the page.
 *  - fabricationCheck: flags names, numbers, organisations, emails and URLs in generated text
 *    that do not appear in any of the user's verified sources.
 */

export function normalizeForMatch(s: string): string {
  return s
    .toLowerCase()
    .replace(/[‘’‚‛]/g, "'")
    .replace(/[“”„]/g, '"')
    .replace(/[–—]/g, "-")
    .replace(/\s+/g, " ")
    .trim();
}

export function verifyQuote(quote: string | undefined | null, sourceText: string): boolean {
  if (!quote || quote.trim().length < 8) return false;
  return normalizeForMatch(sourceText).includes(normalizeForMatch(quote));
}

const COMMON_CAPITALISED = new Set(
  "I Dear Sincerely Yours Regards Best Kind Thank Thanks The This That These Those My Our We You It In On At For With From To As By Of And But Or If When While During After Before Since Through Moreover Furthermore However Therefore Additionally Finally First Second Third Firstly Secondly Lastly PhD Ph.D Doctoral Master Master's Bachelor Bachelor's University Department School Faculty Professor Prof Dr Mr Ms Mrs Statement Purpose Cover Letter Research Proposal Introduction Background Motivation Objectives Methodology Timeline Conclusion References Abstract Aims Expected Outcomes Year Years Month Months January February March April May June July August September October November December Monday Tuesday Wednesday Thursday Friday English AI ML NLP LLM LLMs CV SOP Subject Hi Hello Please Looking Given Specifically Although Because Beyond Within Over Under Upon Across One Two Three Four Five Phase Work Package Q1 Q2 Q3 Q4 Why What How Which Where Who Following Overall Currently Recently Additionally Ultimately Also Thus Hence Here There Such Each Both All Any Some Several Many Most More Further Across Between Title Proposed Relevant Related Potential Possible Contributions Contribution Plan Question Questions RQ1 RQ2 RQ3 Aim Objective Goals Goal Summary Note Placeholder TODO Is Are Was Were Will Would Could Should Can May Might Must Do Does Did Have Has Had Not No Yes".split(
    " ",
  ),
);

export interface FabricationWarning {
  claim: string;
  kind: "NAME_OR_ENTITY" | "NUMBER" | "EMAIL" | "URL";
  message: string;
}

export function fabricationCheck(generated: string, sources: string[]): FabricationWarning[] {
  const corpus = normalizeForMatch(sources.join("\n"));
  const warnings: FabricationWarning[] = [];
  const seen = new Set<string>();
  const text = generated.replace(/\[[^\]]*\]/g, " "); // bracketed placeholders are intentional

  const push = (claim: string, kind: FabricationWarning["kind"]) => {
    const key = `${kind}:${claim.toLowerCase()}`;
    if (seen.has(key)) return;
    seen.add(key);
    const message =
      kind === "NUMBER"
        ? `The number “${claim}” does not appear in your profile, documents or the opportunity page.`
        : kind === "EMAIL"
          ? `The email “${claim}” was not found in your sources.`
          : kind === "URL"
            ? `The link “${claim}” was not found in your sources.`
            : `“${claim}” does not appear in your verified profile, documents or the opportunity page — check it is accurate.`;
    warnings.push({ claim, kind, message });
  };

  for (const m of text.matchAll(/[\w.+-]+@[\w-]+(\.[\w-]+)+/g)) if (!corpus.includes(m[0].toLowerCase())) push(m[0], "EMAIL");
  for (const m of text.matchAll(/https?:\/\/[^\s)]+/g)) if (!corpus.includes(m[0].toLowerCase().replace(/[.,]$/, ""))) push(m[0], "URL");

  // Numbers: percentages, scores, counts, years (common small numbers are ignored).
  for (const m of text.matchAll(/\b\d+(?:[.,]\d+)?%?/g)) {
    const n = m[0];
    if (/^(1|2|3|4|5|6|7|8|9|10|0)$/.test(n)) continue;
    if (!corpus.includes(n.toLowerCase())) push(n, "NUMBER");
  }

  // Capitalised multi-word or single proper nouns not at sentence start.
  for (const m of text.matchAll(/(?<![.!?:]\s|^|\n)\b([A-Z][\p{L}'’-]+(?:\s+(?:of|for|and|de|van|von|the)?\s*[A-Z][\p{L}'’-]+){0,4})/gmu)) {
    const phrase = m[1].trim();
    const words = phrase.split(/\s+/).filter((w) => !COMMON_CAPITALISED.has(w.replace(/[’']s$/, "")));
    if (!words.length) continue;
    const candidate = phrase.replace(/[’']s$/, "");
    if (!corpus.includes(normalizeForMatch(candidate)) && !words.every((w) => corpus.includes(w.toLowerCase()))) {
      push(candidate, "NAME_OR_ENTITY");
    }
  }
  return warnings.slice(0, 40);
}
