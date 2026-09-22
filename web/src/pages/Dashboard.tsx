import { AlertTriangle, ArrowRight, CalendarClock, CheckCircle2, Circle, Search } from "lucide-react";
import type { ReactNode } from "react";
import { Link } from "react-router-dom";
import { Alert, Badge, Empty, Section, Spinner, UrgencyBadge, useLoad } from "../components/ui";
import { api } from "../lib/api";
import { daysLabel, fmtDate, STAGE_LABELS } from "../lib/format";
import type { ChangeLog, DeadlineRow, OpportunitySummary, ProfileBundle, Task, VaultDocument } from "../lib/types";

interface AppRow { id: string; stage: string; decision: string | null; opportunity: OpportunitySummary; documentsReady: number; documentsRequired: number }

export default function Dashboard() {
  const { data, loading, error } = useLoad(async () => {
    const [opps, apps, deadlines, docs, tasks, changes, profile] = await Promise.all([
      api.get<{ items: OpportunitySummary[] }>("/opportunities?sort=deadline"),
      api.get<{ items: AppRow[]; stages: string[] }>("/applications"),
      api.get<{ items: DeadlineRow[] }>("/deadlines"),
      api.get<{ items: VaultDocument[] }>("/documents"),
      api.get<{ items: Task[] }>("/tasks"),
      api.get<{ items: (ChangeLog & { opportunity: { id: string; title: string } })[] }>("/changes"),
      api.get<ProfileBundle>("/profile"),
    ]);
    return { opps: opps.items, apps: apps.items, stages: apps.stages, deadlines: deadlines.items, docs: docs.items, tasks: tasks.items, changes: changes.items, profile };
  });
  if (loading && !data) return <Spinner />;
  if (error || !data) return <Alert tone="red">{error}</Alert>;

  const open = data.opps.filter((o) => o.status !== "CLOSED");
  const soon = open.filter((o) => o.daysRemaining !== null && o.daysRemaining >= 0 && o.daysRemaining <= 14);
  const fully = open.filter((o) => o.fundingCategory === "FULLY_FUNDED");
  const free = open.filter((o) => o.feeStatus === "FREE");
  const noIelts = open.filter((o) => o.englishStatus === "REQUIRED_LATER" || o.englishStatus === "NOT_REQUIRED");
  const discovered = data.opps.filter((o) => !o.saved);

  const upcoming = data.deadlines.filter((d) => d.daysRemaining !== null && d.daysRemaining >= 0);
  const bucket = (max: number) => upcoming.filter((d) => d.daysRemaining! <= max);

  const today = new Date().toISOString().slice(0, 10);
  const openTasks = data.tasks.filter((t) => !t.done);
  const overdue = openTasks.filter((t) => t.dueDate && t.dueDate.slice(0, 10) < today);
  const todayTasks = openTasks.filter((t) => t.dueDate && t.dueDate.slice(0, 10) === today);
  const upcomingTasks = openTasks.filter((t) => !t.dueDate || t.dueDate.slice(0, 10) > today);

  const docTypes: [string, string[]][] = [
    ["CV", ["CV"]],
    ["SOP", ["SOP"]],
    ["Research proposal", ["RESEARCH_PROPOSAL"]],
    ["Transcripts", ["TRANSCRIPT"]],
    ["Passport", ["PASSPORT"]],
    ["Recommendations", ["RECOMMENDATION"]],
    ["IELTS / English", ["ENGLISH_TEST", "ENGLISH_MEDIUM_CERT"]],
  ];
  const appStages = ["DISCOVERED", "SHORTLISTED", "DOCUMENTS_PREPARING", "READY_TO_APPLY", "SUBMITTED", "INTERVIEW", "DECISION"];

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1>Where can I apply right now?</h1>
          <p className="text-sm text-slate-500">
            {open.length} open or unverified opportunities tracked · IELTS status: <b>{data.profile.profile.ieltsStatus.replace(/_/g, " ").toLowerCase()}</b>
          </p>
        </div>
        <Link to="/discover" className="btn-primary">
          <Search size={15} /> Analyse a PhD page
        </Link>
      </div>

      {data.changes.length > 0 && (
        <Alert tone="red" title={`CHANGE DETECTED on ${data.changes.length} saved item(s)`}>
          {data.changes.slice(0, 4).map((c) => (
            <div key={c.id}>
              <Link className="underline" to={`/opportunities/${c.opportunity.id}`}>
                {c.opportunity.title}
              </Link>
              : {c.label} — {c.oldValue} → {c.newValue}
            </div>
          ))}
        </Alert>
      )}

      <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
        <Stat label="Open opportunities" value={open.length} to="/discover" />
        <Stat label="Deadline ≤ 14 days" value={soon.length} to="/deadlines" tone={soon.length ? "red" : undefined} />
        <Stat label="Fully funded" value={fully.length} to="/discover?fullyFunded=true" />
        <Stat label="Free applications" value={free.length} to="/discover?freeOnly=true" />
        <Stat label="IELTS not required initially" value={noIelts.length} to="/discover?english=NOT_REQUIRED_INITIALLY" />
        <Stat label="Newly discovered" value={discovered.length} to="/discover?discovered=true" />
      </div>

      <div className="grid gap-5 lg:grid-cols-3">
        <Section
          className="lg:col-span-2"
          title={
            <span className="flex items-center gap-2">
              <CalendarClock size={16} /> Deadlines approaching
            </span>
          }
          actions={<Link to="/deadlines" className="btn-ghost">Calendar <ArrowRight size={14} /></Link>}
        >
          {upcoming.length === 0 ? (
            <Empty title="No upcoming verified deadlines">Save opportunities to track their deadlines here.</Empty>
          ) : (
            <ul className="divide-y divide-slate-100">
              {upcoming.slice(0, 8).map((d) => (
                <li key={d.id} className="flex items-center justify-between gap-3 py-2">
                  <div className="min-w-0">
                    <Link to={`/opportunities/${d.opportunity.id}`} className="block truncate text-sm font-medium hover:text-brand-700">
                      {d.opportunity.title}
                    </Link>
                    <p className="text-xs text-slate-500">
                      {d.opportunity.universityName} · {d.kind.replace(/_/g, " ").toLowerCase()} deadline {d.round ? `(${d.round})` : ""}
                      {d.yearInferred && <span className="text-amber-700"> · year not stated — verify</span>}
                    </p>
                  </div>
                  <div className="flex shrink-0 items-center gap-2 text-sm">
                    <span>{fmtDate(d.date)}</span>
                    <UrgencyBadge urgency={d.urgency}>{daysLabel(d.daysRemaining)}</UrgencyBadge>
                  </div>
                </li>
              ))}
            </ul>
          )}
          <div className="mt-3 grid grid-cols-4 gap-2 text-center text-xs">
            {[3, 7, 14, 30].map((n) => (
              <div key={n} className="rounded-lg bg-slate-50 p-2">
                <p className="text-lg font-semibold text-slate-900">{bucket(n).length}</p>
                <p className="text-slate-500">next {n} days</p>
              </div>
            ))}
          </div>
        </Section>

        <Section title="My applications" actions={<Link to="/applications" className="btn-ghost">Pipeline <ArrowRight size={14} /></Link>}>
          <ul className="space-y-1.5 text-sm">
            {appStages.map((s) => {
              const n = data.apps.filter((a) => a.stage === s || (s === "DOCUMENTS_PREPARING" && ["REQUIREMENTS_VERIFIED"].includes(a.stage)) || (s === "READY_TO_APPLY" && ["APPLICATION_STARTED", "AWAITING_USER_REVIEW"].includes(a.stage))).length;
              return (
                <li key={s} className="flex justify-between">
                  <span className="text-slate-600">{STAGE_LABELS[s]}</span>
                  <span className="font-semibold">{n}</span>
                </li>
              );
            })}
            <li className="flex justify-between border-t border-slate-100 pt-1.5">
              <span className="text-slate-600">Accepted / Rejected</span>
              <span className="font-semibold">
                {data.apps.filter((a) => a.decision === "ACCEPTED").length} / {data.apps.filter((a) => a.decision === "REJECTED").length}
              </span>
            </li>
          </ul>
        </Section>
      </div>

      <div className="grid gap-5 lg:grid-cols-3">
        <Section title="Open opportunities — soonest first" className="lg:col-span-2" actions={<Link to="/discover" className="btn-ghost">All <ArrowRight size={14} /></Link>}>
          {open.length === 0 ? (
            <Empty title="Nothing tracked yet">
              Paste an official PhD page into <Link className="text-brand-600 underline" to="/discover">Discover</Link>, use the browser extension, or add seed pages for the crawler.
            </Empty>
          ) : (
            <table className="w-full text-sm">
              <thead className="text-left text-xs text-slate-500">
                <tr>
                  <th className="pb-2 font-medium">Opportunity</th>
                  <th className="pb-2 font-medium">Funding</th>
                  <th className="pb-2 font-medium">Fee</th>
                  <th className="pb-2 font-medium">Deadline</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {open.slice(0, 8).map((o) => (
                  <tr key={o.id}>
                    <td className="py-2 pr-2">
                      <Link to={`/opportunities/${o.id}`} className="font-medium hover:text-brand-700">{o.title}</Link>
                      <div className="text-xs text-slate-500">{o.universityName} · {o.country}</div>
                    </td>
                    <td className="py-2 pr-2 text-xs">{o.fundingCategory.replace(/_/g, " ")}</td>
                    <td className="py-2 pr-2 text-xs">{o.feeStatus === "FREE" ? <Badge tone="green">FREE</Badge> : o.feeAmount ? `${o.feeCurrency} ${o.feeAmount}` : "UNKNOWN"}</td>
                    <td className="py-2 text-xs"><UrgencyBadge urgency={o.urgency}>{daysLabel(o.daysRemaining)}</UrgencyBadge></td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </Section>

        <div className="space-y-5">
          <Section title="Documents" actions={<Link to="/documents" className="btn-ghost">Vault <ArrowRight size={14} /></Link>}>
            <ul className="space-y-1.5 text-sm">
              {docTypes.map(([label, types]) => {
                const n = data.docs.filter((d) => types.includes(d.type) && d.status !== "ARCHIVED").length;
                const isIelts = label.startsWith("IELTS");
                return (
                  <li key={label} className="flex items-center justify-between">
                    <span className="flex items-center gap-2">
                      {n ? <CheckCircle2 size={15} className="text-emerald-600" /> : <Circle size={15} className="text-slate-300" />}
                      {label}
                    </span>
                    <span className="text-xs text-slate-500">{n ? `${n} file${n > 1 ? "s" : ""}` : isIelts ? data.profile.profile.ieltsStatus.replace(/_/g, " ").toLowerCase() : "missing"}</span>
                  </li>
                );
              })}
            </ul>
          </Section>
          <Section title="Tasks" actions={<Link to="/tasks" className="btn-ghost">All <ArrowRight size={14} /></Link>}>
            <TaskGroup label="Overdue" items={overdue} tone="red" />
            <TaskGroup label="Today" items={todayTasks} />
            <TaskGroup label="Upcoming" items={upcomingTasks.slice(0, 5)} />
            {!openTasks.length && <p className="text-sm text-slate-500">No open tasks.</p>}
          </Section>
        </div>
      </div>
    </div>
  );
}

function Stat({ label, value, to, tone }: { label: string; value: number; to: string; tone?: "red" }) {
  return (
    <Link to={to} className="card p-4 transition hover:border-brand-600">
      <p className={`text-2xl font-semibold ${tone === "red" ? "text-red-600" : "text-slate-900"}`}>{value}</p>
      <p className="text-xs text-slate-500">{label}</p>
    </Link>
  );
}

function TaskGroup({ label, items, tone }: { label: string; items: Task[]; tone?: "red" }): ReactNode {
  if (!items.length) return null;
  return (
    <div className="mb-2">
      <p className={`text-xs font-semibold ${tone === "red" ? "text-red-600" : "text-slate-500"}`}>
        {tone === "red" && <AlertTriangle size={12} className="mr-1 inline" />}
        {label} ({items.length})
      </p>
      <ul className="mt-1 space-y-1 text-sm">
        {items.map((t) => (
          <li key={t.id} className="truncate">
            {t.title} {t.dueDate && <span className="text-xs text-slate-500">· {fmtDate(t.dueDate)}</span>}
          </li>
        ))}
      </ul>
    </div>
  );
}
