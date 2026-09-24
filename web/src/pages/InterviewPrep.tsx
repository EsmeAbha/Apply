import { Save, Sparkles } from "lucide-react";
import { useState } from "react";
import { Link, useParams } from "react-router-dom";
import { Alert, Section, Spinner, toast, useLoad } from "../components/ui";
import { api } from "../lib/api";

interface Question { category: string; question: string; answer: string }
interface Prep { questions: Question[]; notes: string | null }

export default function InterviewPrep() {
  const { id } = useParams();
  const { data, loading, reload } = useLoad(() => api.get<{ prep: Prep | null }>(`/applications/${id}/interview-prep`), [id]);
  const [prep, setPrep] = useState<Prep | null>(null);
  if (loading && !data) return <Spinner />;
  const current = prep ?? data?.prep;
  const generate = async () => { try { const r = await api.post<{ prep: Prep }>(`/applications/${id}/interview-prep/generate`); setPrep(r.prep); toast("Interview questions generated"); } catch (e) { toast((e as Error).message, "err"); } };
  const save = async () => { if (!current) return; await api.patch(`/applications/${id}/interview-prep`, current); toast("Interview preparation saved"); reload(); };
  return <div className="mx-auto max-w-4xl space-y-5"><div><Link className="text-sm text-brand-600 hover:underline" to={`/applications/${id}`}>Back to application</Link><h1>Interview preparation</h1><p className="text-sm text-slate-500">Questions are grounded in the opportunity facts. Write only truthful answers from your own experience.</p></div>{!current ? <Section title="Start preparation"><button className="btn-primary" onClick={generate}><Sparkles size={14} /> Generate questions</button></Section> : <><Alert tone="blue">Use these as practice prompts, not as claims to memorize. Review every answer for accuracy.</Alert><Section title="Practice questions" actions={<button className="btn-primary" onClick={save}><Save size={14} /> Save answers</button>}><div className="space-y-4">{current.questions.map((q, i) => <div key={i}><p className="text-xs font-medium uppercase tracking-wide text-slate-500">{q.category}</p><p className="mt-1 font-medium">{q.question}</p><textarea className="input mt-2 min-h-24" placeholder="Write your genuine answer..." value={q.answer} onChange={(e) => setPrep({ ...current, questions: current.questions.map((x, j) => j === i ? { ...x, answer: e.target.value } : x) })} /></div>)}</div></Section><Section title="Notes"><textarea className="input min-h-32" value={current.notes ?? ""} onChange={(e) => setPrep({ ...current, notes: e.target.value })} /></Section></>}</div>;
}
