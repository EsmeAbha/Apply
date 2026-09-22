import { evidence, fact, findMoney, unknown, type ExtractCtx } from "./common.js";
import type { Segment } from "./text.js";
import type { FeeInfo } from "./types.js";

const FEE_KW = /\b(application|applicant|processing|admission|registration)[- ]fees?\b|\bfee (for|to) (apply|applying|application)\b|\bapplication charge\b/i;
const FREE_RE = /\b(no application fee|application fee:?\s*(none|n\/a|nil|0|zero|free|waived for all)|there is no (application )?fee|(application|applying) is free( of charge)?|free of charge|no fee (is|will be) (charged|required)|does not charge (an )?application fees?|without (an )?application fee|application fees? (is|are) not (charged|required)|no charge to apply|apply for free|kostenlos|gebührenfrei)\b/i;
const WAIVER_RE = /\b(fee waivers?|waiver of the application fee|application fee (waiver|may be waived|can be waived|will be waived|is waived)|waive (the|your) (application )?fee)\b/i;
const WAIVER_NEG_RE = /\b(no (application )?fee waivers?|fee waivers? (are|is) not (available|offered|granted)|cannot waive|do(es)? not (offer|grant|provide) (application )?fee waivers?)\b/i;

const OTHER_COSTS: { label: string; re: RegExp }[] = [
  { label: "uni-assist evaluation fee", re: /\buni-?assist\b/i },
  { label: "Credential evaluation (e.g. WES/ECE)", re: /\b(WES|ECE|credential evaluation|foreign credential)\b[^.]{0,60}\b(required|must|mandatory)\b|\b(required|must)\b[^.]{0,60}\b(WES|credential evaluation)\b/i },
  { label: "Certified / notarised copies", re: /\b(certified|notari[sz]ed|attested|apostille)\b[^.]{0,40}\b(copies|copy|translations?|documents?)\b[^.]{0,40}\b(required|must)\b|\b(must|required)\b[^.]{0,40}\b(certified|notari[sz]ed|apostille)\b/i },
  { label: "Postal / courier submission of documents", re: /\b(by (post|mail|courier)|hard[- ]copies?|paper copies?)\b[^.]{0,60}\b(must|required|should be sent)\b|\b(must|required)\b[^.]{0,60}\b(by (post|mail|courier)|hard[- ]copy)\b/i },
  { label: "Official test score reporting fee", re: /\b(official (score|test) (reports?|results?) (must|should) be sent|sent directly (by|from) (ETS|the testing agency)|institution code)\b/i },
  { label: "Deposit / acceptance fee", re: /\b(enrol(l)?ment deposit|acceptance (fee|deposit)|confirmation deposit|tuition deposit)\b/i },
  { label: "Semester contribution (enrolled students)", re: /\bsemester (contribution|fee|ticket)|semesterbeitrag\b/i },
];

export function extractFee(segments: Segment[], ctx: ExtractCtx): FeeInfo {
  let status: FeeInfo["status"] = unknown();
  let amount: FeeInfo["amount"] = unknown();
  let waiver: FeeInfo["waiver"] = unknown();
  let waiverEligibility: string | undefined;
  const otherMandatoryCosts: FeeInfo["otherMandatoryCosts"] = [];

  for (const seg of segments) {
    const t = seg.text;

    if (status.value === null && FREE_RE.test(t) && !/\bfee waiver\b/i.test(t.match(FREE_RE)?.[0] ?? "")) {
      status = fact(ctx, "FREE", "HIGH", t);
      amount = fact(ctx, { amount: 0, currency: "N/A", text: "0" }, "HIGH", t);
    }

    const kw = FEE_KW.exec(t);
    if (kw && amount.value === null) {
      const monies = findMoney(t).filter((m) => Math.abs(m.index - kw.index) < 140);
      if (monies.length) {
        const m = monies.sort((a, b) => Math.abs(a.index - kw.index) - Math.abs(b.index - kw.index))[0];
        amount = fact(ctx, { amount: m.amount, currency: m.currency, text: m.text }, "HIGH", t);
        status = fact(ctx, m.amount === 0 ? "FREE" : "FEE_REQUIRED", "HIGH", t);
      } else if (status.value === null && /\b(non-refundable|must (be )?pa(y|id)|is required|payable|charged)\b/i.test(t)) {
        status = fact(ctx, "FEE_REQUIRED", "MEDIUM", t, "A fee is mentioned but no amount was found on this page.");
      }
    }

    if (WAIVER_NEG_RE.test(t)) {
      if (waiver.value === null) waiver = fact(ctx, "NOT_AVAILABLE", "HIGH", t);
    } else if (WAIVER_RE.test(t) && waiver.value === null) {
      waiver = fact(ctx, "AVAILABLE", /\b(available|may be|can be|eligible|request)\b/i.test(t) ? "HIGH" : "MEDIUM", t);
      if (/\b(eligible|eligibility|if you|applicants (from|who)|citizens|residents|participants|McNair|financial hardship|low[- ]income|countries)\b/i.test(t)) {
        waiverEligibility = t;
      }
    }

    for (const oc of OTHER_COSTS) {
      if (oc.re.test(t) && !otherMandatoryCosts.some((c) => c.label === oc.label)) {
        const money = findMoney(t)[0];
        otherMandatoryCosts.push({
          label: oc.label,
          amount: money ? { amount: money.amount, currency: money.currency, text: money.text } : undefined,
          evidence: [evidence(ctx, t)],
        });
      }
    }
  }

  // "Free" must not be claimed when another mandatory application-stage cost exists.
  const applicationStageCosts = otherMandatoryCosts.filter((c) => !/Deposit|Semester/.test(c.label));
  if (status.value === "FREE" && applicationStageCosts.length) {
    status = {
      ...status,
      note: `No application fee, but other mandatory costs may apply: ${applicationStageCosts.map((c) => c.label).join(", ")}.`,
    };
  }
  return { status, amount, waiver, waiverEligibility, otherMandatoryCosts };
}
