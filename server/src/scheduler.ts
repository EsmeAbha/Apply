import { config } from "./config.js";
import { startDiscovery } from "./crawler/discovery.js";
import { prisma } from "./db.js";
import { runNotificationScan } from "./services/notifications.js";
import { verifyOpportunity } from "./services/opportunities.js";

let running = false;

/** Re-check saved opportunities whose last verification is older than the configured interval — one at a time, politely. */
export async function reverifyDue(): Promise<number> {
  const cutoff = new Date(Date.now() - config.scheduler.reverifyIntervalHours * 3_600_000);
  const due = await prisma.opportunity.findMany({
    where: { archived: false, isDemo: false, OR: [{ saved: true }, { applications: { some: {} } }], lastVerifiedAt: { lt: cutoff } },
    select: { id: true, userId: true },
    take: 50,
  });
  for (const o of due) {
    try {
      await verifyOpportunity(o.userId, o.id);
    } catch (e) {
      console.error("[scheduler] re-verify failed", o.id, (e as Error).message);
    }
  }
  return due.length;
}

export function startScheduler(): void {
  if (!config.scheduler.enabled) return;
  const tick = async () => {
    if (running) return;
    running = true;
    try {
      await runNotificationScan();
      await reverifyDue();
      // Daily discovery over each user's enabled seeds.
      const seeds = await prisma.discoverySeed.findMany({ where: { enabled: true, OR: [{ lastCrawledAt: null }, { lastCrawledAt: { lt: new Date(Date.now() - 24 * 3_600_000) } }] }, select: { userId: true }, distinct: ["userId"] });
      for (const s of seeds) startDiscovery(s.userId, {});
      await runNotificationScan();
    } catch (e) {
      console.error("[scheduler]", (e as Error).message);
    } finally {
      running = false;
    }
  };
  setTimeout(tick, 15_000);
  setInterval(tick, config.scheduler.notifyIntervalMinutes * 60_000).unref();
  console.log(`[scheduler] notifications every ${config.scheduler.notifyIntervalMinutes} min; re-verification every ${config.scheduler.reverifyIntervalHours} h`);
}
