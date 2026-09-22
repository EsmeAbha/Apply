import { evidence, fact, unknown, withHeading, type ExtractCtx } from "./common.js";
import { findDates } from "./dates.js";
import { certaintyFor } from "./source.js";
import type { Segment } from "./text.js";
import type { Conflict, DeadlineFact, DeadlineKind, Fact } from "./types.js";

interface KindRule {
  kind: DeadlineKind;
  re: RegExp;
  strength: "strong" | "weak";
}

// Order matters: more specific rules first.
const RULES: KindRule[] = [
  { kind: "SUPERVISOR_CONTACT", re: /(contact(ed)?|approach|find|secure|identify)[^.]{0,60}(supervisor|advisor|professor|potential mentor)[^.]{0,40}(by|before|no later than|deadline)|supervisor (approval|agreement|consent|confirmation)[^.]{0,40}(by|before|deadline)/i, strength: "strong" },
  { kind: "SCHOLARSHIP", re: /scholarship[^.]{0,40}(deadline|closing|apply by|applications? (close|due))|(deadline|closing date)[^.]{0,30}scholarship|to be considered for[^.]{0,40}scholarship/i, strength: "strong" },
  { kind: "FUNDING", re: /(funding|fellowship|studentship|stipend|financial support|award)[^.]{0,40}(deadline|closing|consideration|apply by|due)|(deadline|closing date)[^.]{0,30}(funding|fellowship|studentship)|to be considered for[^.]{0,40}(funding|fellowship|studentship|financial)|priority (deadline|consideration) for funding/i, strength: "strong" },
  { kind: "DEPARTMENT", re: /department(al)? deadline|(faculty|school|graduate school) deadline/i, strength: "strong" },
  { kind: "OPENING", re: /(applications?|portal|call|submission)\s+(will\s+)?(open|opens|opening|period starts|starts?)\b|open(s|ing)? for applications|opening date|from\s*$/i, strength: "strong" },
  { kind: "START_DATE", re: /(start(ing)? date|starts? on|commenc(e|ing|ement)|expected start|entry|intake|employment (start|begins)|begin(s|ning)? (on|in)|position starts|anticipated start)/i, strength: "strong" },
  { kind: "OTHER", re: /(interviews?|notif(y|ied|ication)|decisions?|results? (will|are)|announce|shortlist|information session|webinar|open day|posted|published|updated)[^.]{0,50}$/i, strength: "weak" },
  { kind: "APPLICATION", re: /(\b(and |to |but )?(close|closes|closing|due|ends?)( on| by)?\s*$)|(application|applications|submission)s?\s*(deadline|due|closing)|deadline for (applications?|submission|applying)|closing date|apply (by|before|no later than|until)|applications? (must|should) be (received|submitted|sent|uploaded)|applications? (close|closes|closing|are accepted until|accepted until|will be accepted until)|last date (to|for) appl|(send|submit|upload)( in)? (your |the |an |all )?(complete )?(application|documents)[^.]{0,60}\b(by|before|until|no later than|not later than)\s*$|deadline:?\s*$|\bdeadline\b|bewerbungsfrist|sista ansökningsdag|søknadsfrist|hakuaika päättyy/i, strength: "strong" },
];

const ROUND_RE = /\b(round|phase|call|intake|cycle)\s*(\d+|[ivx]+|one|two|three|first|second|third|final)\b|\b(early|regular|priority|final|first|second)\s+(deadline|round)/i;
const ROLLING_RE = /\b(rolling (basis|admissions?|review)|open until (the position is )?filled|until (the )?position(s)? (is|are) filled|applications? (are|will be) (reviewed|considered|assessed) (continuously|on a rolling basis|as they (are|arrive))|no fixed deadline)\b/i;

function classify(localContext: string, segContext: string): { kind: DeadlineKind; strength: "local" | "segment" } | null {
  for (const r of RULES) if (r.re.test(localContext)) return { kind: r.kind, strength: "local" };
  for (const r of RULES) if (r.re.test(segContext)) return { kind: r.kind, strength: "segment" };
  return null;
}

export function extractDeadlines(segments: Segment[], ctx: ExtractCtx): { deadlines: DeadlineFact[]; rolling: Fact<boolean>; conflicts: Conflict[]; warnings: string[] } {
  const deadlines: DeadlineFact[] = [];
  const warnings: string[] = [];
  let rolling: Fact<boolean> = unknown();

  for (const seg of segments) {
    const full = withHeading(seg);
    if (rolling.value === null && ROLLING_RE.test(seg.text)) {
      rolling = fact(ctx, true, "HIGH", seg.text);
    }
    const dates = findDates(seg.text, ctx.referenceDate, { dayFirst: ctx.dayFirst });
    if (!dates.length) continue;

    let prevEnd = 0;
    let prevKind: DeadlineKind | null = null;
    for (const d of dates) {
      const local = seg.text.slice(prevEnd, d.index);
      prevEnd = d.end;
      let cls = classify(local.slice(-140), full);
      // "Round 1: 1 Dec 2026; Round 2: 15 Feb 2027" — later rounds inherit the kind of the first.
      if (prevKind && (!cls || cls.strength === "segment") && local.length < 40 && ROUND_RE.test(local)) {
        cls = { kind: prevKind, strength: "local" };
      }
      if (!cls) continue;
      if (cls.strength === "local") prevKind = cls.kind;
      // Segment-level classification is only trusted when the segment has a single date
      // or the heading itself names the deadline type.
      if (cls.strength === "segment" && dates.length > 1) {
        const headingCls = seg.heading ? classify(seg.heading, "") : null;
        if (!headingCls) continue;
      }
      let confidence: DeadlineFact["confidence"] = cls.strength === "local" ? "HIGH" : "MEDIUM";
      const notes: string[] = [];
      if (d.yearInferred) {
        confidence = "LOW";
        notes.push("Year not stated on the page — the year shown is the next occurrence and must be verified.");
      }
      if (d.ambiguousFormat) {
        confidence = "LOW";
        notes.push(`Ambiguous numeric date "${d.text}" (day/month order unclear) — verify on the official page.`);
      }
      const roundMatch = ROUND_RE.exec(local) ?? ROUND_RE.exec(seg.text.slice(Math.max(0, d.index - 60), d.index));
      deadlines.push({
        kind: cls.kind,
        date: d.date,
        dateText: d.text,
        time: d.time,
        timezone: d.timezone,
        round: roundMatch ? roundMatch[0] : undefined,
        rolling: false,
        yearInferred: d.yearInferred,
        ambiguousFormat: d.ambiguousFormat,
        confidence,
        certainty: certaintyFor(ctx.sourceType, confidence),
        evidence: [evidence(ctx, full)],
        note: notes.join(" ") || undefined,
      });
    }
  }

  // De-duplicate identical kind+date pairs (same fact repeated on the page).
  const unique: DeadlineFact[] = [];
  for (const d of deadlines) {
    const existing = unique.find((u) => u.kind === d.kind && u.date === d.date && (u.round ?? "") === (d.round ?? ""));
    if (existing) {
      if (existing.evidence.length < 3) existing.evidence.push(...d.evidence);
      if (d.confidence === "HIGH") existing.confidence = "HIGH";
      existing.certainty = certaintyFor(ctx.sourceType, existing.confidence);
    } else unique.push(d);
  }

  // Multiple different APPLICATION deadlines without round labels = conflicting (e.g. page lists two dates).
  const conflicts: Conflict[] = [];
  for (const kind of ["APPLICATION", "FUNDING", "SCHOLARSHIP"] as DeadlineKind[]) {
    const ofKind = unique.filter((d) => d.kind === kind && !d.round);
    const distinct = [...new Set(ofKind.map((d) => d.date))];
    if (distinct.length > 1) {
      for (const d of ofKind) d.certainty = "CONFLICTING";
      conflicts.push({
        field: `deadline.${kind}`,
        label: `${kind.toLowerCase()} deadline`,
        values: ofKind.map((d) => ({ value: d.date ?? d.dateText, evidence: d.evidence })),
        action: "VERIFY_MANUALLY",
      });
      warnings.push(`The page lists ${distinct.length} different ${kind.toLowerCase()} deadlines without round labels — they may apply to different programmes or intakes. Verify manually.`);
    }
  }

  if (rolling.value) {
    for (const d of unique) if (d.kind === "APPLICATION") d.rolling = true;
  }
  return { deadlines: unique, rolling, conflicts, warnings };
}

/** Earliest upcoming application deadline (or latest past one if all are past). */
export function primaryApplicationDeadline(deadlines: DeadlineFact[], todayIso: string): DeadlineFact | null {
  const app = deadlines.filter((d) => d.kind === "APPLICATION" && d.date);
  if (!app.length) return null;
  const upcoming = app.filter((d) => d.date! >= todayIso).sort((a, b) => a.date!.localeCompare(b.date!));
  if (upcoming.length) return upcoming[0];
  return app.sort((a, b) => b.date!.localeCompare(a.date!))[0];
}
