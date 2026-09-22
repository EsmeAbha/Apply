/** Extension ↔ server API client. The token lives in chrome.storage.local (never in page context). */
export interface Settings {
  serverUrl: string;
  token: string | null;
  email: string | null;
}

export const DEFAULT_SERVER = "http://localhost:4000";

export async function getSettings(): Promise<Settings> {
  const s = await chrome.storage.local.get(["serverUrl", "token", "email"]);
  return { serverUrl: (s.serverUrl as string) || DEFAULT_SERVER, token: (s.token as string) ?? null, email: (s.email as string) ?? null };
}

export async function saveSettings(patch: Partial<Settings>): Promise<void> {
  await chrome.storage.local.set(patch);
}

export async function apiCall<T>(path: string, init: { method?: string; body?: unknown } = {}): Promise<T> {
  const { serverUrl, token } = await getSettings();
  const res = await fetch(`${serverUrl.replace(/\/$/, "")}/api${path}`, {
    method: init.method ?? (init.body ? "POST" : "GET"),
    headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: init.body ? JSON.stringify(init.body) : undefined,
  });
  const data = await res.json().catch(() => null);
  if (res.status === 401) await saveSettings({ token: null });
  if (!res.ok) throw new Error(data?.error ?? `Request failed (${res.status})`);
  return data as T;
}
