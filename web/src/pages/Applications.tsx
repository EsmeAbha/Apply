import { useState } from "react";
import { Link } from "react-router-dom";
import { Badge, Empty, Spinner, toast, UrgencyBadge, useLoad } from "../components/ui";
import { api } from "../lib/api";
import { daysLabel, STAGE_LABELS } from "../lib/format";
import type { OpportunitySummary } from "../lib/types";

interface AppRow { id: string; stage: string; decision: string | null; submittedAt: string | null; opportunity: OpportunitySummary; documentsReady: number; documentsRequired: number }

export default function Applications() {
  const { data, loading, reload, setData } = useLoad(() => api.get<{ items: AppRow[]; stages: string[] }>("/applications"));
  const [dragId, setDragId] = useState<string | null>(null);
  const [over, setOver] = useState<string | null>(null);

  if (loading && !data) return <Spinner />;
  if (!data) return null;

  const move = async (id: string, stage: string) => {
    const app = data.items.find((a) => a.id === id);
    if (!app || app.stage === stage) return;
    if (stage === "SUBMITTED" && !app.submittedAt) {
      toast("Open the application's Final Review and confirm that YOU submitted it — the app never marks it submitted on its own.", "err");
      return;
    }
    setData({ ...data, items: data.items.map((a) => (a.id === id ? { ...a, stage } : a)) });
    try {
      await api.patch(`/applications/${id}`, { stage });
    } catch (e) {
      toast((e as Error).message, "err");
      reload();
    }
  };

  return (
    <div className="space-y-4">
      <div>
        <h1>Application pipeline</h1>
        <p className="text-sm text-slate-500">Drag cards between stages. “Submitted” is recorded only after you confirm on the Final Review page that you submitted on the official portal.</p>
      </div>
      {!data.items.length ? (
        <Empty title="No applications yet">Open an opportunity and click “Start application”.</Empty>
      ) : (
        <div className="flex gap-3 overflow-x-auto pb-4">
          {data.stages.map((stage) => {
            const items = data.items.filter((a) => a.stage === stage);
            return (
              <div
                key={stage}
                onDragOver={(e) => { e.preventDefault(); setOver(stage); }}
                onDragLeave={() => setOver(null)}
                onDrop={(e) => { e.preventDefault(); setOver(null); if (dragId) move(dragId, stage); }}
                className={`flex w-64 shrink-0 flex-col rounded-xl border p-2 ${over === stage ? "border-brand-600 bg-brand-50" : "border-slate-200 bg-slate-100/60"}`}
              >
                <p className="mb-2 flex items-center justify-between px-1 text-xs font-semibold tracking-wide text-slate-600 uppercase">
                  {STAGE_LABELS[stage]} <span className="rounded-full bg-white px-1.5 text-slate-500">{items.length}</span>
                </p>
                <div className="flex min-h-24 flex-col gap-2">
                  {items.map((a) => (
                    <div key={a.id} draggable onDragStart={() => setDragId(a.id)} onDragEnd={() => setDragId(null)} className="card cursor-grab p-3 active:cursor-grabbing">
                      <Link to={`/applications/${a.id}`} className="block text-sm font-medium hover:text-brand-700">{a.opportunity.title}</Link>
                      <p className="text-xs text-slate-500">{a.opportunity.universityName}</p>
                      <div className="mt-2 flex flex-wrap gap-1">
                        <UrgencyBadge urgency={a.opportunity.urgency}>{daysLabel(a.opportunity.daysRemaining)}</UrgencyBadge>
                        <Badge tone={a.documentsReady === a.documentsRequired && a.documentsRequired > 0 ? "green" : "slate"}>Docs {a.documentsReady}/{a.documentsRequired}</Badge>
                        {a.decision && <Badge tone={a.decision === "ACCEPTED" ? "green" : a.decision === "REJECTED" ? "red" : "amber"}>{a.decision}</Badge>}
                      </div>
                      <select className="mt-2 w-full rounded border border-slate-200 bg-white px-1 py-0.5 text-xs" value={a.stage} onChange={(e) => move(a.id, e.target.value)} aria-label="Move to stage">
                        {data.stages.map((s) => <option key={s} value={s}>{STAGE_LABELS[s]}</option>)}
                      </select>
                    </div>
                  ))}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
