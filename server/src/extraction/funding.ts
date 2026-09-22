import { evidence, fact, findMoney, isNegated, parseCount, unknown, withHeading, type ExtractCtx } from "./common.js";
import type { Segment } from "./text.js";
import type { Fact, FundingCategory, FundingInfo, MoneyAmount } from "./types.js";

const FULLY_FUNDED_RE = /\b(fully[- ]funded|full(y)? funding|full (phd )?scholarship|full studentship|fully[- ]paid|full financial support|funded in full|100\s?% (funded|scholarship))\b/i;
const PARTIAL_RE = /\b(partial(ly)?[- ](funded|funding|scholarship|tuition)|partial (fee|tuition) (waiver|reduction)|tuition (fee )?reduction|(25|50|75)\s?% (tuition|fee|scholarship))\b/i;
const SELF_FUNDED_RE = /\b(self[- ]funded|unfunded|no funding (is )?(available|attached|provided)|(must|need to|required to) (secure|provide|obtain|find) (their|your) own funding|without funding|not funded|applicants? (with|who have) (their )?own funding)\b/i;
const COMPETITIVE_RE = /\b(competitive(ly)?( basis| funding| scholarships?| awards?)?|subject to (availability|funding|the availability of funding)|may be (eligible|considered) for|can apply for (a |the )?(scholarship|funding|fellowship)|limited number of (scholarships|funded|studentships|fellowships)|eligible to compete|considered for (funding|scholarships?))\b/i;
const SCHOLARSHIP_AVAIL_RE = /\b(scholarships?|fellowships?|studentships?|bursar(y|ies)|grants?) (are|is|may be) (available|offered|awarded)\b/i;
const SALARY_RE = /\b(salary|salaried|employment contract|employed (as|full[- ]time)|gross (monthly|annual)? ?(salary|pay)|monthly pay|pay(ment)? (grade|scale)|remuneration|TV-?L\s?E\s?1[34]|E\s?13|salary grade|wage|lønn|lön|palkka|doctoral (student )?salary)\b/i;
const STIPEND_RE = /\b(stipend|living allowance|maintenance (grant|allowance|stipend)|monthly allowance|annual allowance|tax[- ]free (stipend|allowance)|studentship of|bursary of|scholarship of|living costs)\b/i;
const GUARANTEED_RE = /\b(guaranteed (funding|financial support|for \w+ years)|all (admitted|accepted) (phd |doctoral )?students (receive|are (fully )?funded|are offered)|every (admitted )?(phd )?student (receives|is funded))\b/i;
const TUITION_COVERED_RE = /\b(tuition(?: fees?)? (waiver|remission|exemption)|(tuition|tuition fees?|fees) (are|is|will be) (fully )?(covered|waived|paid|included|funded)|(covers?|covering|including|includes|plus|pays?) (full |all |the )?(university )?(tuition|tuition fees|fees)|full tuition|no tuition( fees)?|tuition[- ]free|free of tuition|there are no tuition fees|does not charge tuition)\b/i;
const TUITION_PARTIAL_RE = /\b(partial tuition|tuition (fee )?(reduction|discount)|(25|50|75)\s?% (of )?(the )?(tuition|fees))\b/i;
const TUITION_NOT_COVERED_RE = /\b((tuition|tuition fees) (are not|is not|not) (covered|included|waived)|students (must )?pay (the )?tuition|tuition fees? (of|apply|are charged|is charged|must be paid)|responsible for (paying )?(the )?tuition)\b/i;
const DURATION_RE = /\b(for|of|duration( of)?|period( of)?|up to|lasting|contract (of|for)|appointment (of|for)|funded for|funding for)\s+(\d|one|two|three|four|five|six)(\.\d)?\s*(\+\s*\d\s*)?(years?|months?)\b|\b(\d|three|four|five)[- ](year|years)\s+(position|contract|appointment|scholarship|studentship|fellowship|funding|phd|doctoral|programme|program)\b/i;
const POSITIONS_RE = /\b(\d+|one|two|three|four|five|six|seven|eight|nine|ten)\s+(fully[- ]funded\s+)?(phd|doctoral|ph\.d\.|research)\s+(positions?|scholarships?|studentships?|fellowships?|candidates?|researchers?|students?|vacancies)\b/i;
const FUNDER_RE = /\b(?:funded|financed|sponsored|supported) by (?:the )?([A-Z][\w&'’.-]*(?:\s+(?:of|for|and|the|[A-Z][\w&'’.-]*)){0,8})/;

const BENEFITS: { benefit: string; re: RegExp }[] = [
  { benefit: "Health insurance", re: /\b(health (insurance|care|coverage|benefits?)|medical (insurance|coverage))\b[^.]{0,60}\b(included|covered|provided|paid|offered)|\b(includes?|covers?|provides?|plus|with)\b[^.]{0,40}\b(health (insurance|care|coverage)|medical insurance)\b/i },
  { benefit: "Travel / conference allowance", re: /\b(travel (allowance|budget|funds?|funding|grant)|conference (travel|funding|budget|allowance))\b/i },
  { benefit: "Research budget", re: /\b(research (budget|funds|allowance|expenses|training support grant)|RTSG|bench fees (covered|included))\b/i },
  { benefit: "Relocation support", re: /\b(relocation (allowance|support|assistance|package|costs)|moving (costs|allowance|expenses))\b/i },
  { benefit: "Pension / social security", re: /\b(pension (scheme|plan|contributions?)|social security|occupational pension)\b/i },
  { benefit: "Paid holidays / parental leave", re: /\b(\d+ days? (of )?(paid )?(annual )?(leave|holiday|vacation)|parental leave)\b/i },
  { benefit: "Housing support", re: /\b(housing (allowance|support|subsidy|guarantee)|accommodation (is )?(provided|guaranteed|support))\b/i },
];

function pickAmount(text: string, keywordRe: RegExp): MoneyAmount | null {
  const kw = keywordRe.exec(text);
  if (!kw) return null;
  const monies = findMoney(text);
  if (!monies.length) return null;
  // Closest amount after the keyword, otherwise closest overall.
  const after = monies.filter((m) => m.index >= kw.index);
  const chosen = (after.length ? after : monies).sort((a, b) => Math.abs(a.index - kw.index) - Math.abs(b.index - kw.index))[0];
  if (Math.abs(chosen.index - kw.index) > 160) return null;
  return { amount: chosen.amount, currency: chosen.currency, period: chosen.period, text: chosen.text };
}

export function extractFunding(segments: Segment[], ctx: ExtractCtx): FundingInfo {
  let fully: Fact<boolean> = unknown();
  let partial: Fact<boolean> = unknown();
  let selfFunded: Fact<boolean> = unknown();
  let competitive: Fact<boolean> = unknown();
  let scholarshipAvail: Fact<boolean> = unknown();
  let salaried: Fact<boolean> = unknown();
  let tuition: FundingInfo["tuition"] = unknown();
  let stipend: FundingInfo["stipend"] = unknown();
  let salary: FundingInfo["salary"] = unknown();
  let duration: FundingInfo["duration"] = unknown();
  let fundingSource: FundingInfo["fundingSource"] = unknown();
  let guaranteed: FundingInfo["guaranteed"] = unknown();
  let positions: FundingInfo["positions"] = unknown();
  const benefits: FundingInfo["benefits"] = [];

  for (const seg of segments) {
    const t = seg.text;
    const ctxText = withHeading(seg);

    const f = FULLY_FUNDED_RE.exec(t);
    if (f && fully.value === null && !isNegated(t, f.index)) {
      // "a limited number of fully funded places" is competitive, not guaranteed.
      const competitiveHere = COMPETITIVE_RE.test(t);
      fully = fact(ctx, true, competitiveHere ? "MEDIUM" : "HIGH", t, competitiveHere ? "Fully funded places are awarded competitively." : undefined);
      if (competitiveHere && competitive.value === null) competitive = fact(ctx, true, "HIGH", t);
    }
    if (partial.value === null && PARTIAL_RE.test(t)) partial = fact(ctx, true, "HIGH", t);
    const sf = SELF_FUNDED_RE.exec(t);
    if (sf && selfFunded.value === null && !/\b(also|welcome|may also)\b/i.test(t.slice(Math.max(0, sf.index - 30), sf.index))) {
      selfFunded = fact(ctx, true, "HIGH", t);
    } else if (sf && selfFunded.value === null) {
      // "self-funded applicants are also welcome" — note, but don't classify the opportunity as self-funded
      selfFunded = { ...fact(ctx, false, "MEDIUM", t), note: "Self-funded applicants are also accepted." };
    }
    if (competitive.value === null && COMPETITIVE_RE.test(t) && /(fund|scholar|fellow|studentship|award|stipend|financial)/i.test(t)) {
      competitive = fact(ctx, true, "MEDIUM", t);
    }
    if (scholarshipAvail.value === null && SCHOLARSHIP_AVAIL_RE.test(t)) scholarshipAvail = fact(ctx, true, "MEDIUM", t);

    const sal = SALARY_RE.exec(t);
    if (sal && !isNegated(t, sal.index) && !/\bsalary (expectations?|requirements?)\b/i.test(t)) {
      if (salaried.value === null) salaried = fact(ctx, true, "HIGH", t);
      if (salary.value === null) {
        const amt = pickAmount(t, SALARY_RE);
        const payGrade = /\b(TV-?L\s?E\s?1[34](\s?\(\d+\s?%\))?|E\s?13(\s?\(\d+\s?%\))?|salary (grade|scale|band|level)\s*[\w.-]+)\b/i.exec(t);
        const val = amt ? `${amt.text}` : payGrade ? payGrade[0] : null;
        if (val) salary = fact(ctx, val, "HIGH", t);
      }
    }

    if (stipend.value === null && STIPEND_RE.test(t)) {
      const amt = pickAmount(t, STIPEND_RE);
      if (amt) stipend = fact(ctx, amt, "HIGH", t);
    }

    if (tuition.value === null) {
      if (TUITION_NOT_COVERED_RE.test(t)) tuition = fact(ctx, "NOT_COVERED", "HIGH", t);
      else if (TUITION_PARTIAL_RE.test(t)) tuition = fact(ctx, "PARTIAL", "HIGH", t);
      else {
        const tc = TUITION_COVERED_RE.exec(t);
        if (tc && !isNegated(t, tc.index)) tuition = fact(ctx, "COVERED", "HIGH", t);
      }
    }

    if (duration.value === null && /(fund|scholar|fellow|position|contract|appointment|studentship|stipend|salary|employ|phd|doctoral)/i.test(ctxText)) {
      const d = DURATION_RE.exec(t);
      if (d) duration = fact(ctx, d[0].replace(/^(for|of|duration of|period of|lasting|contract of|contract for|appointment of|appointment for|funded for|funding for)\s+/i, ""), "MEDIUM", t);
    }

    if (positions.value === null) {
      const p = POSITIONS_RE.exec(t);
      if (p) {
        const n = parseCount(p[1]);
        if (n && n < 100) positions = fact(ctx, n, "MEDIUM", t);
      }
    }

    if (fundingSource.value === null && /(fund|financ|sponsor|support)/i.test(t)) {
      const fs = FUNDER_RE.exec(t);
      if (fs && fs[1].length > 2 && !/^(The|This|Our|A)$/.test(fs[1])) fundingSource = fact(ctx, fs[1].trim().replace(/[.,;]$/, ""), "MEDIUM", t);
    }

    if (guaranteed.value === null && GUARANTEED_RE.test(t)) guaranteed = fact(ctx, "GUARANTEED", "HIGH", t);

    for (const b of BENEFITS) {
      const m = b.re.exec(t);
      if (m && !isNegated(t, m.index) && !benefits.some((x) => x.benefit === b.benefit)) {
        benefits.push({ benefit: b.benefit, evidence: [evidence(ctx, t)] });
      }
    }
  }

  if (guaranteed.value === null && competitive.value === true) {
    guaranteed = { ...competitive, value: "COMPETITIVE" };
  }

  // ── Category decision — explicit evidence only, never inferred from a bare "scholarship" mention.
  let category: Fact<FundingCategory>;
  if (selfFunded.value === true && fully.value === null && salaried.value === null && stipend.value === null) {
    category = { ...selfFunded, value: "SELF_FUNDED" };
  } else if (fully.value === true) {
    category = { ...fully, value: competitive.value && fully.confidence !== "HIGH" ? "FUNDING_COMPETITIVE" : "FULLY_FUNDED" };
    if (category.value === "FUNDING_COMPETITIVE") category.note = "The page mentions fully funded places, but awards are competitive.";
  } else if (tuition.value === "COVERED" && (stipend.value || salary.value)) {
    category = {
      value: "FULLY_FUNDED",
      confidence: "MEDIUM",
      certainty: tuition.certainty === "VERIFIED" ? "LIKELY" : tuition.certainty,
      evidence: [...tuition.evidence, ...(stipend.value ? stipend.evidence : salary.evidence)],
      note: "Derived from two explicit statements: tuition is covered AND a stipend/salary is stated. The page does not literally say \"fully funded\".",
    };
  } else if (salaried.value === true) {
    category = { ...salaried, value: "SALARIED_POSITION", note: "Paid employment (salary). Tuition coverage is not explicitly stated unless shown below." };
  } else if (partial.value === true) {
    category = { ...partial, value: "PARTIALLY_FUNDED" };
  } else if (competitive.value === true) {
    category = { ...competitive, value: "FUNDING_COMPETITIVE" };
  } else if (scholarshipAvail.value === true) {
    category = { ...scholarshipAvail, value: "SCHOLARSHIP_AVAILABLE", note: "Scholarships are mentioned as available; this does not mean the position is funded." };
  } else if (stipend.value) {
    category = { ...stipend, value: "PARTIALLY_FUNDED", confidence: "LOW", certainty: "POSSIBLE", note: "A stipend is stated but tuition coverage is not — treat as partial until verified." };
  } else {
    category = unknown("No explicit funding statement found on this page.");
    category.value = null;
  }

  return { category, tuition, stipend, salary, duration, benefits, fundingSource, guaranteed, positions };
}
