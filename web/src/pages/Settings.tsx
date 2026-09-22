import { useEffect, useState } from "react";
import { Alert, Badge, Field, Section, Spinner, toast, useLoad } from "../components/ui";
import { api } from "../lib/api";
import type { ProfileBundle } from "../lib/types";

interface Status {
  ai: { enabled: boolean; provider: string; model?: string };
  search: { provider: string; enabled: boolean };
  scheduler: { enabled: boolean; reverifyIntervalHours: number; notifyIntervalMinutes: number };
  emailNotifications: boolean;
  crawler: { userAgent: string; minDelayMs: number; respectsRobotsTxt: boolean };
}

export default function Settings() {
  const status = useLoad(() => api.get<Status>("/settings/status"));
  const profile = useLoad(() => api.get<ProfileBundle>("/profile"));
  const [prefs, setPrefs] = useState({ inApp: true, browser: true, email: false, thresholds: [30, 14, 7, 3, 1] });
  useEffect(() => {
    if (profile.data?.profile.notificationPrefs) setPrefs(profile.data.profile.notificationPrefs);
  }, [profile.data]);
  if (!status.data || !profile.data) return <Spinner />;
  const s = status.data;
  const save = async () => {
    await api.put("/profile", { notificationPrefs: prefs });
    toast("Notification preferences saved");
  };
  return (
    <div className="space-y-5">
      <h1>Settings</h1>
      <div className="grid gap-5 lg:grid-cols-2">
        <Section title="Notification preferences" actions={<button className="btn-primary" onClick={save}>Save</button>}>
          <div className="space-y-2 text-sm">
            {(["inApp", "browser", "email"] as const).map((k) => (
              <label key={k} className="flex items-center gap-2">
                <input type="checkbox" checked={prefs[k]} onChange={(e) => setPrefs({ ...prefs, [k]: e.target.checked })} />
                {k === "inApp" ? "In-app" : k === "browser" ? "Browser notifications (dashboard & extension)" : `Email digest to yourself ${s.emailNotifications ? "" : "(SMTP not configured on the server)"}`}
              </label>
            ))}
            <Field label="Deadline reminder thresholds (days before, comma-separated)">
              <input className="input" value={prefs.thresholds.join(", ")} onChange={(e) => setPrefs({ ...prefs, thresholds: e.target.value.split(",").map((x) => Number(x.trim())).filter((n) => Number.isFinite(n) && n >= 0) })} />
            </Field>
            <p className="text-xs text-slate-500">Reminders are computed in your profile timezone: <b>{profile.data.profile.timezone}</b> (change it on the Profile page).</p>
          </div>
        </Section>
        <Section title="AI provider">
          {s.ai.enabled ? (
            <p className="text-sm">Enabled: <Badge tone="green">{s.ai.provider}</Badge></p>
          ) : (
            <Alert tone="blue" title="Not configured — the app runs fully on deterministic rules and templates">
              Set <code>AI_PROVIDER=anthropic</code> and <code>ANTHROPIC_API_KEY</code> in <code>server/.env</code> and restart. AI is only used to fill fields the rules miss (with quotes verified verbatim on the page) and to tailor drafts from your verified profile.
            </Alert>
          )}
        </Section>
        <Section title="Discovery & crawler">
          <ul className="space-y-1 text-sm">
            <li>robots.txt respected: <Badge tone="green">yes</Badge></li>
            <li>Minimum delay per website: {s.crawler.minDelayMs} ms</li>
            <li className="break-all">User-Agent: <code className="text-xs">{s.crawler.userAgent}</code></li>
            <li>Search API: {s.search.enabled ? <Badge tone="green">{s.search.provider}</Badge> : <Badge>not configured (seed pages + your browser searches)</Badge>}</li>
            <li>Background jobs: {s.scheduler.enabled ? `re-verify saved opportunities every ${s.scheduler.reverifyIntervalHours} h, notifications every ${s.scheduler.notifyIntervalMinutes} min` : "disabled"}</li>
          </ul>
          <p className="mt-2 text-xs text-slate-500">The crawler never bypasses logins, CAPTCHAs, paywalls or anti-bot protection. For such pages, use the browser extension on a page you have opened yourself.</p>
        </Section>
        <Section title="Browser extension">
          <ol className="list-decimal space-y-1 pl-5 text-sm">
            <li>Run <code>npm run build -w extension</code> in the project folder.</li>
            <li>Open <code>chrome://extensions</code>, enable <b>Developer mode</b>, click <b>Load unpacked</b> and choose <code>extension/dist</code>.</li>
            <li>Open the extension's options, set the server URL (<code>{window.location.origin.replace(":5173", ":4000")}</code>) and sign in with this account.</li>
          </ol>
        </Section>
      </div>
    </div>
  );
}
