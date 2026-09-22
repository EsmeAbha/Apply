import type { ExtractionResult } from "../extraction/types.js";
import { RESEARCH_AREAS } from "../extraction/meta.js";
import type { ProfileBundle } from "./profile.js";

export type Level = "HIGH" | "MEDIUM" | "LOW" | "UNKNOWN";

export interface MatchAnalysis {
  researchAlignment: { level: Level; matched: string[]; explanation: string };
  degreeCompatibility: { level: "LIKELY_COMPATIBLE" | "CHECK_REQUIREMENT" | "UNKNOWN"; explanation: string; requirementQuote?: string };
  technicalSkills: { matched: string[]; explanation: string };
  publicationAlignment: { matched: string[]; explanation: string };
  experienceAlignment: { matched: string[]; explanation: string };
  english: { status: string; userStatus: string; explanation: string; action: string };
  funding: string;
  applicationCost: string;
  deadline: string;
  disclaimer: string;
}

const tokenize = (s: string) =>
  s
    .toLowerCase()
    .split(/[^a-z0-9+#]+/)
    .filter((w) => w.length > 2 && !STOP.has(w));
const STOP = new Set("and the for with from into using based towards via our your their this that phd research learning systems system".split(" "));

function areaMatches(interest: string, text: string): boolean {
  const known = RESEARCH_AREAS.find((a) => a.name.toLowerCase() === interest.toLowerCase());
  if (known) return known.re.test(text);
  return text.toLowerCase().includes(interest.toLowerCase());
}

/**
 * Transparent, factual comparison between the user's verified profile and an opportunity.
 * This is NOT an admission probability and must never be presented as one.
 */
export function matchAnalysis(b: ProfileBundle, ex: ExtractionResult, docsReady?: { ready: number; required: number }): MatchAnalysis {
  const oppText = [ex.title.value, ex.department.value, ex.researchAreas.join(" "), ex.summary, ...ex.documents.map((d) => d.instructions ?? "")]
    .filter(Boolean)
    .join(" ");
  const oppAreas = new Set(ex.researchAreas.map((a) => a.toLowerCase()));

  // Research alignment
  const interests = b.interests.map((i) => i.name);
  const matched = interests.filter((i) => oppAreas.has(i.toLowerCase()) || areaMatches(i, `${ex.title.value ?? ""} ${ex.researchAreas.join(" ")}`));
  const titleHit = interests.some((i) => areaMatches(i, ex.title.value ?? ""));
  const level: Level = !interests.length ? "UNKNOWN" : matched.length >= 2 || (titleHit && matched.length >= 1) ? "HIGH" : matched.length === 1 ? "MEDIUM" : "LOW";

  // Degree compatibility (quote the requirement; never decide eligibility for the user)
  const req = ex.degreeRequirement.value ?? "";
  const userDegrees = [b.profile.currentDegree, b.profile.field, ...b.education.map((e) => `${e.degree} ${e.field ?? ""}`)].filter(Boolean).join(" ").toLowerCase();
  let degree: MatchAnalysis["degreeCompatibility"];
  if (!req) degree = { level: "UNKNOWN", explanation: "The source does not state a degree requirement. Check the programme's admission requirements." };
  else {
    const fieldsInReq = ["computer science", "informatics", "computer engineering", "artificial intelligence", "data science", "intelligent systems", "related"].filter((f) => req.toLowerCase().includes(f));
    const userHasMasters = /master|msc|m\.sc/.test(userDegrees);
    const fieldOk = fieldsInReq.some((f) => f === "related" || userDegrees.includes(f) || (f === "computer science" && /computer science|cse/.test(userDegrees)));
    degree =
      /master/i.test(req) && userHasMasters && fieldOk
        ? { level: "LIKELY_COMPATIBLE", explanation: "Your Master's field appears to match the stated requirement. Confirm eligibility with the university (e.g. degree completion date, grade requirements).", requirementQuote: req }
        : { level: "CHECK_REQUIREMENT", explanation: "Compare the stated requirement with your degrees and completion dates.", requirementQuote: req };
  }

  const skills = [...(b.profile.skills as string[]), ...(b.profile.programmingLanguages as string[])];
  const oppLower = oppText.toLowerCase();
  const skillMatches = skills.filter((s) => s && oppLower.includes(s.toLowerCase()));

  const oppTokens = new Set(tokenize(oppText));
  const pubs = b.items.filter((i) => i.verified && i.kind === "PUBLICATION");
  const pubMatches = pubs.filter((p) => tokenize(`${p.title} ${p.description ?? ""}`).filter((t) => oppTokens.has(t)).length >= 2).map((p) => p.title);
  const exp = b.items.filter((i) => i.verified && ["PROJECT", "RESEARCH_EXPERIENCE", "WORK_EXPERIENCE"].includes(i.kind));
  const expMatches = exp.filter((p) => tokenize(`${p.title} ${p.description ?? ""}`).filter((t) => oppTokens.has(t)).length >= 2).map((p) => p.title);

  // English vs the user's IELTS status
  const es = ex.english.status.value ?? "UNKNOWN";
  const userIelts = b.profile.ieltsStatus;
  const hasScore = userIelts === "SCORE_RECEIVED";
  const engExplain: Record<string, [string, string]> = {
    REQUIRED_AT_APPLICATION: [hasScore ? "Required at application — you have a score; check it meets the minimum." : "Required at application and you do not have a score yet.", hasScore ? "Compare your score with the minimum." : "Book IELTS/TOEFL in time, or check whether a waiver applies to you (do not assume it does)."],
    REQUIRED_LATER: ["You can apply before having a test result; proof is needed later.", "Plan your IELTS before the stated stage (e.g. before enrolment)."],
    NOT_REQUIRED: ["The source states no English test is required.", "Keep the source for your records."],
    WAIVER_POSSIBLE: ["A waiver may be possible under stated conditions.", "Ask the admissions office whether you qualify — do not assume."],
    REQUIRED_STAGE_UNCLEAR: ["English is required but the stage is not stated.", "Email the admissions office to ask whether you can submit IELTS after applying."],
    NEEDS_VERIFICATION: ["The English requirement is ambiguous.", "Verify manually with the university."],
    UNKNOWN: ["No English requirement was found on the source page.", "Check the university's general admission requirements page."],
  };
  const [engText, engAction] = engExplain[es] ?? engExplain.UNKNOWN;

  const primary = ex.deadlines.filter((d) => d.kind === "APPLICATION" && d.date).map((d) => d.date!).sort()[0];
  return {
    researchAlignment: {
      level,
      matched,
      explanation: level === "UNKNOWN" ? "Add research interests to your profile." : matched.length ? `Matches your interests: ${matched.join(", ")}.` : "None of your listed research interests were found in this opportunity.",
    },
    degreeCompatibility: degree,
    technicalSkills: { matched: skillMatches, explanation: skills.length ? (skillMatches.length ? `Mentioned skills you have: ${skillMatches.join(", ")}.` : "None of your listed skills are mentioned on the page.") : "Add skills to your profile to compare." },
    publicationAlignment: { matched: pubMatches, explanation: pubs.length ? `${pubMatches.length} of your ${pubs.length} verified publications share topics with this opportunity.` : "No verified publications in your profile." },
    experienceAlignment: { matched: expMatches, explanation: exp.length ? `${expMatches.length} of your projects/experience entries share topics with this opportunity.` : "No verified projects or experience in your profile." },
    english: { status: es, userStatus: userIelts, explanation: engText, action: engAction },
    funding: (ex.funding.category.value ?? "FUNDING_UNKNOWN").replace(/_/g, " "),
    applicationCost: ex.fee.status.value === "FREE" ? "FREE (no application fee stated)" : ex.fee.amount.value ? `${ex.fee.amount.value.currency} ${ex.fee.amount.value.amount}` : "UNKNOWN",
    deadline: primary ?? "UNKNOWN",
    disclaimer: `This is a factual comparison, not a prediction of admission.${docsReady ? ` Documents ready: ${docsReady.ready}/${docsReady.required}.` : ""}`,
  };
}
