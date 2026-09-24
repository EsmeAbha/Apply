import { CheckCircle2, Circle, ClipboardCheck, Download, ExternalLink, RefreshCw } from "lucide-react";
import { useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { Alert, Badge, Field, Section, Spinner, toast, UrgencyBadge, useLoad } from "../components/ui";
import { api, download } from "../lib/api";
import { daysLabel, fmtDate, human, STAGE_LABELS } from "../lib/format";
import type { AppDocument, ChecklistItem, Extraction, MatchAnalysis, OpportunitySummary, VaultDocument } from "../lib/types";

export interface AppDetail {
  application: { id: string; stage: string; decision: string | null; notes: string | null; portalUrl: string | null; portalUsername: string | null; submittedAt: string | null; submissionConfirmation: string | null };
  opportunity: OpportunitySummary;
  extraction: Extraction;
  documents: AppDocument[];
  generated: { id: string; kind: string; title: string; status: string; version: number }[];
  checklist: { items: ChecklistItem[]; readyForFinalReview: boolean; complete: boolean };
  readiness: { requiredReady: number; requiredTotal: number; percent: number; note: string };
  match: MatchAnalysis;
  pendingChanges: { id: string; label: string; oldValue: string; newValue: string }[];
  ieltsStatus: string;
}

const STATUS_TONE: Record<string, "green" | "blue" | "amber" | "slate" | "red"> = { READY: "green", CUSTOMIZED: "blue", DRAFT: "amber", PENDING: "amber", MISSING: "red", NOT_REQUIRED: "slate" };

export default function ApplicationDetail() {
  const { id } = useParams();
  const nav = useNavigate();
  const { data, loading, reload } = useLoad(() => api.get<AppDetail>(`/applications/${id}`), [id]);
  const vault = useLoad(() => api.get<{ items: VaultDocument[] }>("/documents"));
  const [notes, setNotes] = useState<string | null>(null);
  if (loading && !data) return <Spinner />;
  if (!data) return null;
  const a = data.application;
  const o = data.opportunity;

  const setDoc = async (key: string, body: object) => {
    await api.patch(`/applications/${a.id}/documents/${key}`, body);
    reload();
  };
  const toggle = async (item: ChecklistItem) => {
    await api.post(`/applications/${a.id}/checklist`, { key: item.key, done: !item.confirmedByUser });
    reload();
  };
  const refresh = async () => {
    await api.post(`/applications/${a.id}/refresh-package`);
    toast("Package re-checked against your vault and drafts");
    reload();
  };
  const versions = vault.data?.items.flatMap((d) => d.versions.map((v) => ({ id: v.id, label: `${v.label} — ${d.name}`, type: d.type }))) ?? [];

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-xs font-medium tracking-wide text-slate-500 uppercase">Application · {STAGE_LABELS[a.stage]}</p>
          <h1><Link to={`/opportunities/${o.id}`} className="hover:text-brand-700">{o.title}</Link></h1>
          <p className="text-sm text-slate-500">{o.universityName} · {o.country} · deadline {fmtDate(o.primaryDeadline)} <UrgencyBadge urgency={o.urgency}>{daysLabel(o.daysRemaining)}</UrgencyBadge></p>
        </div>
        <div className="flex flex-wrap gap-2">
          <select className="input w-auto" value={a.stage} onChange={async (e) => { try { await api.patch(`/applications/${a.id}`, { stage: e.target.value }); reload(); } catch (err) { toast((err as Error).message, "err"); } }}>
            {Object.entries(STAGE_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </select>
          <button className="btn-secondary" onClick={() => download(`/applications/${a.id}/package`, "package.zip").catch((e) => toast(e.message, "err"))}><Download size={14} /> Download package</button>
          <button className={data.checklist.readyForFinalReview ? "btn-primary" : "btn-secondary"} onClick={() => nav(`/applications/${a.id}/review`)}><ClipboardCheck size={14} /> Final review</button>
                  <button className="btn-secondary" onClick={() => nav(`/applications/${a.id}/interview`)}>Interview prep</button>
        </div>
      </div>

      {data.pendingChanges.length > 0 && (
        <Alert tone="red" title="The official page changed since you saved it">
          {data.pendingChanges.map((c) => <div key={c.id}>{c.label}: {c.oldValue} → {c.newValue}</div>)}
          <Link className="underline" to={`/opportunities/${o.id}`}>Review changes</Link>
        </Alert>
      )}

      <div className="grid gap-5 lg:grid-cols-3">
        <Section className="lg:col-span-2" title="Application package" actions={<button className="btn-ghost" onClick={refresh}><RefreshCw size={14} /> Re-check</button>}>
          <div className="mb-3">
            <div className="mb-1 flex justify-between text-xs text-slate-600">
              <span>Required documents ready: {data.readiness.requiredReady}/{data.readiness.requiredTotal}</span>
              <span>{data.readiness.percent}%</span>
            </div>
            <div className="h-2 rounded-full bg-slate-100"><div className="h-2 rounded-full bg-brand-600" style={{ width: `${data.readiness.percent}%` }} /></div>
            <p className="mt-1 text-xs text-slate-500">{data.readiness.note}</p>
          </div>
          <table className="w-full text-sm">
            <thead className="text-left text-xs text-slate-500">
              <tr><th className="pb-1 font-medium">Document</th><th className="pb-1 font-medium">Status</th><th className="pb-1 font-medium">Linked file / draft</th><th /></tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {data.documents.map((d) => (
                <tr key={d.id} className="align-top">
                  <td className="py-2 pr-2">
                    <p className="font-medium">{d.label}</p>
                    <p className="text-xs text-slate-500">{human(d.necessity)}{d.count ? ` · ${d.countReady ?? 0}/${d.count}` : ""}</p>
                    {d.notes && <p className="text-xs text-slate-500">{d.notes}</p>}
                  </td>
                  <td className="py-2 pr-2">
                    <select className="rounded border border-slate-200 px-1 py-0.5 text-xs" value={d.status} onChange={(e) => setDoc(d.requirementKey, { status: e.target.value })}>
                      {["MISSING", "DRAFT", "CUSTOMIZED", "READY", "PENDING", "NOT_REQUIRED"].map((s) => <option key={s} value={s}>{s}</option>)}
                    </select>
                    <div className="mt-1"><Badge tone={STATUS_TONE[d.status] ?? "slate"}>{d.status}</Badge></div>
                  </td>
                  <td className="py-2 pr-2">
                    {d.generatedDocumentId ? (
                      <Link className="text-xs text-brand-600 hover:underline" to={`/generated/${d.generatedDocumentId}`}>Tailored draft</Link>
                    ) : (
                      <select className="w-48 rounded border border-slate-200 px-1 py-0.5 text-xs" value={d.documentVersionId ?? ""} onChange={(e) => setDoc(d.requirementKey, { documentVersionId: e.target.value || null, status: e.target.value ? "READY" : "MISSING" })}>
                        <option value="">— attach from vault —</option>
                        {versions.map((v) => <option key={v.id} value={v.id}>{v.label}</option>)}
                      </select>
                    )}
                  </td>
                  <td className="py-2 text-right">
                    {["SOP", "MOTIVATION_LETTER", "COVER_LETTER", "RESEARCH_PROPOSAL", "RESEARCH_STATEMENT", "PERSONAL_STATEMENT"].includes(d.requirementKey) && !d.generatedDocumentId && (
                      <Link to={`/opportunities/${o.id}#generate`} className="text-xs text-brand-600 hover:underline">Tailor</Link>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </Section>

        <Section title="APPLY NOW checklist">
          <ul className="space-y-2">
            {data.checklist.items.map((it) => (
              <li key={it.key} className="flex gap-2 text-sm">
                {it.done ? <CheckCircle2 size={17} className="mt-0.5 shrink-0 text-emerald-600" /> : <Circle size={17} className="mt-0.5 shrink-0 text-slate-300" />}
                <div className="min-w-0 flex-1">
                  <p className={it.done ? "text-slate-900" : "text-slate-700"}>{it.label}</p>
                  <p className="text-xs text-slate-500">{it.detail}</p>
                  {it.key !== "final" && (
                    <button className="text-xs text-brand-600 hover:underline" onClick={() => toggle(it)}>
                      {it.confirmedByUser ? "Undo my confirmation" : it.done ? "" : "I verified this myself"}
                    </button>
                  )}
                </div>
              </li>
            ))}
          </ul>
          <div className="mt-3">
            {data.checklist.readyForFinalReview ? (
              <Alert tone="green" title="READY FOR FINAL REVIEW">Open the final review, then submit on the official portal yourself.</Alert>
            ) : (
              <p className="text-xs text-slate-500">Complete the checks above to reach “Ready for final review”.</p>
            )}
          </div>
        </Section>
      </div>

      <div className="grid gap-5 lg:grid-cols-2">
        <Section title="Portal & notes">
          <div className="space-y-2">
            <Field label="Official application portal URL"><input className="input" defaultValue={a.portalUrl ?? o.applyUrl ?? ""} onBlur={(e) => api.patch(`/applications/${a.id}`, { portalUrl: e.target.value }).catch((er) => toast(er.message, "err"))} /></Field>
            <Field label="Portal username (passwords are never stored — use your browser's password manager)"><input className="input" defaultValue={a.portalUsername ?? ""} onBlur={(e) => api.patch(`/applications/${a.id}`, { portalUsername: e.target.value })} /></Field>
            <Field label="Notes"><textarea className="input h-28" value={notes ?? a.notes ?? ""} onChange={(e) => setNotes(e.target.value)} onBlur={() => notes !== null && api.patch(`/applications/${a.id}`, { notes }).then(() => toast("Notes saved"))} /></Field>
            {(a.portalUrl || o.applyUrl) && <a className="btn-secondary" href={a.portalUrl ?? o.applyUrl!} target="_blank" rel="noreferrer"><ExternalLink size={14} /> Open official application portal</a>}
          </div>
        </Section>
        <Section title="Match & readiness summary">
          <dl className="grid grid-cols-[10rem_1fr] gap-y-1.5 text-sm">
            <dt className="text-slate-500">Research alignment</dt><dd>{data.match.researchAlignment.level}</dd>
            <dt className="text-slate-500">Degree</dt><dd>{human(data.match.degreeCompatibility.level)}</dd>
            <dt className="text-slate-500">Funding</dt><dd>{data.match.funding}</dd>
            <dt className="text-slate-500">Application fee</dt><dd>{data.match.applicationCost}</dd>
            <dt className="text-slate-500">IELTS</dt><dd>{data.extraction.english.summary} <span className="text-xs text-slate-500">(your status: {human(data.ieltsStatus)})</span></dd>
            <dt className="text-slate-500">Documents ready</dt><dd>{data.readiness.requiredReady}/{data.readiness.requiredTotal}</dd>
          </dl>
          <p className="mt-2 text-xs text-slate-500">{data.match.disclaimer}</p>
          {a.submittedAt && <Alert tone="green" title="Submitted (confirmed by you)">{fmtDate(a.submittedAt)} {a.submissionConfirmation && `· reference ${a.submissionConfirmation}`}</Alert>}
          <div className="mt-3 flex flex-wrap gap-2">
            {(["OFFER", "ACCEPTED", "REJECTED", "WAITLISTED", "WITHDRAWN"] as const).map((d) => (
              <button key={d} className={a.decision === d ? "btn-primary" : "btn-ghost"} onClick={async () => { await api.patch(`/applications/${a.id}`, { decision: d }); reload(); }}>{human(d)}</button>
            ))}
          </div>
        </Section>
      </div>
    </div>
  );
}
