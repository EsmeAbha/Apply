import type { Certainty, Confidence, Evidence, Fact, MoneyAmount, SourceType } from "./types.js";
import { certaintyFor } from "./source.js";
import type { Segment } from "./text.js";

export interface ExtractCtx {
  url: string;
  sourceType: SourceType;
  pageTitle: string;
  accessedAt: string;
  referenceDate: Date;
  dayFirst: boolean;
}

export function evidence(ctx: ExtractCtx, snippet: string, method: Evidence["method"] = "RULE"): Evidence {
  return {
    sourceUrl: ctx.url,
    sourceTitle: ctx.pageTitle,
    sourceType: ctx.sourceType,
    snippet: snippet.length > 400 ? snippet.slice(0, 397) + "…" : snippet,
    accessedAt: ctx.accessedAt,
    method,
  };
}

export function unknown<T>(note?: string): Fact<T> {
  return { value: null, confidence: "LOW", certainty: "UNKNOWN", evidence: [], ...(note ? { note } : {}) };
}

export function fact<T>(ctx: ExtractCtx, value: T, confidence: Confidence, snippet: string, note?: string, method?: Evidence["method"]): Fact<T> {
  return {
    value,
    confidence,
    certainty: certaintyFor(ctx.sourceType, confidence) as Certainty,
    evidence: [evidence(ctx, snippet, method)],
    ...(note ? { note } : {}),
  };
}

/** Segment text plus its heading, for keyword classification. */
export function withHeading(seg: Segment): string {
  return seg.heading && seg.heading !== seg.text ? `${seg.heading}: ${seg.text}` : seg.text;
}

const CURRENCY_SYMBOLS: Record<string, string> = {
  "€": "EUR", "£": "GBP", "$": "USD", "US$": "USD", "USD": "USD", "EUR": "EUR", "GBP": "GBP", "CHF": "CHF", "SEK": "SEK",
  "NOK": "NOK", "DKK": "DKK", "CAD": "CAD", "C$": "CAD", "CA$": "CAD", "AUD": "AUD", "A$": "AUD", "AU$": "AUD", "NZD": "NZD", "NZ$": "NZD",
  "SGD": "SGD", "S$": "SGD", "JPY": "JPY", "¥": "JPY", "yen": "JPY", "KRW": "KRW", "₩": "KRW", "HKD": "HKD", "HK$": "HKD",
  "INR": "INR", "₹": "INR", "CNY": "CNY", "RMB": "CNY", "ISK": "ISK", "PLN": "PLN", "CZK": "CZK", "kr": "SEK", "SAR": "SAR", "AED": "AED", "QAR": "QAR",
};

const CUR = "(US\\$|CA\\$|AU\\$|NZ\\$|HK\\$|C\\$|A\\$|S\\$|€|£|\\$|¥|₩|₹|USD|EUR|GBP|CHF|SEK|NOK|DKK|CAD|AUD|NZD|SGD|JPY|KRW|HKD|INR|CNY|RMB|ISK|PLN|CZK|SAR|AED|QAR)";
const NUM = "(\\d{1,3}(?:[ ,.'’]\\d{3})+(?:[.,]\\d{1,2})?|\\d+(?:[.,]\\d{1,2})?)(\\s?[kK]\\b)?";
const PERIOD = "(?:\\s*(?:\\/|per|a|each|every)\\s*(month|year|annum|yr|mo)\\b|\\s*(monthly|annually|p\\.?\\s?a\\.?|per\\s+annum|yearly))?";

function parseNumber(raw: string, k: boolean): number {
  let s = raw.replace(/[ '’]/g, "");
  // "1.234,56" (EU) vs "1,234.56" (EN) vs "2.500" (EU thousands)
  if (/^\d{1,3}(\.\d{3})+(,\d{1,2})?$/.test(s)) s = s.replace(/\./g, "").replace(",", ".");
  else if (/^\d{1,3}(,\d{3})+(\.\d{1,2})?$/.test(s)) s = s.replace(/,/g, "");
  else if (/^\d+,\d{1,2}$/.test(s)) s = s.replace(",", ".");
  const n = Number(s);
  return k ? n * 1000 : n;
}

export function findMoney(text: string): (MoneyAmount & { index: number; end: number })[] {
  const out: (MoneyAmount & { index: number; end: number })[] = [];
  // Two passes: currency-before-number ("€2,500") and number-before-currency ("2 500 EUR").
  const before = new RegExp(`${CUR}\\s?${NUM}${PERIOD}`, "gi");
  const after = new RegExp(`${NUM}\\s?${CUR}(?=\\W|$)${PERIOD}`, "gi");
  for (const m of text.matchAll(before)) {
    const cur = CURRENCY_SYMBOLS[m[1]] ?? CURRENCY_SYMBOLS[m[1].toUpperCase()] ?? m[1].toUpperCase();
    const amount = parseNumber(m[2], !!m[3]);
    if (!Number.isFinite(amount)) continue;
    out.push({ amount, currency: cur, period: periodOf(m[4] ?? m[5]), text: m[0].trim(), index: m.index ?? 0, end: (m.index ?? 0) + m[0].length });
  }
  for (const m of text.matchAll(after)) {
    const idx = m.index ?? 0;
    if (out.some((o) => idx < o.end && idx + m[0].length > o.index)) continue;
    const cur = CURRENCY_SYMBOLS[m[3]] ?? CURRENCY_SYMBOLS[m[3].toUpperCase()] ?? m[3].toUpperCase();
    const amount = parseNumber(m[1], !!m[2]);
    if (!Number.isFinite(amount)) continue;
    out.push({ amount, currency: cur, period: periodOf(m[4] ?? m[5]), text: m[0].trim(), index: idx, end: idx + m[0].length });
  }
  return out.sort((a, b) => a.index - b.index);
}

function periodOf(p?: string): MoneyAmount["period"] {
  if (!p) return undefined;
  const s = p.toLowerCase();
  if (s.startsWith("mo")) return "MONTH";
  if (/year|annum|annually|yr|p\.?\s?a/.test(s)) return "YEAR";
  return undefined;
}

export function formatMoney(m: MoneyAmount | null | undefined): string {
  if (!m) return "UNKNOWN";
  const n = m.amount.toLocaleString("en-US", { maximumFractionDigits: 2 });
  const per = m.period === "MONTH" ? " / month" : m.period === "YEAR" ? " / year" : "";
  return `${m.currency} ${n}${per}`;
}

/** True when the keyword occurrence is negated nearby ("no", "not", "without"). */
export function isNegated(text: string, matchIndex: number): boolean {
  const before = text.slice(Math.max(0, matchIndex - 40), matchIndex).toLowerCase();
  return /\b(no|not|without|non-|neither|nor|cannot|isn't|aren't|doesn't|don't)\b[^.;]*$/.test(before);
}

export const NUMBER_WORDS: Record<string, number> = {
  one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10, a: 1, an: 1, single: 1,
};

export function parseCount(s: string): number | undefined {
  const n = Number(s);
  if (Number.isFinite(n)) return n;
  return NUMBER_WORDS[s.toLowerCase()];
}
