import { Bell, BookmarkCheck, CalendarClock, CheckSquare, FileStack, FlaskConical, GraduationCap, KanbanSquare, LayoutDashboard, LogOut, Search, Settings, UserRound, WandSparkles } from "lucide-react";
import { UsersRound } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { NavLink, Outlet, useNavigate } from "react-router-dom";
import { api, setToken } from "../lib/api";
import type { Notification } from "../lib/types";

const NAV = [
  { to: "/", label: "Dashboard", icon: LayoutDashboard, end: true },
  { to: "/discover", label: "Discover", icon: Search },
  { to: "/shortlist", label: "Shortlist", icon: BookmarkCheck },
  { to: "/applications", label: "Applications", icon: KanbanSquare },
  { to: "/deadlines", label: "Deadlines", icon: CalendarClock },
  { to: "/documents", label: "Documents", icon: FileStack },
  { to: "/profile", label: "Profile", icon: UserRound },
  { to: "/research", label: "Research", icon: FlaskConical },
  { to: "/tasks", label: "Tasks", icon: CheckSquare },
  { to: "/references", label: "References", icon: UsersRound },
  { to: "/form-memory", label: "Form memory", icon: WandSparkles },
  { to: "/notifications", label: "Notifications", icon: Bell },
  { to: "/settings", label: "Settings", icon: Settings },
];

export function Layout() {
  const [unread, setUnread] = useState(0);
  const lastSeen = useRef<string>(new Date().toISOString());
  const nav = useNavigate();

  // Poll for notifications; show browser notifications for new critical/warning items if permitted.
  useEffect(() => {
    let stop = false;
    const poll = async () => {
      try {
        const r = await api.get<{ items: Notification[]; unreadCount: number }>(`/notifications?unread=true&since=${encodeURIComponent(lastSeen.current)}`);
        if (stop) return;
        setUnread((await api.get<{ unreadCount: number }>("/notifications?unread=true")).unreadCount);
        if (r.items.length) lastSeen.current = r.items[0].createdAt;
        if ("Notification" in window && Notification.permission === "granted") {
          for (const n of r.items.filter((x) => x.severity !== "INFO").slice(0, 3)) new Notification(n.title, { body: n.body });
        }
      } catch {
        /* offline or logged out */
      }
    };
    poll();
    const id = setInterval(poll, 60_000);
    return () => {
      stop = true;
      clearInterval(id);
    };
  }, []);

  const logout = async () => {
    await api.post("/auth/logout").catch(() => undefined);
    setToken(null);
    window.dispatchEvent(new Event("auth-changed"));
    nav("/");
  };

  return (
    <div className="flex min-h-screen">
      <aside className="sticky top-0 hidden h-screen w-60 shrink-0 flex-col border-r border-slate-200 bg-white md:flex">
        <div className="flex items-center gap-2 border-b border-slate-100 px-4 py-4">
          <div className="rounded-lg bg-brand-700 p-1.5 text-white">
            <GraduationCap size={18} />
          </div>
          <div className="leading-tight">
            <p className="text-sm font-semibold text-slate-900">PhD Application</p>
            <p className="text-xs text-slate-500">Intelligence Assistant</p>
          </div>
        </div>
        <nav className="flex-1 space-y-0.5 overflow-y-auto p-2">
          {NAV.map((n) => (
            <NavLink
              key={n.to}
              to={n.to}
              end={n.end}
              className={({ isActive }) => `flex items-center gap-2.5 rounded-lg px-3 py-2 text-sm ${isActive ? "bg-brand-50 font-medium text-brand-700" : "text-slate-600 hover:bg-slate-50"}`}
            >
              <n.icon size={16} />
              <span className="flex-1">{n.label}</span>
              {n.label === "Notifications" && unread > 0 && <span className="rounded-full bg-red-600 px-1.5 text-xs text-white">{unread}</span>}
            </NavLink>
          ))}
        </nav>
        <button className="m-2 flex items-center gap-2 rounded-lg px-3 py-2 text-sm text-slate-500 hover:bg-slate-50" onClick={logout}>
          <LogOut size={16} /> Sign out
        </button>
      </aside>
      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex items-center gap-2 overflow-x-auto border-b border-slate-200 bg-white px-3 py-2 md:hidden">
          {NAV.map((n) => (
            <NavLink key={n.to} to={n.to} end={n.end} className={({ isActive }) => `rounded-md px-2 py-1 text-xs whitespace-nowrap ${isActive ? "bg-brand-50 text-brand-700" : "text-slate-600"}`}>
              {n.label}
            </NavLink>
          ))}
        </header>
        <main className="mx-auto w-full max-w-7xl flex-1 p-4 md:p-6">
          <Outlet />
        </main>
        <footer className="px-6 pb-4 text-xs text-slate-400">
          Facts are shown with their official source. Unverified information is marked UNKNOWN or NEEDS VERIFICATION. This app never submits applications, sends emails or pays fees for you.
        </footer>
      </div>
    </div>
  );
}
