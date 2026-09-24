import { Plus, Trash2 } from "lucide-react";
import { useState, type FormEvent } from "react";
import { Alert, Empty, Section, Spinner, toast, useLoad } from "../components/ui";
import { api } from "../lib/api";

interface Answer { id: string; siteKey: string; fieldKey: string; label: string; value: string; approved: boolean; updatedAt: string }

export default function FormMemory() {
  const { data, loading, reload } = useLoad(() => api.get<{ items: Answer[] }>("/form-answers"));
  const [siteKey, setSiteKey] = useState("");
  const [fieldKey, setFieldKey] = useState("");
  const [label, setLabel] = useState("");
  const [value, setValue] = useState("");
  if (loading && !data) return <Spinner />;
  const add = async (e: FormEvent) => {
    e.preventDefault();
    try {
      await api.post("/form-answers", { siteKey, fieldKey, label, value, approved: true });
      setFieldKey(""); setLabel(""); setValue(""); reload();
    } catch (err) { toast((err as Error).message, "err"); }
  };
  return <div className="space-y-5">
    <div><h1>Form memory</h1><p className="text-sm text-slate-500">Approved non-sensitive answers the Chrome extension may reuse on matching university sites.</p></div>
    <Alert tone="blue">Do not save passwords, declarations, citizenship, date of birth, medical, financial, legal, consent, or identity-document answers here. The extension keeps those fields manual.</Alert>
    <form onSubmit={add} className="card grid gap-2 p-3 md:grid-cols-2"><input className="input" required placeholder="Site, e.g. apply.university.edu" value={siteKey} onChange={(e) => setSiteKey(e.target.value)} /><input className="input" required placeholder="Field key, e.g. researchInterests" value={fieldKey} onChange={(e) => setFieldKey(e.target.value)} /><input className="input" required placeholder="Human label" value={label} onChange={(e) => setLabel(e.target.value)} /><input className="input" required placeholder="Approved answer" value={value} onChange={(e) => setValue(e.target.value)} /><button className="btn-primary md:col-span-2"><Plus size={14} /> Save approved answer</button></form>
    {!data?.items.length ? <Empty title="No saved answers">The extension can still use your general profile values. Add site-specific answers only when you have reviewed them.</Empty> : <Section title={`${data.items.length} saved answer${data.items.length === 1 ? "" : "s"}`}><div className="space-y-2">{data.items.map((a) => <div key={a.id} className="flex flex-wrap items-start justify-between gap-2 rounded-lg border border-slate-200 p-3"><div><p className="font-medium">{a.label} <span className="font-normal text-slate-500">· {a.siteKey}</span></p><p className="text-sm text-slate-700">{a.value}</p><p className="text-xs text-slate-500">Field key: {a.fieldKey}</p></div><button className="btn-ghost" onClick={async () => { if (confirm(`Delete saved answer “${a.label}”?`)) { await api.del(`/form-answers/${a.id}`); reload(); } }} aria-label="Delete saved answer"><Trash2 size={14} /></button></div>)}</div></Section>}
  </div>;
}
