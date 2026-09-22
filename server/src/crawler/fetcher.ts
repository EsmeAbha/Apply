import { createRequire } from "node:module";
import { EnvHttpProxyAgent, setGlobalDispatcher } from "undici";
import { config } from "../config.js";

// Honour HTTPS_PROXY / NO_PROXY when present (corporate networks, sandboxes).
if (process.env.HTTPS_PROXY || process.env.https_proxy || process.env.HTTP_PROXY) {
  setGlobalDispatcher(new EnvHttpProxyAgent());
}

export type FetchStatus = "OK" | "FAILED" | "BLOCKED_BY_ROBOTS" | "NOT_HTML";

export interface FetchResult {
  url: string;
  finalUrl: string;
  status: FetchStatus;
  httpStatus?: number;
  contentType?: string;
  body?: string;
  error?: string;
}

interface Robots {
  isAllowed(url: string, ua?: string): boolean | undefined;
  getCrawlDelay(ua?: string): number | undefined;
}
// robots-parser is CommonJS (`module.exports = fn`); load it explicitly for ESM.
const robotsParser = createRequire(import.meta.url)("robots-parser") as (url: string, contents: string) => Robots;

/**
 * Polite fetcher:
 *  - checks robots.txt (cached per origin) before every request,
 *  - enforces a minimum delay per host (or the site's Crawl-delay, whichever is larger),
 *  - identifies itself with a descriptive User-Agent,
 *  - never tries to bypass logins, CAPTCHAs, paywalls or anti-bot protections.
 */
export class PoliteFetcher {
  private robots = new Map<string, { parser: Robots | null; fetchedAt: number }>();
  private nextAllowed = new Map<string, number>();

  constructor(
    private readonly userAgent = config.crawler.userAgent,
    private readonly minDelayMs = config.crawler.minDelayMs,
    private readonly fetchImpl: typeof fetch = fetch,
  ) {}

  private async getRobots(origin: string): Promise<Robots | null> {
    const cached = this.robots.get(origin);
    if (cached && Date.now() - cached.fetchedAt < 6 * 3_600_000) return cached.parser;
    let parser: Robots | null = null;
    try {
      const res = await this.fetchImpl(`${origin}/robots.txt`, {
        headers: { "user-agent": this.userAgent },
        signal: AbortSignal.timeout(10_000),
        redirect: "follow",
      });
      if (res.ok) parser = robotsParser(`${origin}/robots.txt`, await res.text());
      else if (res.status === 401 || res.status === 403) parser = robotsParser(`${origin}/robots.txt`, "User-agent: *\nDisallow: /");
      // 404 / other → no robots.txt → allowed
    } catch {
      parser = null; // unreachable robots.txt: treat as no restrictions, the page fetch will surface network errors
    }
    this.robots.set(origin, { parser, fetchedAt: Date.now() });
    return parser;
  }

  private async waitTurn(host: string, crawlDelaySec?: number): Promise<void> {
    const delay = Math.max(this.minDelayMs, (crawlDelaySec ?? 0) * 1000);
    const now = Date.now();
    const at = Math.max(now, this.nextAllowed.get(host) ?? 0);
    this.nextAllowed.set(host, at + delay);
    if (at > now) await new Promise((r) => setTimeout(r, at - now));
  }

  async isAllowed(url: string): Promise<boolean> {
    const u = new URL(url);
    const robots = await this.getRobots(u.origin);
    return robots ? robots.isAllowed(url, this.userAgent) !== false : true;
  }

  async fetch(url: string, opts: { accept?: "html" | "feed" | "any" } = {}): Promise<FetchResult> {
    let u: URL;
    try {
      u = new URL(url);
      if (!/^https?:$/.test(u.protocol)) throw new Error("Only http(s) URLs are supported");
    } catch (e) {
      return { url, finalUrl: url, status: "FAILED", error: `Invalid URL: ${(e as Error).message}` };
    }
    const robots = await this.getRobots(u.origin);
    if (robots && robots.isAllowed(url, this.userAgent) === false) {
      return { url, finalUrl: url, status: "BLOCKED_BY_ROBOTS", error: "robots.txt disallows automated access to this page. Open it in your browser and use the extension's “Analyze this page” instead." };
    }
    await this.waitTurn(u.hostname, robots?.getCrawlDelay(this.userAgent));

    try {
      const res = await this.fetchImpl(url, {
        headers: {
          "user-agent": this.userAgent,
          accept: opts.accept === "feed" ? "application/rss+xml, application/atom+xml, application/xml, text/xml;q=0.9, */*;q=0.5" : "text/html,application/xhtml+xml;q=0.9,*/*;q=0.5",
          "accept-language": "en;q=1.0, *;q=0.5",
        },
        redirect: "follow",
        signal: AbortSignal.timeout(config.crawler.timeoutMs),
      });
      const contentType = res.headers.get("content-type") ?? "";
      if (!res.ok) {
        const reason =
          res.status === 401 || res.status === 403
            ? "Access restricted — the page requires login or blocks automated access. The crawler does not bypass access controls; open it in your browser and use the extension."
            : res.status === 429
              ? "Rate limited by the website (HTTP 429). Try again later."
              : res.status === 404
                ? "Page not found (HTTP 404) — the opportunity may have been removed."
                : `HTTP ${res.status}`;
        return { url, finalUrl: res.url || url, status: "FAILED", httpStatus: res.status, contentType, error: reason };
      }
      const isHtml = /html|xhtml/i.test(contentType);
      const isFeed = /xml|rss|atom/i.test(contentType);
      if (!(isHtml || (opts.accept !== "html" && isFeed) || (!contentType && opts.accept === "any"))) {
        return { url, finalUrl: res.url || url, status: "NOT_HTML", httpStatus: res.status, contentType, error: `Unsupported content type: ${contentType || "unknown"}` };
      }
      const buf = Buffer.from(await res.arrayBuffer());
      if (buf.length > config.crawler.maxBytes) {
        return { url, finalUrl: res.url || url, status: "FAILED", httpStatus: res.status, contentType, error: "Page too large to analyse" };
      }
      const body = buf.toString("utf8");
      if (/cf-challenge|challenge-platform|captcha-delivery|are you a robot|verify you are human|unusual traffic from your/i.test(body.slice(0, 20_000)) && body.length < 60_000) {
        return { url, finalUrl: res.url || url, status: "FAILED", httpStatus: res.status, contentType, error: "The site presented a bot check (CAPTCHA). The crawler does not bypass it — open the page in your browser and use the extension." };
      }
      return { url, finalUrl: res.url || url, status: "OK", httpStatus: res.status, contentType, body };
    } catch (e) {
      const err = e as Error;
      const msg = err.name === "TimeoutError" ? "Request timed out" : `Network error: ${err.message}${(err as { cause?: Error }).cause ? ` (${(err as { cause?: Error }).cause?.message})` : ""}`;
      return { url, finalUrl: url, status: "FAILED", error: msg };
    }
  }
}

export const fetcher = new PoliteFetcher();
