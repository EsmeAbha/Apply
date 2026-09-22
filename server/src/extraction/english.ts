import { evidence, fact, isNegated, unknown, withHeading, type ExtractCtx } from "./common.js";
import type { Segment } from "./text.js";
import type { EnglishInfo, EnglishStatus, EnglishTestRequirement, Fact, RequirementStage } from "./types.js";

const ENGLISH_KW = /\b(IELTS|TOEFL|Duolingo|DET\b|PTE|Cambridge (English|C1|C2|Advanced|Proficiency)|C1 Advanced|C2 Proficiency|English (language )?(proficiency|requirements?|tests?|skills|certificates?|qualifications?|competence)|proof of (proficiency in )?English|(proficiency|fluency|competence) in English|(command|knowledge|mastery|proficiency|fluency) of (the )?English|English (language )?skills|fluent (in )?English|language (requirements?|certificates?|proficiency|tests?))/i;

const NOT_REQUIRED_RE = /\b((IELTS|TOEFL|an? English (language )?test|English (language )?(test|certificate|proficiency test)s?)[^.]{0,30}\b(is|are)? ?not (required|mandatory|necessary|needed)(?! (at|for|with|until|before) (the )?(time of |initial |your )?(application|applying))|no (English|language) (test|requirement|certificate|proof)s? (is |are )?(required|needed|necessary)|do(es)? not (need|require) (to submit )?(an? )?(IELTS|TOEFL|English (language )?test))/i;
const LATER_RE = /\b(((can|may|could) be (submitted|provided|sent|uploaded|delivered|handed in)|to be (submitted|provided))( at a)? (later|after|at a later (stage|date|point)|upon|before|prior to|by the time|once)|not (required|necessary|needed|mandatory) (at the time of|at|for the|with (the|your)|when) (initial )?(application|applying|you apply)|(submit|provide|present|send)[^.]{0,50}\b(later|after (admission|acceptance|an offer|being admitted|you receive)|before (enrol|enroll|registration|the start|starting|matriculation)|prior to (enrol|enroll|registration|starting|the start|matriculation))|conditional (offer|admission|acceptance)|admitted conditionally|pending (test )?results|(test )?results? (can|may) (follow|be submitted later)|(if|when) (you|applicants?) (have|has) not (yet )?(taken|received|completed))/i;
const AT_APPLICATION_RE = /\b(((must|should|required to|need to|have to|has to)\s+(be\s+)?(submit(ted)?|includ(e|ed)|provid(e|ed)|upload(ed)?|attach(ed)?|enclos(e|ed)))[^.]{0,70}(IELTS|TOEFL|English|test (scores?|results?))[^.]{0,60}(with (the|your)|at the time of|as part of|by the (application )?deadline|when (you )?apply|in (your|the) application|before the (application )?deadline)|(IELTS|TOEFL|English[^.]{0,30}(proof|certificate|test scores?|results?))[^.]{0,60}(must|should|has to|have to|need to) be (submitted|included|uploaded|provided|attached) (with|at the time of|by the (application )?deadline|as part of|together with|before the (application )?deadline)|applications? without[^.]{0,50}(IELTS|TOEFL|English|test scores?)[^.]{0,50}(will not|won't|cannot) be (considered|processed|accepted|reviewed)|(required|mandatory) (at|with|by) (the time of )?(the )?application( deadline)?)/i;
const WAIVER_RE = /(exempt(ed|ion)?|waive(d|r|rs)?|not (need|required|necessary) to (submit|provide|take)|need not (submit|provide)|do(es)? not need to (submit|provide|take)|are not required to (submit|provide|take))/i;
const WAIVER_CONTEXT_RE = /(degree|studies|education|native|taught|instruction|medium|countries|citizens|nationals|majority English|discretion|case[- ]by[- ]case)/i;
const GENERIC_REQUIRED_RE = /\b(IELTS|TOEFL|English (language )?(proficiency|test|certificate|requirements?|skills)|proof of English|language (certificate|proficiency)|(command|knowledge|mastery|fluency) of (the )?English|fluent (in )?English)[^.]{0,90}\b(required|mandatory|must|need(ed)?|necessary|minimum|at least|expected)\b|\b(required|must (have|provide|demonstrate|show)|need to (demonstrate|provide|show))\b[^.]{0,80}\b(IELTS|TOEFL|English (language )?(proficiency|skills|test))/i;
const HEDGE_RE = /\b(may be (required|asked)|might|depending on|in some cases|could be required|if requested|upon request)\b/i;

function scoreNear(text: string, testRe: RegExp, scoreRe: RegExp, min: number, max: number): { score?: number; idx: number } | null {
  const m = testRe.exec(text);
  if (!m) return null;
  const window = text.slice(m.index, m.index + 110).split(/[;]|\bor\b(?=\s+(?:TOEFL|IELTS|PTE|Duolingo|Cambridge))/i)[0];
  const scores = [...window.matchAll(scoreRe)].map((x) => Number(x[1])).filter((n) => n >= min && n <= max);
  return { score: scores[0], idx: m.index };
}

function detectTests(t: string, ctx: ExtractCtx): EnglishTestRequirement[] {
  const out: EnglishTestRequirement[] = [];
  const ev = [evidence(ctx, t)];
  const ielts = scoreNear(t, /\bIELTS\b/i, /\b(\d(?:\.[05])?)\b/g, 4, 9);
  if (ielts) {
    const sec = /no (?:band|section|component|sub-?score|individual score|module|part)s?[^.]{0,30}?(?:below|less than|lower than|under)\s*(\d(?:\.[05])?)|(?:minimum|at least)(?: of)? (\d(?:\.[05])?) in (?:each|all|every) (?:band|section|component|module|skill)|(\d(?:\.[05])?) in (?:each|all|every) (?:band|section|component|module|skill)|(?:each|all|every) (?:band|section|component|module|skill)s?[^.]{0,20}?(?:at least|minimum(?: of)?|≥)\s*(\d(?:\.[05])?)/i.exec(t);
    const minSection = sec ? Number(sec[1] ?? sec[2] ?? sec[3] ?? sec[4]) : undefined;
    out.push({ test: "IELTS", minOverall: ielts.score, minSection: minSection && minSection <= 9 ? minSection : undefined, evidence: ev });
  }
  const toefl = scoreNear(t, /\bTOEFL\b/i, /\b(\d{2,3})\b/g, 40, 120);
  if (toefl) {
    const sec = /TOEFL[^.]{0,120}?(?:no (?:section|sub-?score|component)s? (?:below|less than|lower than|under)|minimum of|at least) (\d{1,2}) (?:in|on|for) (?:each|all|every)/i.exec(t);
    out.push({ test: "TOEFL", minOverall: toefl.score, minSection: sec ? Number(sec[1]) : undefined, evidence: ev });
  }
  const det = scoreNear(t, /\b(Duolingo|DET)\b/i, /\b(\d{2,3})\b/g, 60, 160);
  if (det) out.push({ test: "DUOLINGO", minOverall: det.score, evidence: ev });
  const pte = scoreNear(t, /\bPTE\b/i, /\b(\d{2})\b/g, 30, 90);
  if (pte) out.push({ test: "PTE", minOverall: pte.score, evidence: ev });
  if (/\b(Cambridge (English|C1|C2|Advanced|Proficiency)|C1 Advanced|C2 Proficiency|CAE|CPE)\b/.test(t)) out.push({ test: "CAMBRIDGE", evidence: ev });
  return out;
}

function stageFrom(text: string): RequirementStage {
  if (/\b(before|prior to) (the )?(enrol|enroll|registration|matriculation|the start|starting|commencement)/i.test(text)) return "BEFORE_ENROLMENT";
  if (/\b(after|upon|following) (admission|acceptance|an offer|being admitted|receiving an offer)|conditional (offer|admission|acceptance)|admitted conditionally/i.test(text)) return "AFTER_ADMISSION";
  return "UNKNOWN";
}

export function extractEnglish(segments: Segment[], ctx: ExtractCtx): EnglishInfo {
  const tests: EnglishTestRequirement[] = [];
  const waivers: EnglishInfo["waivers"] = [];
  let notRequired: Fact<boolean> = unknown();
  let later: Fact<RequirementStage> = unknown();
  let atApplication: Fact<boolean> = unknown();
  let genericRequired: Fact<boolean> = unknown();
  let hedged: Fact<boolean> = unknown();
  let conditional: Fact<boolean> = unknown();
  let mentioned = false;

  for (const seg of segments) {
    const t = seg.text;
    const full = withHeading(seg);
    if (!ENGLISH_KW.test(full)) continue;
    const directlyAboutEnglish = ENGLISH_KW.test(t);
    if (!directlyAboutEnglish && !/(language|test|score|proficien|exempt|waive)/i.test(t)) continue;
    mentioned = true;

    for (const test of detectTests(t, ctx)) {
      const existing = tests.find((x) => x.test === test.test);
      if (!existing) tests.push(test);
      else {
        existing.minOverall ??= test.minOverall;
        existing.minSection ??= test.minSection;
      }
    }

    const w = WAIVER_RE.exec(t);
    if (w && WAIVER_CONTEXT_RE.test(t)) {
      const reason = /(taught|instruction|medium|conducted|completed|studied)[^.]{0,40}\bin English|English[- ]medium|language of instruction|English[- ]taught/i.test(t)
        ? "ENGLISH_MEDIUM_DEGREE"
        : /(native|majority English|English[- ]speaking countr|countries|citizens|nationals)/i.test(t)
          ? "NATIVE_SPEAKER_COUNTRY"
          : /(discretion|case[- ]by[- ]case|may be waived)/i.test(t)
            ? "UNIVERSITY_DISCRETION"
            : "OTHER";
      if (!waivers.some((x) => x.reason === reason)) waivers.push({ reason, text: t, evidence: [evidence(ctx, t)] });
      continue; // a waiver sentence is not itself a requirement statement
    }

    if (notRequired.value === null && NOT_REQUIRED_RE.test(t)) notRequired = fact(ctx, true, "HIGH", t);
    if (later.value === null && LATER_RE.test(t)) {
      later = fact(ctx, stageFrom(t), "HIGH", t);
    }
    if (conditional.value === null && /conditional (offer|admission|acceptance)|admitted conditionally/i.test(t)) conditional = fact(ctx, true, "HIGH", t);
    const atApp = AT_APPLICATION_RE.exec(t);
    if (atApplication.value === null && atApp && !isNegated(t, atApp.index + atApp[0].search(/required|mandatory|must|should|need|have to|has to|without/i))) {
      atApplication = fact(ctx, true, "HIGH", t);
    }
    const explicitlyNotRequired = NOT_REQUIRED_RE.test(t) || /\bnot (required|mandatory|necessary|needed)\b/i.test(t);
    if (genericRequired.value === null && GENERIC_REQUIRED_RE.test(t) && !explicitlyNotRequired) {
      const docsContext = /(document|how to apply|application (package|materials|requirements)|submit|upload|attach|checklist|required)/i.test(seg.heading);
      genericRequired = fact(ctx, true, docsContext ? "MEDIUM" : "LOW", full);
      if (docsContext && seg.isListItem && atApplication.value === null) {
        atApplication = fact(ctx, true, "MEDIUM", full, "Listed among the documents to submit with the application.");
      }
    }
    if (hedged.value === null && HEDGE_RE.test(t)) hedged = fact(ctx, true, "MEDIUM", t);
  }

  // ── Resolve a single status, surfacing conflicts instead of guessing.
  let status: Fact<EnglishStatus>;
  let stage: Fact<RequirementStage> = unknown();
  if (notRequired.value && !atApplication.value && !genericRequired.value) {
    status = { ...notRequired, value: "NOT_REQUIRED" };
  } else if (later.value !== null && atApplication.value && atApplication.confidence === "HIGH") {
    status = {
      value: "NEEDS_VERIFICATION",
      confidence: "LOW",
      certainty: "CONFLICTING",
      evidence: [...atApplication.evidence, ...later.evidence],
      note: "The page says English proof is required at application AND that it can be submitted later. Verify with the admissions office.",
    };
  } else if (later.value !== null) {
    status = { ...later, value: "REQUIRED_LATER" };
    stage = later;
  } else if (atApplication.value) {
    status = { ...atApplication, value: "REQUIRED_AT_APPLICATION" };
    stage = { ...atApplication, value: "APPLICATION" };
  } else if (waivers.length && !genericRequired.value) {
    status = { value: "WAIVER_POSSIBLE", confidence: "MEDIUM", certainty: "LIKELY", evidence: waivers.flatMap((w) => w.evidence) };
  } else if (genericRequired.value) {
    status = { ...genericRequired, value: "REQUIRED_STAGE_UNCLEAR", note: "English proficiency is required, but the page does not say at which stage proof must be submitted." };
  } else if (mentioned || tests.length) {
    status = { value: "NEEDS_VERIFICATION", confidence: "LOW", certainty: "POSSIBLE", evidence: tests.flatMap((t) => t.evidence).slice(0, 2), note: "English requirements are mentioned but the wording is ambiguous." };
  } else {
    status = unknown("No English-language requirement found on this page. Check the university's general admission requirements page.");
  }
  if (hedged.value && status.value === "REQUIRED_STAGE_UNCLEAR") {
    status = { ...status, value: "NEEDS_VERIFICATION", certainty: "POSSIBLE", note: "The requirement is hedged (\"may be required\", \"depending on\") — verify with the university." };
  }
  if (hedged.value && status.value !== "NOT_REQUIRED" && status.certainty === "VERIFIED") {
    status = { ...status, certainty: "LIKELY", note: [status.note, "Wording is hedged (\"may be required\", \"depending on\") — verify manually."].filter(Boolean).join(" ") };
  }

  const canApplyBeforeResult: Fact<boolean> =
    status.value === "REQUIRED_LATER" ? { ...status, value: true } :
    status.value === "NOT_REQUIRED" ? { ...status, value: true } :
    status.value === "REQUIRED_AT_APPLICATION" ? { ...status, value: false } : unknown();

  return {
    status,
    stage,
    tests,
    waivers,
    canApplyBeforeResult,
    conditionalAdmission: conditional,
    summary: englishSummary(status.value, stage.value, tests, waivers),
  };
}

export function englishSummary(status: EnglishStatus | null, stage: RequirementStage | null, tests: EnglishTestRequirement[], waivers: EnglishInfo["waivers"]): string {
  const stageText = stage === "BEFORE_ENROLMENT" ? "Proof required before enrolment" : stage === "AFTER_ADMISSION" ? "Proof required after admission (conditional offer possible)" : "Proof can be submitted later (stage not specified)";
  let s: string;
  switch (status) {
    case "REQUIRED_AT_APPLICATION": s = "REQUIRED AT APPLICATION"; break;
    case "REQUIRED_LATER": s = `NOT REQUIRED AT INITIAL APPLICATION — ${stageText}`; break;
    case "NOT_REQUIRED": s = "NOT REQUIRED (per source)"; break;
    case "WAIVER_POSSIBLE": s = "MAY BE WAIVED"; break;
    case "REQUIRED_STAGE_UNCLEAR": s = "REQUIRED — STAGE NOT STATED (NEEDS VERIFICATION)"; break;
    case "NEEDS_VERIFICATION": s = "NEEDS MANUAL VERIFICATION"; break;
    default: s = "UNKNOWN";
  }
  const testText = tests
    .filter((t) => t.minOverall !== undefined)
    .map((t) => `${t.test} ${t.minOverall}${t.minSection ? ` (min ${t.minSection} per section)` : ""}`)
    .join(" / ");
  if (testText) s += ` · ${testText}`;
  if (waivers.length) {
    const reasons = waivers.map((w) => w.reason === "ENGLISH_MEDIUM_DEGREE" ? "previous degree taught in English" : w.reason === "NATIVE_SPEAKER_COUNTRY" ? "citizens of listed English-speaking countries" : w.reason === "UNIVERSITY_DISCRETION" ? "at the university's discretion" : "see source");
    s += ` · Waiver possible: ${[...new Set(reasons)].join("; ")}`;
  }
  return s;
}
