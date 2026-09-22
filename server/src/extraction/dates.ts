import * as chrono from "chrono-node";

export interface DateMatch {
  index: number;
  end: number;
  text: string;
  date: string; // YYYY-MM-DD
  yearInferred: boolean;
  ambiguousFormat: boolean;
  time?: string;
  timezone?: string;
}

const pad = (n: number) => String(n).padStart(2, "0");
const iso = (y: number, m: number, d: number) => `${y}-${pad(m)}-${pad(d)}`;

const NUMERIC_DATE = /\b(\d{1,2})[./](\d{1,2})[./](\d{4})\b/g;
const TIME_TZ =
  /(?:at\s+|,\s*|\s)?((?:[01]?\d|2[0-3])[:.][0-5]\d\s*(?:[ap]\.?m\.?)?|(?:1[0-2]|0?[1-9])\s*[ap]\.?m\.?|midnight|noon)\s*(?:\(?\s*\b(CET|CEST|GMT|BST|UTC|EST|EDT|CST|CDT|MST|MDT|PST|PDT|AEST|AEDT|ACST|AWST|NZST|NZDT|JST|KST|SGT|EET|EEST|WET|WEST|IST|Central European (?:Summer )?Time|Eastern Time|Pacific Time|local time)\b\s*\)?)?/i;

/**
 * Find calendar dates in text. Only dates with an explicit day AND month are returned;
 * relative expressions ("tomorrow", "next week") are ignored. A missing year is flagged
 * (`yearInferred`) instead of silently assumed.
 */
export function findDates(text: string, referenceDate: Date, opts: { dayFirst?: boolean } = {}): DateMatch[] {
  const dayFirst = opts.dayFirst ?? true;
  const out: DateMatch[] = [];
  const taken: [number, number][] = [];

  // 1) Numeric d/m/y formats — handled explicitly so ambiguity is visible.
  for (const m of text.matchAll(NUMERIC_DATE)) {
    const a = Number(m[1]);
    const b = Number(m[2]);
    const y = Number(m[3]);
    let day: number, month: number, ambiguous = false;
    if (a > 12 && b <= 12) [day, month] = [a, b];
    else if (b > 12 && a <= 12) [day, month] = [b, a];
    else if (a <= 12 && b <= 12) {
      ambiguous = a !== b;
      [day, month] = dayFirst ? [a, b] : [b, a];
    } else continue;
    if (!validDate(y, month, day)) continue;
    const idx = m.index ?? 0;
    taken.push([idx, idx + m[0].length]);
    out.push({ index: idx, end: idx + m[0].length, text: m[0], date: iso(y, month, day), yearInferred: false, ambiguousFormat: ambiguous });
  }

  // 2) Textual / ISO dates via chrono.
  const parser = dayFirst ? chrono.en.GB : chrono.en;
  const results = parser.parse(text, referenceDate, { forwardDate: true });
  for (const r of results) {
    const s = r.start;
    if (!s.isCertain("day") || !s.isCertain("month")) continue;
    const overlaps = taken.some(([a, b]) => r.index < b && r.index + r.text.length > a);
    if (overlaps) continue;
    // Reject weekday-only or clearly relative matches.
    if (/^(today|tomorrow|tonight|yesterday|now|this|next|last|in)\b/i.test(r.text.trim())) continue;
    if (!/\d/.test(r.text)) continue; // real calendar dates always contain a day number
    const y = s.get("year");
    const mo = s.get("month");
    const d = s.get("day");
    if (!y || !mo || !d) continue;
    out.push({
      index: r.index,
      end: r.index + r.text.length,
      text: r.text,
      date: iso(y, mo, d),
      yearInferred: !s.isCertain("year"),
      ambiguousFormat: false,
    });
    // chrono yields a range for "1 October – 30 November 2026"; keep the end date too.
    if (r.end && r.end.isCertain("day") && r.end.isCertain("month")) {
      const ey = r.end.get("year"), em = r.end.get("month"), ed = r.end.get("day");
      if (ey && em && ed) {
        const startMatch = out[out.length - 1];
        const sep = /\s+(?:to|until|till|and)\s+|\s*[–—-]\s*/.exec(r.text);
        const endIdx = sep ? r.index + sep.index + sep[0].length : r.index;
        if (sep) {
          startMatch.text = r.text.slice(0, sep.index);
          startMatch.end = r.index + sep.index;
        }
        if (r.end.isCertain("year")) startMatch.yearInferred = false;
        out.push({
          index: endIdx,
          end: r.index + r.text.length,
          text: r.text.slice(endIdx - r.index),
          date: iso(ey, em, ed),
          yearInferred: !r.end.isCertain("year"),
          ambiguousFormat: false,
        });
      }
    }
  }

  out.sort((a, b) => a.index - b.index);
  for (const m of out) {
    const after = text.slice(m.end, m.end + 60);
    const tm = TIME_TZ.exec(after);
    if (tm && tm.index <= 8) {
      m.time = tm[1].trim();
      if (tm[2]) m.timezone = tm[2].trim();
    } else if (!/^\d{1,2}[./]\d{1,2}[./]\d{4}$/.test(m.text)) {
      const inside = TIME_TZ.exec(m.text);
      if (inside && /\d:\d\d|[ap]\.?m/i.test(inside[1])) {
        m.time = inside[1].trim();
        if (inside[2]) m.timezone = inside[2].trim();
      }
    }
  }
  return out;
}

function validDate(y: number, m: number, d: number): boolean {
  if (m < 1 || m > 12 || d < 1 || d > 31 || y < 2000 || y > 2100) return false;
  const dt = new Date(Date.UTC(y, m - 1, d));
  return dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d;
}

/** Whole days from `today` (in the user's timezone) to an ISO date. Negative = past. */
export function daysUntil(isoDate: string, now: Date = new Date(), timeZone = "UTC"): number {
  const todayIso = todayInZone(now, timeZone);
  const a = Date.UTC(+todayIso.slice(0, 4), +todayIso.slice(5, 7) - 1, +todayIso.slice(8, 10));
  const b = Date.UTC(+isoDate.slice(0, 4), +isoDate.slice(5, 7) - 1, +isoDate.slice(8, 10));
  return Math.round((b - a) / 86_400_000);
}

export function todayInZone(now: Date, timeZone: string): string {
  try {
    const parts = new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(now);
    const get = (t: string) => parts.find((p) => p.type === t)?.value ?? "";
    return `${get("year")}-${get("month")}-${get("day")}`;
  } catch {
    return now.toISOString().slice(0, 10);
  }
}

export type Urgency = "CRITICAL" | "URGENT" | "SOON" | "UPCOMING" | "LATER" | "CLOSED" | "UNKNOWN";

/** Deadline urgency buckets: ≤3 critical, 4–7 urgent, 8–14 soon, 15–30 upcoming, >30 later. */
export function urgencyFor(days: number | null): Urgency {
  if (days === null || Number.isNaN(days)) return "UNKNOWN";
  if (days < 0) return "CLOSED";
  if (days <= 3) return "CRITICAL";
  if (days <= 7) return "URGENT";
  if (days <= 14) return "SOON";
  if (days <= 30) return "UPCOMING";
  return "LATER";
}
