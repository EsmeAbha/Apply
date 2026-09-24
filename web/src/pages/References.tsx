import { Plus, Trash2 } from "lucide-react";
import { useState, type FormEvent } from "react";
import { Link } from "react-router-dom";
import { Badge, Empty, Section, Spinner, toast, useLoad } from "../components/ui";
import { api } from "../lib/api";

interface RefRequest { id: string; name: string; email: string | null; institution: string | null; relationship: string | null; status: string; requestedAt: string | null; deadline: string | null; receivedAt: string | null; notes: string | null; application?: { opportunity?: { id: string; title: string } } | null }
const statuses = ["NOT_REQUESTED", "REQUESTED", "REMINDED", "RECEIVED", "DECLINED"];

export default function References() {
  const { data, loading, reload } = useLoad(() => api.get<{ items: RefRequest[] }>("/reference-requests"));
  const [name, setName] = useState("");
  const [institution, setInstitution] = useState("");
  const [deadline, setDeadline] = useState("");
  if (loading && !data) return <Spinner />;
  const add = async (e: FormEvent) => {
    e.preventDefault();
    try { await api.post("/reference-requests", { name, institution: institution || null, deadline: deadline || null }); setName(""); setInstitution(""); setDeadline(""); reload(); } catch (e) { toast((e as Error).message, "err"); }
  };
  return <div className="space-y-5">
    <div><h1>Reference letters</h1><p className="text-sm text-slate-500">Track referee requests, deadlines, reminders, and received letters. The app never sends the request for you.</p></div>
    <form onSubmit={add} className="card flex flex-col gap-2 p-3 sm:flex-row"><input className="input flex-1" required placeholder="Referee name" value={name} onChange={(e) => setName(e.target.value)} /><input className="input" placeholder="Institution" value={institution} onChange={(e) => setInstitution(e.target.value)} /><input className="input sm:w-44" type="date" value={deadline} onChange={(e) => setDeadline(e.target.value)} /><button className="btn-primary"><Plus size={14} /> Add referee</button></form>
    {!data?.items.length ? <Empty title="No referees tracked">Add a referee when an application requires recommendation letters.</Empty> : <Section title={`${data.items.length} referee request${data.items.length === 1 ? "" : "s"}`}><div className="space-y-2">{data.items.map((r) => <div key={r.id} className="rounded-lg border border-slate-200 p-3"><div className="flex flex-wrap items-start justify-between gap-2"><div><p className="font-medium">{r.name} {r.institution && <span className="font-normal text-slate-500">· {r.institution}</span>}</p>{r.application?.opportunity && <Link className="text-xs text-brand-600 hover:underline" to={`/opportunities/${r.application.opportunity.id}`}>{r.application.opportunity.title}</Link>}{r.deadline && <p className="text-xs text-slate-500">Needed by {new Date(r.deadline).toLocaleDateString()}</p>}</div><div className="flex items-center gap-2"><select className="input w-auto text-xs" value={r.status} onChange={async (e) => { await api.patch(`/reference-requests/${r.id}`, { status: e.target.value }); reload(); }}>{statuses.map((s) => <option key={s}>{s}</option>)}</select><button className="btn-ghost" onClick={async () => { await api.del(`/reference-requests/${r.id}`); reload(); }} aria-label="Delete referee"><Trash2 size={14} /></button></div></div></div>)}</div></Section>}
  </div>;
}
