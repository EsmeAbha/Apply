import * as cheerio from "cheerio";
import { createHash } from "node:crypto";

/** A block of visible text with the nearest heading above it (used as context for classification). */
export interface Segment {
  text: string;
  heading: string;
  index: number;
  isListItem: boolean;
}

export interface PageText {
  title: string;
  metaDescription: string;
  ogSiteName: string;
  ogTitle: string;
  h1: string;
  segments: Segment[];
  fullText: string;
  links: { text: string; href: string }[];
  jsonLd: unknown[];
}

const BLOCK_TAGS = [
  "p", "div", "section", "article", "main", "header", "li", "ul", "ol", "dl", "dt", "dd", "table", "tr",
  "blockquote", "pre", "figure", "figcaption", "form", "fieldset", "details", "summary", "address", "aside",
];

export function sha256(text: string): string {
  return createHash("sha256").update(text).digest("hex");
}

export function normalizeWhitespace(s: string): string {
  return s.replace(/ /g, " ").replace(/[ \t\f\v\r]+/g, " ").replace(/ *\n */g, "\n").trim();
}

export function htmlToPageText(html: string, baseUrl: string): PageText {
  const $ = cheerio.load(html);

  const jsonLd: unknown[] = [];
  $('script[type="application/ld+json"]').each((_, el) => {
    const raw = $(el).contents().text();
    try {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) jsonLd.push(...parsed);
      else if (parsed && typeof parsed === "object" && Array.isArray((parsed as { "@graph"?: unknown[] })["@graph"])) {
        jsonLd.push(...((parsed as { "@graph": unknown[] })["@graph"]));
      } else jsonLd.push(parsed);
    } catch {
      /* ignore malformed JSON-LD */
    }
  });

  const title = normalizeWhitespace($("title").first().text());
  const metaDescription = $('meta[name="description"]').attr("content")?.trim() ?? "";
  const ogSiteName = $('meta[property="og:site_name"]').attr("content")?.trim() ?? "";
  const ogTitle = $('meta[property="og:title"]').attr("content")?.trim() ?? "";

  $("script, style, noscript, svg, iframe, template, nav, [aria-hidden='true'], .cookie, #cookie-banner").remove();

  const h1 = normalizeWhitespace($("h1").first().text());

  const links: { text: string; href: string }[] = [];
  $("a[href]").each((_, el) => {
    const href = $(el).attr("href") ?? "";
    if (!href || href.startsWith("javascript:")) return;
    try {
      const abs = new URL(href, baseUrl).toString();
      links.push({ text: normalizeWhitespace($(el).text()), href: abs });
    } catch {
      /* ignore invalid URLs */
    }
  });

  // Mark structure with sentinels, then flatten.
  $("h1, h2, h3, h4, h5, h6").each((_, el) => {
    const t = normalizeWhitespace($(el).text()).replace(/\n/g, " ");
    $(el).replaceWith(`\n§H§${t}\n`);
  });
  $("br").replaceWith("\n");
  $("li").each((_, el) => {
    $(el).prepend("\n§LI§");
  });
  $("td, th").each((_, el) => {
    $(el).append(" | ");
  });
  for (const tag of BLOCK_TAGS) {
    $(tag).each((_, el) => {
      $(el).prepend("\n");
      $(el).append("\n");
    });
  }

  const body = $("body").length ? $("body").text() : $.root().text();
  const lines = normalizeWhitespace(body)
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean);

  const segments: Segment[] = [];
  let heading = "";
  let index = 0;
  for (let line of lines) {
    if (line.startsWith("§H§")) {
      heading = line.slice(3).trim();
      // Headings themselves can carry facts ("Deadline: 30 November 2026")
      if (heading) segments.push({ text: heading, heading, index: index++, isListItem: false });
      continue;
    }
    let isListItem = false;
    if (line.startsWith("§LI§")) {
      isListItem = true;
      line = line.slice(4).trim();
    }
    line = line.replace(/\s*\|\s*$/, "").replace(/\s*\|\s*/g, " | ").replace(/§LI§/g, "").trim();
    if (!line) continue;
    for (const sentence of splitSentences(line)) {
      segments.push({ text: sentence, heading, index: index++, isListItem });
    }
  }

  const fullText = segments.map((s) => s.text).join("\n");
  return { title, metaDescription, ogSiteName, ogTitle, h1, segments, fullText, links, jsonLd };
}

/** Split into sentences without breaking abbreviations like "Prof." / "Dr." / "e.g." / "Nov." */
export function splitSentences(text: string): string[] {
  if (text.length < 200) return [text];
  const parts = text.split(/(?<=[.!?])\s+(?=[A-Z(“"])/);
  const out: string[] = [];
  for (const p of parts) {
    const prev = out[out.length - 1];
    if (prev && /\b(Prof|Dr|Mr|Ms|Mrs|e\.g|i\.e|etc|Jan|Feb|Mar|Apr|Jun|Jul|Aug|Sep|Sept|Oct|Nov|Dec|No|approx|incl)\.$/i.test(prev)) {
      out[out.length - 1] = prev + " " + p;
    } else out.push(p);
  }
  return out;
}

/** Trim a snippet to a readable length around a match. */
export function snippetAround(text: string, start: number, end: number, radius = 160): string {
  if (text.length <= radius * 2) return text;
  const s = Math.max(0, start - radius);
  const e = Math.min(text.length, end + radius);
  return (s > 0 ? "…" : "") + text.slice(s, e).trim() + (e < text.length ? "…" : "");
}
