import nodemailer, { type Transporter } from "nodemailer";
import { config } from "../config.js";
import { prisma } from "../db.js";
import { daysUntil } from "../extraction/dates.js";
import type { ExtractionResult } from "../extraction/types.js";
import { DEFAULT_NOTIFICATION_PREFS } from "./profile.js";

export interface NotificationPrefs {
  inApp: boolean;
  browser: boolean;
  email: boolean;
  thresholds: number[];
}

export function prefsOf(raw: unknown): NotificationPrefs {
  const p = (raw ?? {}) as Partial<NotificationPrefs>;
  return {
    inApp: p.inApp ?? DEFAULT_NOTIFICATION_PREFS.inApp,
    browser: p.browser ?? DEFAULT_NOTIFICATION_PREFS.browser,
    email: p.email ?? DEFAULT_NOTIFICATION_PREFS.email,
    thresholds: Array.isArray(p.thresholds) && p.thresholds.length ? p.thresholds : DEFAULT_NOTIFICATION_PREFS.thresholds,
  };
}

/** Smallest configured threshold that the remaining days fall under (e.g. 5 days → the 7-day reminder). */
export function thresholdFor(days: number, thresholds: number[]): number | null {
  if (days < 0) return null;
  const sorted = [...thresholds].sort((a, b) => a - b);
  return sorted.find((t) => days <= t) ?? null;
}

const KIND_LABEL: Record<string, string> = {
  APPLICATION: "Application deadline",
  FUNDING: "Funding deadline",
  SCHOLARSHIP: "Scholarship deadline",
  SUPERVISOR_CONTACT: "Supervisor-contact deadline",
  DEPARTMENT: "Department deadline",
};

async function notify(userId: string, n: { opportunityId?: string; type: string; severity: string; title: string; body: string; link?: string; dedupeKey: string }): Promise<boolean> {
  const exists = await prisma.notification.findUnique({ where: { userId_dedupeKey: { userId, dedupeKey: n.dedupeKey } } });
  if (exists) return false;
  await prisma.notification.create({ data: { userId, ...n } });
  return true;
}

/**
 * Deadline reminders (30/14/7/3/1 days by default, in the user's timezone), missing-document alerts,
 * and IELTS-verification prompts. Idempotent: each reminder is created once per deadline date.
 */
export async function runNotificationScan(now = new Date()): Promise<{ created: number }> {
  let created = 0;
  const users = await prisma.user.findMany({ select: { id: true, email: true, profile: true } });
  for (const u of users) {
    const tz = u.profile?.timezone ?? "UTC";
    const prefs = prefsOf(u.profile?.notificationPrefs);
    const opps = await prisma.opportunity.findMany({
      where: { userId: u.id, archived: false, OR: [{ saved: true }, { applications: { some: {} } }] },
      include: { deadlines: true, applications: { include: { documents: true } } },
    });
    for (const o of opps) {
      const submitted = o.applications.some((a) => a.submittedAt);
      for (const d of o.deadlines) {
        if (!d.date || !KIND_LABEL[d.kind]) continue;
        if (submitted && d.kind === "APPLICATION") continue;
        const iso = d.date.toISOString().slice(0, 10);
        const days = daysUntil(iso, now, tz);
        const t = thresholdFor(days, prefs.thresholds);
        if (t === null) continue;
        const when = days === 0 ? "TODAY" : days === 1 ? "tomorrow" : `in ${days} days`;
        const ok = await notify(u.id, {
          opportunityId: o.id,
          type: "DEADLINE",
          severity: days <= 3 ? "CRITICAL" : days <= 7 ? "WARNING" : "INFO",
          title: days <= 1 ? `${KIND_LABEL[d.kind]} ${when}: ${o.title}` : `${KIND_LABEL[d.kind]} in ${days} days: ${o.title}`,
          body: `${o.universityName ?? ""} — ${KIND_LABEL[d.kind]}: ${iso}${d.time ? ` ${d.time}` : ""}${d.timezone ? ` ${d.timezone}` : ""} (${d.certainty}). ${d.yearInferred ? "Year not stated on source — verify. " : ""}Source: ${d.sourceUrl}`,
          link: `/opportunities/${o.id}`,
          dedupeKey: `deadline:${o.id}:${d.kind}:${iso}:${t}`,
        });
        if (ok) created++;
        if (d.kind === "APPLICATION" && days <= 7 && !submitted) {
          await prisma.task.upsert({
            where: { userId_autoKey: { userId: u.id, autoKey: `submit:${o.id}:${iso}` } },
            update: {},
            create: { userId: u.id, opportunityId: o.id, title: `Submit application: ${o.title}`, notes: `Deadline ${iso}. You submit on the official portal; then confirm in the app.`, dueDate: d.date, kind: "AUTO", autoKey: `submit:${o.id}:${iso}` },
          });
        }
      }

      // Missing documents for active applications with a deadline within 14 days
      const app = o.applications[0];
      const appDeadline = o.deadlines.find((d) => d.kind === "APPLICATION" && d.date);
      if (app && !app.submittedAt && appDeadline?.date) {
        const days = daysUntil(appDeadline.date.toISOString().slice(0, 10), now, tz);
        const missing = app.documents.filter((d) => (d.necessity === "REQUIRED" || d.necessity === "UNKNOWN") && ["MISSING", "PENDING"].includes(d.status));
        if (days >= 0 && days <= 14 && missing.length) {
          const ok = await notify(u.id, {
            opportunityId: o.id,
            type: "MISSING_DOCUMENT",
            severity: days <= 7 ? "CRITICAL" : "WARNING",
            title: `Missing documents (${missing.length}) — ${o.title}`,
            body: `Deadline in ${days} days. Missing: ${missing.map((m) => m.label).join(", ")}.`,
            link: `/applications/${app.id}`,
            dedupeKey: `missingdocs:${app.id}:${missing.map((m) => m.requirementKey).sort().join(",")}:${days <= 7 ? "7" : "14"}`,
          });
          if (ok) created++;
          for (const m of missing) {
            await prisma.task.upsert({
              where: { userId_autoKey: { userId: u.id, autoKey: `doc:${app.id}:${m.requirementKey}` } },
              update: {},
              create: { userId: u.id, applicationId: app.id, opportunityId: o.id, title: `Prepare ${m.label} — ${o.universityName ?? o.title}`, dueDate: appDeadline.date, kind: "AUTO", autoKey: `doc:${app.id}:${m.requirementKey}` },
            });
          }
        }
      }

      // English requirement needs verification (saved opportunities only, once)
      const ex = o.extraction as unknown as ExtractionResult;
      if (o.saved && ["NEEDS_VERIFICATION", "REQUIRED_STAGE_UNCLEAR", "UNKNOWN"].includes(o.englishStatus)) {
        const ok = await notify(u.id, {
          opportunityId: o.id,
          type: "IELTS_VERIFY",
          severity: "WARNING",
          title: `IELTS/English requirement needs verification — ${o.title}`,
          body: `${ex.english?.summary ?? "UNKNOWN"}. Check the official admissions page or email the admissions office before relying on it.`,
          link: `/opportunities/${o.id}`,
          dedupeKey: `ielts:${o.id}`,
        });
        if (ok) created++;
      }
    }
    if (prefs.email) await sendEmailDigest(u.id, u.profile?.contactEmail ?? u.email);
  }
  return { created };
}

let transport: Transporter | null = null;

/** Optional email channel — only ever to the user themself. */
async function sendEmailDigest(userId: string, to: string): Promise<void> {
  if (!config.smtp.url || !config.smtp.from) return;
  const pending = await prisma.notification.findMany({ where: { userId, emailedAt: null, severity: { in: ["WARNING", "CRITICAL"] } }, orderBy: { createdAt: "asc" }, take: 20 });
  if (!pending.length) return;
  transport ??= nodemailer.createTransport(config.smtp.url);
  try {
    await transport.sendMail({
      from: config.smtp.from,
      to,
      subject: `PhD Assistant: ${pending.length} update(s)`,
      text: pending.map((n) => `• ${n.title}\n  ${n.body}`).join("\n\n"),
    });
    await prisma.notification.updateMany({ where: { id: { in: pending.map((p) => p.id) } }, data: { emailedAt: new Date() } });
  } catch (e) {
    console.error("[notifications] email failed:", (e as Error).message);
  }
}

export { notify };
