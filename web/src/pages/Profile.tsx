import { Plus, Trash2 } from "lucide-react";
import { useEffect, useState, type FormEvent } from "react";
import { Alert, Badge, Field, Section, Spinner, toast, useLoad } from "../components/ui";
import { api } from "../lib/api";
import { human } from "../lib/format";
import type { Profile, ProfileBundle } from "../lib/types";

const csv = (a: string[]) => a.join(", ");
const parseCsv = (s: string) => s.split(",").map((x) => x.trim()).filter(Boolean);
const ITEM_KINDS = ["PUBLICATION", "PROJECT", "RESEARCH_EXPERIENCE", "WORK_EXPERIENCE", "TEACHING", "AWARD", "CERTIFICATION", "REFERENCE"];

export default function ProfilePage() {
  const { data, loading, reload } = useLoad(() => api.get<ProfileBundle>("/profile"));
  const [p, setP] = useState<Profile | null>(null);
  useEffect(() => {
    if (data) setP(data.profile);
  }, [data]);
  if ((loading && !data) || !p || !data) return <Spinner />;

  const set = <K extends keyof Profile>(k: K, v: Profile[K]) => setP({ ...p, [k]: v });
  const save = async () => {
    try {
      // The server validates and ignores read-only keys (id, timestamps).
      await api.put("/profile", { ...p, notificationPrefs: p.notificationPrefs ?? undefined });
      toast("Profile saved");
      reload();
    } catch (e) {
      toast((e as Error).message, "err");
    }
  };
  const scores = p.ieltsScores ?? {};

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1>Master profile</h1>
          <p className="text-sm text-slate-500">Generated documents may only use what is recorded here (and in your uploaded documents). Nothing sensitive is inferred.</p>
        </div>
        <button className="btn-primary" onClick={save}>Save profile</button>
      </div>

      <div className="grid gap-5 lg:grid-cols-2">
        <Section title="Personal information">
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Full name"><input className="input" value={p.fullName ?? ""} onChange={(e) => set("fullName", e.target.value)} /></Field>
            <Field label="Contact email"><input className="input" value={p.contactEmail ?? ""} onChange={(e) => set("contactEmail", e.target.value)} /></Field>
            <Field label="Phone"><input className="input" value={p.phone ?? ""} onChange={(e) => set("phone", e.target.value)} /></Field>
            <Field label="Timezone (for deadlines)"><input className="input" value={p.timezone} onChange={(e) => set("timezone", e.target.value)} placeholder="Asia/Dhaka" /></Field>
            <Field label="Address"><input className="input" value={p.address ?? ""} onChange={(e) => set("address", e.target.value)} /></Field>
            <Field label="Nationality (optional, never auto-filled)"><input className="input" value={p.nationality ?? ""} onChange={(e) => set("nationality", e.target.value)} /></Field>
            <Field label="Date of birth (optional, never auto-filled)"><input className="input" value={p.dateOfBirth ?? ""} onChange={(e) => set("dateOfBirth", e.target.value)} placeholder="YYYY-MM-DD" /></Field>
            <Field label="Preferred countries" hint="Comma-separated; used for search suggestions only">
              <input className="input" value={csv(p.preferredCountries)} onChange={(e) => set("preferredCountries", parseCsv(e.target.value))} />
            </Field>
          </div>
        </Section>

        <Section title="English proficiency & IELTS planning">
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="IELTS status">
              <select className="input" value={p.ieltsStatus} onChange={(e) => set("ieltsStatus", e.target.value)}>
                {["NOT_TAKEN", "PLANNED", "BOOKED", "TAKEN", "SCORE_RECEIVED"].map((s) => <option key={s} value={s}>{human(s)}</option>)}
              </select>
            </Field>
            <Field label="Test date (planned / booked / taken)"><input className="input" value={p.ieltsTestDate ?? ""} onChange={(e) => set("ieltsTestDate", e.target.value)} placeholder="YYYY-MM-DD" /></Field>
            {p.ieltsStatus === "SCORE_RECEIVED" && (
              <div className="grid grid-cols-5 gap-2 sm:col-span-2">
                {(["overall", "listening", "reading", "writing", "speaking"] as const).map((k) => (
                  <Field key={k} label={human(k)}>
                    <input className="input" type="number" step="0.5" min="0" max="9" value={scores[k] ?? ""} onChange={(e) => set("ieltsScores", { ...scores, [k]: e.target.value ? Number(e.target.value) : null })} />
                  </Field>
                ))}
              </div>
            )}
            <Field label="Previous degree taught in English?">
              <select className="input" value={p.englishMediumEducation} onChange={(e) => set("englishMediumEducation", e.target.value)}>
                <option value="UNKNOWN">Not recorded</option>
                <option value="YES">Yes (I can document it)</option>
                <option value="NO">No</option>
              </select>
            </Field>
            <Field label="Evidence (e.g. medium-of-instruction certificate)"><input className="input" value={p.englishMediumEvidence ?? ""} onChange={(e) => set("englishMediumEvidence", e.target.value)} /></Field>
          </div>
          <p className="mt-2 text-xs text-slate-500">
            The assistant highlights opportunities where IELTS is not required initially, can be submitted later, or may be waived — but it never assumes you qualify for a waiver. Confirm with each university.
          </p>
        </Section>

        <Section title="Academic direction & skills" className="lg:col-span-2">
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Current degree"><input className="input" value={p.currentDegree ?? ""} onChange={(e) => set("currentDegree", e.target.value)} /></Field>
            <Field label="Field / department"><input className="input" value={p.field ?? ""} onChange={(e) => set("field", e.target.value)} /></Field>
            <Field label="Technical skills (comma-separated)"><input className="input" value={csv(p.skills)} onChange={(e) => set("skills", parseCsv(e.target.value))} placeholder="PyTorch, Transformers, …" /></Field>
            <Field label="Programming languages"><input className="input" value={csv(p.programmingLanguages)} onChange={(e) => set("programmingLanguages", parseCsv(e.target.value))} /></Field>
            <Field label="Languages spoken (Language:level, …)">
              <input className="input" value={p.languages.map((l) => (l.level ? `${l.language}:${l.level}` : l.language)).join(", ")} onChange={(e) => set("languages", parseCsv(e.target.value).map((x) => { const [language, level = ""] = x.split(":"); return { language: language.trim(), level: level.trim() }; }))} />
            </Field>
            <Field label="Short summary (optional)"><textarea className="input h-20" value={p.summary ?? ""} onChange={(e) => set("summary", e.target.value)} /></Field>
          </div>
        </Section>
      </div>

      <EducationSection bundle={data} onChange={reload} />
      <ItemsSection bundle={data} onChange={reload} />
      <div className="flex justify-end"><button className="btn-primary" onClick={save}>Save profile</button></div>
    </div>
  );
}

function EducationSection({ bundle, onChange }: { bundle: ProfileBundle; onChange: () => void }) {
  const add = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const f = Object.fromEntries(new FormData(e.currentTarget)) as Record<string, string>;
    try {
      await api.post("/profile/education", { ...Object.fromEntries(Object.entries(f).filter(([, v]) => v)), status: f.status || "COMPLETED" });
      (e.target as HTMLFormElement).reset();
      onChange();
    } catch (err) {
      toast((err as Error).message, "err");
    }
  };
  return (
    <Section title="Academic history">
      <ul className="mb-3 divide-y divide-slate-100 text-sm">
        {bundle.education.map((e) => (
          <li key={e.id} className="flex items-start justify-between gap-2 py-2">
            <div>
              <p className="font-medium">{e.degree}{e.field && ` in ${e.field}`} — {e.institution} {e.status === "IN_PROGRESS" && <Badge tone="blue">in progress</Badge>}</p>
              <p className="text-xs text-slate-500">{[e.country, [e.startDate, e.endDate].filter(Boolean).join(" – "), e.grade && `Grade: ${e.grade}`, e.thesisTitle && `Thesis: ${e.thesisTitle}`, e.mediumOfInstruction && `Taught in ${e.mediumOfInstruction}`].filter(Boolean).join(" · ")}</p>
            </div>
            <button className="btn-ghost" onClick={async () => { await api.del(`/profile/education/${e.id}`); onChange(); }} aria-label="Delete"><Trash2 size={14} /></button>
          </li>
        ))}
      </ul>
      <form onSubmit={add} className="grid gap-2 sm:grid-cols-4">
        <input className="input" name="degree" required placeholder="Degree (e.g. MSc)" />
        <input className="input" name="field" placeholder="Field" />
        <input className="input sm:col-span-2" name="institution" required placeholder="Institution" />
        <input className="input" name="country" placeholder="Country" />
        <input className="input" name="startDate" placeholder="Start (YYYY)" />
        <input className="input" name="endDate" placeholder="End / expected" />
        <select className="input" name="status"><option value="COMPLETED">Completed</option><option value="IN_PROGRESS">In progress</option></select>
        <input className="input" name="grade" placeholder="Grade / CGPA" />
        <input className="input sm:col-span-2" name="thesisTitle" placeholder="Thesis title" />
        <input className="input" name="mediumOfInstruction" placeholder="Language of instruction" />
        <button className="btn-secondary sm:col-span-4"><Plus size={14} /> Add education</button>
      </form>
    </Section>
  );
}

function ItemsSection({ bundle, onChange }: { bundle: ProfileBundle; onChange: () => void }) {
  const [kind, setKind] = useState("PUBLICATION");
  const add = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const f = Object.fromEntries(new FormData(e.currentTarget)) as Record<string, string>;
    try {
      await api.post("/profile/items", { ...Object.fromEntries(Object.entries(f).filter(([, v]) => v)), kind });
      (e.target as HTMLFormElement).reset();
      onChange();
    } catch (err) {
      toast((err as Error).message, "err");
    }
  };
  return (
    <Section title="Research experience, publications, projects, awards…">
      <Alert tone="blue">Only add real, verifiable items. Generated SOPs and cover letters can only mention items listed here.</Alert>
      {ITEM_KINDS.filter((k) => bundle.items.some((i) => i.kind === k)).map((k) => (
        <div key={k} className="mt-3">
          <h3 className="mb-1">{human(k)}</h3>
          <ul className="divide-y divide-slate-100 text-sm">
            {bundle.items.filter((i) => i.kind === k).map((i) => (
              <li key={i.id} className="flex items-start justify-between gap-2 py-1.5">
                <div>
                  <p className="font-medium">{i.title}</p>
                  <p className="text-xs text-slate-500">{[i.organization, [i.startDate, i.endDate].filter(Boolean).join(" – "), i.description].filter(Boolean).join(" · ")}</p>
                </div>
                <button className="btn-ghost" onClick={async () => { await api.del(`/profile/items/${i.id}`); onChange(); }} aria-label="Delete"><Trash2 size={14} /></button>
              </li>
            ))}
          </ul>
        </div>
      ))}
      <form onSubmit={add} className="mt-4 grid gap-2 sm:grid-cols-4">
        <select className="input" value={kind} onChange={(e) => setKind(e.target.value)}>{ITEM_KINDS.map((k) => <option key={k} value={k}>{human(k)}</option>)}</select>
        <input className="input sm:col-span-3" name="title" required placeholder="Title (paper title, project name, role…)" />
        <input className="input" name="organization" placeholder="Venue / organisation" />
        <input className="input" name="startDate" placeholder="Start" />
        <input className="input" name="endDate" placeholder="End" />
        <input className="input" name="url" placeholder="Link (optional)" />
        <textarea className="input sm:col-span-4" name="description" placeholder="Short description" />
        <button className="btn-secondary sm:col-span-4"><Plus size={14} /> Add item</button>
      </form>
    </Section>
  );
}
