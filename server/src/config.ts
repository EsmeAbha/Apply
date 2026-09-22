import "dotenv/config";
import path from "node:path";

function bool(v: string | undefined, def: boolean): boolean {
  if (v === undefined || v === "") return def;
  return /^(1|true|yes|on)$/i.test(v);
}

export const config = {
  port: Number(process.env.PORT ?? 4000),
  encryptionKeyHex: process.env.APP_ENCRYPTION_KEY ?? "",
  storageDir: path.resolve(process.env.STORAGE_DIR ?? "./storage"),
  corsOrigins: (process.env.CORS_ORIGINS ?? "http://localhost:5173").split(",").map((s) => s.trim()).filter(Boolean),
  ai: {
    provider: (process.env.AI_PROVIDER ?? "none").toLowerCase(),
    anthropicApiKey: process.env.ANTHROPIC_API_KEY ?? "",
    anthropicModel: process.env.ANTHROPIC_MODEL || "claude-opus-5",
  },
  search: {
    provider: (process.env.SEARCH_PROVIDER ?? "none").toLowerCase(),
    braveApiKey: process.env.BRAVE_API_KEY ?? "",
  },
  crawler: {
    userAgent: process.env.CRAWLER_USER_AGENT ?? "PhDApplicationAssistant/0.1 (+personal research tool; respects robots.txt)",
    minDelayMs: Number(process.env.CRAWLER_MIN_DELAY_MS ?? 2000),
    timeoutMs: 20_000,
    maxBytes: 3_000_000,
  },
  scheduler: {
    enabled: bool(process.env.SCHEDULER_ENABLED, true) && process.env.NODE_ENV !== "test",
    reverifyIntervalHours: Number(process.env.REVERIFY_INTERVAL_HOURS ?? 24),
    notifyIntervalMinutes: Number(process.env.NOTIFY_INTERVAL_MINUTES ?? 60),
  },
  smtp: { url: process.env.SMTP_URL ?? "", from: process.env.SMTP_FROM ?? "" },
  sessionDays: 30,
};
