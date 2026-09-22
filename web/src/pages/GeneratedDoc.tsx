import { Check, Copy, Download, Save, Vault } from "lucide-react";
import { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { Alert, Badge, Section, Spinner, toast, useLoad } from "../components/ui";
import { api } from "../lib/api";
import { fmtDateTime, human } from "../lib/format";
import type { Generated } from "../lib/types";

export default function GeneratedDoc() {
  const { id } = useParams();
  const { data, loading, reload } = useLoad(() => api.get<{ generated: Generated; comparison: { value: string; added: boolean; removed: boolean }[] | null }>(`/generated/${id}`), [id]);
  const [content, setContent] = useState("");
  const [view, setView] = useState<"edit" | "compare">("edit");
  useEffect(() => {
    if (data) setContent(data.generated.content);
  }, [data]);
  if (loading && !data) return <Spinner />;
  if (!data) return null;
  const g = data.generated;
  const dirty = content !== g.content;
  const placeholders = (content.match(/\[[A-Z][^\]]{3,}\]/g) ?? []).length;

  const save = async () => {
    await api.patch(`/generated/${g.id}`, { content });
    toast("Saved — claims re-checked against your sources");
    reload();
  };
  const approve = async () => {
    if (dirty) await api.patch(`/generated/${g.id}`, { content });
    await api.patch(`/generated/${g.id}`, { status: "APPROVED" });
    toast("Approved — the application package now counts it as ready");
    reload();
  };
  const toVault = async () => {
    const r = await api.post<{ version: { label: string } }>(`/generated/${g.id}/save-to-vault`);
    toast(`Saved to vault as ${r.version.label}`);
  };
  const txt = () => {
    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob([content], { type: "text/plain" }));
    a.download = `${g.title.replace(/[^A-Za-z0-9]+/g, "_")}.txt`;
    a.click();
  };

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-xs font-medium tracking-wide text-slate-500 uppercase">{human(g.kind)} draft · v{g.version} · {g.provider === "TEMPLATE" ? "rule-based template" : g.provider}</p>
          <h1>{g.title}</h1>
          {g.opportunity && <Link className="text-sm text-brand-600 hover:underline" to={`/opportunities/${g.opportunity.id}`}>{g.opportunity.title}</Link>}
          <div className="mt-1 flex gap-1.5"><Badge tone={g.status === "APPROVED" ? "green" : "slate"}>{g.status}</Badge><span className="text-xs text-slate-500">updated {fmtDateTime(g.updatedAt)}</span></div>
        </div>
        <div className="flex flex-wrap gap-2">
          <button className="btn-secondary" onClick={() => { navigator.clipboard.writeText(content); toast("Copied"); }}><Copy size={14} /> Copy</button>
          <button className="btn-secondary" onClick={txt}><Download size={14} /> .txt</button>
          <button className="btn-secondary" onClick={toVault}><Vault size={14} /> Save to vault (new version)</button>
          <button className="btn-secondary" disabled={!dirty} onClick={save}><Save size={14} /> Save edits</button>
          <button className="btn-primary" onClick={approve} disabled={placeholders > 0} title={placeholders ? "Fill all [PLACEHOLDERS] first" : ""}><Check size={14} /> Approve</button>
        </div>
      </div>

      {placeholders > 0 && <Alert>{placeholders} [BRACKETED PLACEHOLDER]{placeholders > 1 ? "s" : ""} still need your own, genuine content before this draft can be approved.</Alert>}
      {g.warnings.length > 0 && (
        <Alert tone="red" title="Check these claims — not found in your verified profile, documents or the opportunity page">
          <ul className="list-disc pl-5">{g.warnings.map((w) => <li key={w.claim}>{w.message}</li>)}</ul>
          <p className="mt-1 text-xs">If a claim is true, add it to your profile first; otherwise remove it.</p>
        </Alert>
      )}

      <div className="grid gap-5 lg:grid-cols-3">
        <Section
          className="lg:col-span-2"
          title="Document"
          actions={
            g.baseContent ? (
              <div className="flex rounded-lg border border-slate-200 p-0.5 text-xs">
                <button className={`rounded px-2 py-1 ${view === "edit" ? "bg-brand-50 text-brand-700" : ""}`} onClick={() => setView("edit")}>Edit</button>
                <button className={`rounded px-2 py-1 ${view === "compare" ? "bg-brand-50 text-brand-700" : ""}`} onClick={() => setView("compare")}>Compare with master</button>
              </div>
            ) : null
          }
        >
          {view === "edit" || !data.comparison ? (
            <textarea className="input h-[60vh] font-serif text-sm leading-relaxed" value={content} onChange={(e) => setContent(e.target.value)} />
          ) : (
            <div className="h-[60vh] overflow-y-auto rounded-lg border border-slate-200 p-3 font-serif text-sm leading-relaxed whitespace-pre-wrap">
              {data.comparison.map((p, i) => (
                <span key={i} className={p.added ? "bg-emerald-100 text-emerald-900" : p.removed ? "bg-red-100 text-red-800 line-through" : ""}>{p.value}</span>
              ))}
            </div>
          )}
          <p className="mt-1 text-xs text-slate-500">{content.trim().split(/\s+/).filter(Boolean).length} words</p>
        </Section>
        <Section title="Changes & reasons">
          <ul className="space-y-3 text-sm">
            {g.changes.map((c, i) => (
              <li key={i} className="rounded-lg border border-slate-100 p-2">
                <p className="font-medium">{c.section}</p>
                <p className="text-xs text-slate-600">{c.reason}</p>
                {c.original && c.original !== "(new paragraph)" && <p className="mt-1 text-xs text-red-700 line-through">{c.original.slice(0, 200)}</p>}
                {c.customized && <p className="mt-1 text-xs text-emerald-800">{c.customized.slice(0, 300)}</p>}
              </li>
            ))}
          </ul>
        </Section>
      </div>
    </div>
  );
}
