import { ChevronLeft, ChevronRight } from "lucide-react";
import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { Badge, CertaintyBadge, Empty, Section, Spinner, UrgencyBadge, useLoad } from "../components/ui";
import { api } from "../lib/api";
import { daysLabel, fmtDate, upper } from "../lib/format";
import type { DeadlineRow, Urgency } from "../lib/types";

const COLORS: Record<Urgency, string> = {
  CRITICAL: "bg-red-600 text-white",
  URGENT: "bg-orange-500 text-white",
  SOON: "bg-amber-400 text-slate-900",
  UPCOMING: "bg-blue-500 text-white",
  LATER: "bg-slate-500 text-white",
  CLOSED: "bg-slate-200 text-slate-500 line-through",
  UNKNOWN: "bg-slate-200 text-slate-600",
};

export default function Deadlines() {
  const { data, loading } = useLoad(() => api.get<{ items: DeadlineRow[]; timezone: string }>("/deadlines"));
  const [month, setMonth] = useState(() => {
    const d = new Date();
    return new Date(d.getFullYear(), d.getMonth(), 1);
  });
  const nav = useNavigate();
  if (loading && !data) return <Spinner />;
  const items = data?.items ?? [];

  const groups: { label: string; filter: (d: DeadlineRow) => boolean }[] = [
    { label: "Next 3 days (critical)", filter: (d) => d.daysRemaining !== null && d.daysRemaining >= 0 && d.daysRemaining <= 3 },
    { label: "4–7 days (urgent)", filter: (d) => d.daysRemaining !== null && d.daysRemaining >= 4 && d.daysRemaining <= 7 },
    { label: "8–14 days (soon)", filter: (d) => d.daysRemaining !== null && d.daysRemaining >= 8 && d.daysRemaining <= 14 },
    { label: "15–30 days (upcoming)", filter: (d) => d.daysRemaining !== null && d.daysRemaining >= 15 && d.daysRemaining <= 30 },
    { label: "Later", filter: (d) => d.daysRemaining !== null && d.daysRemaining > 30 },
    { label: "Closed", filter: (d) => d.daysRemaining !== null && d.daysRemaining < 0 },
    { label: "Date unknown", filter: (d) => d.daysRemaining === null },
  ];

  // Calendar grid (Monday first)
  const first = new Date(month);
  const startOffset = (first.getDay() + 6) % 7;
  const daysInMonth = new Date(month.getFullYear(), month.getMonth() + 1, 0).getDate();
  const cells: (number | null)[] = [...Array(startOffset).fill(null), ...Array.from({ length: daysInMonth }, (_, i) => i + 1)];
  while (cells.length % 7) cells.push(null);
  const iso = (day: number) => `${month.getFullYear()}-${String(month.getMonth() + 1).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
  const todayIso = new Date().toISOString().slice(0, 10);
  const open = (d: DeadlineRow) => nav(d.opportunity.applications[0] ? `/applications/${d.opportunity.applications[0].id}` : `/opportunities/${d.opportunity.id}`);

  return (
    <div className="space-y-5">
      <div>
        <h1>Deadlines</h1>
        <p className="text-sm text-slate-500">
          Application, funding, scholarship and supervisor-contact deadlines are tracked separately. Days are counted in your timezone ({data?.timezone}).
        </p>
      </div>
      <Section
        title={month.toLocaleDateString("en-GB", { month: "long", year: "numeric" })}
        actions={
          <>
            <button className="btn-ghost" onClick={() => setMonth(new Date(month.getFullYear(), month.getMonth() - 1, 1))} aria-label="Previous month"><ChevronLeft size={16} /></button>
            <button className="btn-ghost text-xs" onClick={() => { const d = new Date(); setMonth(new Date(d.getFullYear(), d.getMonth(), 1)); }}>Today</button>
            <button className="btn-ghost" onClick={() => setMonth(new Date(month.getFullYear(), month.getMonth() + 1, 1))} aria-label="Next month"><ChevronRight size={16} /></button>
          </>
        }
      >
        <div className="mb-2 flex flex-wrap gap-2 text-xs">
          {(["CRITICAL", "URGENT", "SOON", "UPCOMING", "LATER", "CLOSED"] as Urgency[]).map((u) => <span key={u} className={`rounded px-1.5 py-0.5 ${COLORS[u]}`}>{upper(u)}</span>)}
        </div>
        <div className="grid grid-cols-7 gap-px overflow-hidden rounded-lg border border-slate-200 bg-slate-200 text-xs">
          {["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"].map((d) => <div key={d} className="bg-slate-50 p-1.5 text-center font-medium text-slate-500">{d}</div>)}
          {cells.map((day, i) => (
            <div key={i} className={`min-h-24 bg-white p-1 ${day && iso(day) === todayIso ? "ring-2 ring-brand-600 ring-inset" : ""}`}>
              {day && <p className="mb-1 text-right text-slate-400">{day}</p>}
              {day && items.filter((d) => d.date === iso(day)).map((d) => (
                <button key={d.id} onClick={() => open(d)} className={`mb-0.5 block w-full truncate rounded px-1 py-0.5 text-left ${COLORS[d.urgency]}`} title={`${d.opportunity.title} — ${d.kind} deadline`}>
                  {d.kind === "APPLICATION" ? "" : `${d.kind.slice(0, 4)}: `}{d.opportunity.universityName ?? d.opportunity.title}
                </button>
              ))}
            </div>
          ))}
        </div>
      </Section>

      {!items.length ? (
        <Empty title="No deadlines tracked">Save opportunities to see their deadlines here.</Empty>
      ) : (
        groups.map((g) => {
          const rows = items.filter(g.filter);
          if (!rows.length) return null;
          return (
            <Section key={g.label} title={`${g.label} · ${rows.length}`}>
              <ul className="divide-y divide-slate-100">
                {rows.map((d) => (
                  <li key={d.id} className="flex flex-wrap items-center justify-between gap-2 py-2 text-sm">
                    <div className="min-w-0">
                      <Link to={`/opportunities/${d.opportunity.id}`} className="font-medium hover:text-brand-700">{d.opportunity.title}</Link>
                      <p className="text-xs text-slate-500">
                        {d.opportunity.universityName} · <Badge>{upper(d.kind)} DEADLINE</Badge> {d.round && <Badge>{d.round}</Badge>}
                        {d.yearInferred && <span className="text-amber-700"> · year not stated on the page — verify</span>}
                      </p>
                    </div>
                    <div className="flex items-center gap-2">
                      <span>{fmtDate(d.date)} {d.time} {d.timezone}</span>
                      <CertaintyBadge certainty={d.certainty} />
                      <UrgencyBadge urgency={d.urgency}>{daysLabel(d.daysRemaining)}</UrgencyBadge>
                    </div>
                  </li>
                ))}
              </ul>
            </Section>
          );
        })
      )}
    </div>
  );
}
