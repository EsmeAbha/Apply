/**
 * Service worker: periodically checks the server for new important notifications and shows
 * browser notifications (if the user enabled them). No page access, no scraping.
 */
import { apiCall, getSettings } from "./lib/client";

interface Notif { id: string; title: string; body: string; severity: string; createdAt: string; link: string | null }

chrome.runtime.onInstalled.addListener(() => {
  chrome.alarms.create("phd-poll", { periodInMinutes: 30 });
});
chrome.runtime.onStartup.addListener(() => {
  chrome.alarms.create("phd-poll", { periodInMinutes: 30 });
});

async function poll(): Promise<void> {
  const { token } = await getSettings();
  if (!token) return;
  const { lastSeen } = await chrome.storage.local.get("lastSeen");
  const since = (lastSeen as string) ?? new Date(Date.now() - 86_400_000).toISOString();
  try {
    const profile = await apiCall<{ profile: { notificationPrefs: { browser?: boolean } | null } }>("/profile");
    const r = await apiCall<{ items: Notif[]; unreadCount: number }>(`/notifications?unread=true&since=${encodeURIComponent(since)}`);
    chrome.action.setBadgeText({ text: r.unreadCount ? String(Math.min(r.unreadCount, 99)) : "" });
    chrome.action.setBadgeBackgroundColor({ color: "#dc2626" });
    if (r.items.length) await chrome.storage.local.set({ lastSeen: r.items[0].createdAt });
    if (profile.profile.notificationPrefs?.browser === false) return;
    for (const n of r.items.filter((x) => x.severity !== "INFO").slice(0, 3)) {
      chrome.notifications.create(`phd-${n.id}`, { type: "basic", iconUrl: "icons/icon128.png", title: n.title.slice(0, 120), message: n.body.slice(0, 300), priority: n.severity === "CRITICAL" ? 2 : 1 });
    }
  } catch {
    /* server offline — try again next alarm */
  }
}

chrome.alarms.onAlarm.addListener((a) => {
  if (a.name === "phd-poll") poll();
});

chrome.notifications.onClicked.addListener(async () => {
  const { serverUrl } = await getSettings();
  chrome.tabs.create({ url: `${serverUrl.replace(/\/$/, "")}/notifications` });
});

chrome.runtime.onMessage.addListener((msg: { type?: string }) => {
  if (msg?.type === "PHD_POLL_NOW") poll();
});
