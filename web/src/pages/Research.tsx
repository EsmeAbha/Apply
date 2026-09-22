import { Plus, X } from "lucide-react";
import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { Badge, Section, Spinner, toast, useLoad } from "../components/ui";
import { api } from "../lib/api";
import { fmtDateTime, human } from "../lib/format";
import type { Generated, ProfileBundle } from "../lib/types";

const SUGGESTED = ["Artificial Intelligence", "Machine Learning", "Deep Learning", "Large Language Models", "Natural Language Processing", "Computer Vision", "Data Science", "Intelligent Systems", "Computer Science", "Cybersecurity", "Dependable and Secure Computing", "Low-resource Languages", "Conversational AI", "Self-supervised Learning", "Reinforcement Learning", "Explainable AI", "Speech Processing", "Robotics", "Human-Computer Interaction", "Medical AI"];

export default function Research() {
  const { data, loading, reload } = useLoad(() => api.get<ProfileBundle>("/profile"));
  const gen = useLoad(() => api.get<{ items: Generated[] }>("/generated"));
  const [interests, setInterests] = useState<string[]>([]);
  const [newInterest, setNewInterest] = useState("");
  const [sop, setSop] = useState("");
  const [cover, setCover] = useState("");
  useEffect(() => {
    if (!data) return;
    setInterests(data.interests.map((i) => i.name));
    setSop(data.profile.masterSop ?? "");
    setCover(data.profile.masterCoverLetter ?? "");
  }, [data]);
  if (loading && !data) return <Spinner />;

  const saveInterests = async (next: string[]) => {
    setInterests(next);
    await api.put("/profile/interests", { interests: next });
    toast("Research interests updated — matching uses them immediately");
  };
  const saveMasters = async () => {
    await api.put("/profile", { masterSop: sop || null, masterCoverLetter: cover || null });
    toast("Master documents saved");
    reload();
  };

  return (
    <div className="space-y-5">
      <div>
        <h1>Research profile</h1>
        <p className="text-sm text-slate-500">Your research interests drive discovery, matching and supervisor suggestions. Master documents are the only basis for tailored drafts.</p>
      </div>
      <Section title="Research interests (in priority order)">
        <div className="mb-3 flex flex-wrap gap-2">
          {interests.map((i) => (
            <span key={i} className="chip bg-brand-50 text-brand-700 ring-brand-100">
              {i}
              <button onClick={() => saveInterests(interests.filter((x) => x !== i))} aria-label={`Remove ${i}`}><X size={12} /></button>
            </span>
          ))}
        </div>
        <form className="flex gap-2" onSubmit={(e) => { e.preventDefault(); if (newInterest.trim() && !interests.includes(newInterest.trim())) saveInterests([...interests, newInterest.trim()]); setNewInterest(""); }}>
          <input className="input" placeholder="Add a research interest (any topic)" value={newInterest} onChange={(e) => setNewInterest(e.target.value)} />
          <button className="btn-secondary"><Plus size={14} /> Add</button>
        </form>
        <p className="mt-3 text-xs text-slate-500">Suggestions:</p>
        <div className="mt-1 flex flex-wrap gap-1.5">
          {SUGGESTED.filter((s) => !interests.includes(s)).map((s) => (
            <button key={s} className="chip bg-slate-50 text-slate-600 ring-slate-200 hover:bg-slate-100" onClick={() => saveInterests([...interests, s])}>+ {s}</button>
          ))}
        </div>
      </Section>

      <div className="grid gap-5 lg:grid-cols-2">
        <Section title="Master Statement of Purpose" actions={<button className="btn-primary" onClick={saveMasters}>Save</button>}>
          <p className="mb-2 text-xs text-slate-500">Write your own master SOP. Optional placeholders: [UNIVERSITY], [PROGRAM], [DEPARTMENT], [SUPERVISOR], [RESEARCH AREA]. Paragraphs separated by blank lines.</p>
          <textarea className="input h-80 font-serif text-sm leading-relaxed" value={sop} onChange={(e) => setSop(e.target.value)} placeholder="I am applying to…" />
          <p className="mt-1 text-xs text-slate-500">{sop.trim().split(/\s+/).filter(Boolean).length} words</p>
        </Section>
        <Section title="Master cover letter (optional)" actions={<button className="btn-primary" onClick={saveMasters}>Save</button>}>
          <textarea className="input h-80 font-serif text-sm leading-relaxed" value={cover} onChange={(e) => setCover(e.target.value)} placeholder="Dear…" />
        </Section>
      </div>

      <Section title="Generated drafts">
        {!gen.data?.items.length ? (
          <p className="text-sm text-slate-500">No drafts yet. Open an opportunity and use “Tailored documents”.</p>
        ) : (
          <table className="w-full text-sm">
            <tbody className="divide-y divide-slate-100">
              {gen.data.items.map((g) => (
                <tr key={g.id}>
                  <td className="py-1.5"><Link className="text-brand-600 hover:underline" to={`/generated/${g.id}`}>{g.title}</Link></td>
                  <td className="py-1.5 text-xs text-slate-500">{human(g.kind)} · {g.provider === "TEMPLATE" ? "template" : g.provider}</td>
                  <td className="py-1.5 text-xs text-slate-500">{fmtDateTime(g.updatedAt)}</td>
                  <td className="py-1.5 text-right">{g.warnings.length > 0 && <Badge tone="amber">{g.warnings.length} to check</Badge>} <Badge tone={g.status === "APPROVED" ? "green" : "slate"}>{g.status}</Badge></td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Section>
    </div>
  );
}
