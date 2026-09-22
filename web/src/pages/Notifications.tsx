import { BellRing, CheckCheck } from "lucide-react";
import { Link } from "react-router-dom";
import { Badge, Empty, Spinner, toast, useLoad } from "../components/ui";
import { api } from "../lib/api";
import { fmtDateTime, human } from "../lib/format";
import type { Notification } from "../lib/types";

export default function Notifications() {
  const { data, loading, reload } = useLoad(() => api.get<{ items: Notification[]; unreadCount: number }>("/notifications"));
  if (loading && !data) return <Spinner />;
  const items = data?.items ?? [];
  const perm = "Notification" in window ? Notification.permission : "unsupported";
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1>Notifications</h1>
          <p className="text-sm text-slate-500">Deadline reminders (30/14/7/3/1 days), changes on official pages, missing documents and verification prompts.</p>
        </div>
        <div className="flex gap-2">
          {perm === "default" && (
            <button className="btn-secondary" onClick={async () => { const p = await Notification.requestPermission(); toast(p === "granted" ? "Browser notifications enabled" : "Browser notifications not enabled"); }}>
              <BellRing size={14} /> Enable browser notifications
            </button>
          )}
          <button className="btn-secondary" onClick={async () => { const r = await api.post<{ created: number }>("/notifications/scan"); toast(`${r.created} new notification(s)`); reload(); }}>Check now</button>
          <button className="btn-secondary" onClick={async () => { await api.post("/notifications/read-all"); reload(); }}><CheckCheck size={14} /> Mark all read</button>
        </div>
      </div>
      {!items.length ? (
        <Empty title="No notifications yet" />
      ) : (
        <ul className="card divide-y divide-slate-100">
          {items.map((n) => (
            <li key={n.id} className={`flex gap-3 p-3 ${n.readAt ? "opacity-60" : ""}`}>
              <div className="pt-0.5"><Badge tone={n.severity === "CRITICAL" ? "red" : n.severity === "WARNING" ? "amber" : "blue"}>{human(n.type)}</Badge></div>
              <div className="min-w-0 flex-1">
                <p className="text-sm font-medium">{n.link ? <Link className="hover:text-brand-700" to={n.link} onClick={() => api.post(`/notifications/${n.id}/read`)}>{n.title}</Link> : n.title}</p>
                <p className="text-sm text-slate-600">{n.body}</p>
                <p className="text-xs text-slate-400">{fmtDateTime(n.createdAt)}</p>
              </div>
              {!n.readAt && <button className="btn-ghost text-xs" onClick={async () => { await api.post(`/notifications/${n.id}/read`); reload(); }}>Mark read</button>}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
