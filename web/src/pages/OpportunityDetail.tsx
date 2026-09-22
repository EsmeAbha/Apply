import { Archive, Bookmark, BookmarkCheck, Check, ExternalLink, FileText, Loader2, Mail, PenLine, Play, RefreshCw, Trash2, UserSearch, X } from "lucide-react";
import { useEffect, useState, type FormEvent, type ReactNode } from "react";
import { Link, useLocation, useNavigate, useParams } from "react-router-dom";
import { AnswerPanel } from "../components/opportunity";
import { Alert, Badge, CertaintyBadge, EvidenceButton, Field, Modal, Section, SourceBadge, Spinner, StatusBadge, toast, useLoad } from "../components/ui";
import { api } from "../lib/api";
import { fmtDateTime, human } from "../lib/format";
import type { EmailDraft, Generated, MatchAnalysis, OpportunityDetail as Detail } from "../lib/types";

export default function OpportunityDetail() {
  const { id } = useParams();
  const nav = useNavigate();
  const loc = useLocation();
  const { data, loading, error, reload } = useLoad(() => api.get<{ opportunity: Detail; match: MatchAnalysis }>(`/opportunities/${id}`), [id]);
  const [verifying, setVerifying] = useState(false);

  useEffect(() => {
    if (data && loc.hash === "#generate") document.getElementById("generate")?.scrollIntoView({ behavior: "smooth" });
  }, [data, loc.hash]);

  if (loading && !data) return <Spinner />;
  if (error || !data) return <Alert tone="red">{error}</Alert>;
  const o = data.opportunity;
  const ex = o.extraction;
  const pending = o.changes.filter((c) => c.status === "PENDING");

  const verify = async () => {
    setVerifying(true);
    try {
      const r = await api.post<{ ok: boolean; error?: string; changes: unknown[]; unchanged: boolean }>("/verify-opportunity", { id: o.id });
      if (!r.ok) toast(`Crawl failed. Reason: ${r.error}. Stored information was not changed.`, "err");
      else toast(r.unchanged ? "Re-checked: no changes on the official page" : `CHANGE DETECTED: ${r.changes.length} field(s) — review below`);
      reload();
    } finally {
      setVerifying(false);
    }
  };
  const patch = async (body: object, msg: string) => {
    await api.patch(`/opportunities/${o.id}`, body);
    toast(msg);
    reload();
  };
  const start = async () => {
    const r = await api.post<{ application: { id: string } }>("/applications", { opportunityId: o.id });
    nav(`/applications/${r.application.id}`);
  };
  const resolve = async (changeId: string, action: "ACCEPT" | "DISMISS") => {
    try {
      await api.post(`/changes/${changeId}/resolve`, { action });
      toast(action === "ACCEPT" ? "Change applied" : "Change dismissed");
      reload();
    } catch (e) {
      toast((e as Error).message, "err");
    }
  };

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-xs font-medium tracking-wide text-slate-500 uppercase">{o.universityName ?? "University unknown"} · {o.country ?? "Country unknown"}</p>
          <h1 className="mt-0.5">{o.title}</h1>
          <div className="mt-2 flex flex-wrap items-center gap-1.5">
            <StatusBadge status={o.status} />
            <SourceBadge sourceType={o.sourceType} />
            <CertaintyBadge certainty={o.verificationStatus === "VERIFIED" ? "VERIFIED" : o.verificationStatus === "CONFLICTING" ? "CONFLICTING" : "POSSIBLE"} />
            {o.isDemo && <Badge tone="purple">DEMO DATA — fictional</Badge>}
            <span className="text-xs text-slate-500">Last verified {fmtDateTime(o.lastVerifiedAt)}</span>
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          <a href={o.officialUrl} target="_blank" rel="noreferrer" className="btn-secondary"><ExternalLink size={14} /> Official source</a>
          <button className="btn-secondary" onClick={verify} disabled={verifying}>{verifying ? <Loader2 size={14} className="animate-spin" /> : <RefreshCw size={14} />} Re-verify now</button>
          <button className="btn-secondary" onClick={() => patch({ shortlisted: !o.shortlisted }, o.shortlisted ? "Removed from shortlist" : "Saved to shortlist")}>
            {o.shortlisted ? <BookmarkCheck size={14} /> : <Bookmark size={14} />} {o.shortlisted ? "Shortlisted" : "Save"}
          </button>
          {o.applicationId ? (
            <Link to={`/applications/${o.applicationId}`} className="btn-primary"><Play size={14} /> Open application</Link>
          ) : (
            <button className="btn-primary" onClick={start}><Play size={14} /> Start application</button>
          )}
          <button className="btn-ghost" onClick={() => patch({ archived: !o.archived }, o.archived ? "Restored" : "Archived")} title="Archive"><Archive size={14} /></button>
          <button className="btn-ghost" title="Delete" onClick={async () => { if (confirm("Delete this opportunity and its application data?")) { await api.del(`/opportunities/${o.id}`); nav("/discover"); } }}><Trash2 size={14} /></button>
        </div>
      </div>

      {pending.length > 0 && (
        <Section title={<span className="text-red-700">CHANGE DETECTED — review before anything is updated</span>}>
          <ul className="divide-y divide-slate-100">
            {pending.map((c) => (
              <li key={c.id} className="flex flex-wrap items-center justify-between gap-3 py-2 text-sm">
                <div>
                  <p className="font-medium">{c.label}</p>
                  <p>
                    <span className="text-slate-500">Old:</span> <span className="line-through">{c.oldValue}</span> <span className="text-slate-500">→ New:</span> <b>{c.newValue}</b>
                  </p>
                  <p className="text-xs text-slate-500">
                    Source: <a className="text-brand-600 hover:underline" href={c.sourceUrl} target="_blank" rel="noreferrer">{c.sourceUrl}</a> · {fmtDateTime(c.detectedAt)}
                  </p>
                  {c.snippet && <p className="mt-0.5 text-xs text-slate-600 italic">“{c.snippet}”</p>}
                </div>
                <div className="flex gap-2">
                  <button className="btn-primary" onClick={() => resolve(c.id, "ACCEPT")}><Check size={14} /> Accept new value</button>
                  <button className="btn-secondary" onClick={() => resolve(c.id, "DISMISS")}><X size={14} /> Dismiss</button>
                </div>
              </li>
            ))}
          </ul>
        </Section>
      )}

      {ex.conflicts.length > 0 && (
        <Section title={<span className="text-red-700">CONFLICTING INFORMATION — verify manually</span>}>
          {ex.conflicts.map((c) => (
            <div key={c.field} className="mb-3 last:mb-0">
              <p className="text-sm font-medium">{c.label}</p>
              <div className="mt-1 grid gap-2 md:grid-cols-2">
                {c.values.map((v, i) => (
                  <div key={i} className="rounded-lg border border-red-100 bg-red-50/50 p-2 text-sm">
                    <p className="font-semibold">{v.value}</p>
                    {v.evidence[0] && (
                      <>
                        <p className="text-xs text-slate-600 italic">“{v.evidence[0].snippet}”</p>
                        <a className="text-xs break-all text-brand-600 hover:underline" href={v.evidence[0].sourceUrl} target="_blank" rel="noreferrer">{v.evidence[0].sourceTitle || v.evidence[0].sourceUrl}</a>
                      </>
                    )}
                  </div>
                ))}
              </div>
            </div>
          ))}
          <p className="text-xs text-slate-500">Action: VERIFY MANUALLY with the university, then record the confirmed value under “Correct a fact”.</p>
        </Section>
      )}

      {ex.warnings.map((w) => <Alert key={w} tone={w.startsWith("THIRD-PARTY") ? "red" : "amber"}>{w}</Alert>)}

      <AnswerPanel ex={ex} match={data.match} />

      <div className="grid gap-5 lg:grid-cols-2">
        <MatchSection m={data.match} />
        <SourcesSection o={o} onChange={reload} />
      </div>

      <GenerateSection opportunityId={o.id} />
      <SupervisorSection o={o} onChange={reload} />
    </div>
  );
}

function MatchSection({ m }: { m: MatchAnalysis }) {
  const row = (label: string, value: ReactNode, detail?: string) => (
    <div className="grid grid-cols-[11rem_1fr] gap-2 border-b border-slate-100 py-1.5 text-sm last:border-0">
      <span className="text-slate-500">{label}</span>
      <div>
        <div className="font-medium">{value}</div>
        {detail && <p className="text-xs text-slate-500">{detail}</p>}
      </div>
    </div>
  );
  const tone = m.researchAlignment.level === "HIGH" ? "green" : m.researchAlignment.level === "MEDIUM" ? "blue" : "slate";
  return (
    <Section title="Match analysis">
      {row("Research alignment", <Badge tone={tone}>{m.researchAlignment.level}</Badge>, m.researchAlignment.explanation)}
      {row("Degree compatibility", human(m.degreeCompatibility.level), `${m.degreeCompatibility.explanation}${m.degreeCompatibility.requirementQuote ? ` Requirement: “${m.degreeCompatibility.requirementQuote}”` : ""}`)}
      {row("Technical skills", m.technicalSkills.matched.join(", ") || "—", m.technicalSkills.explanation)}
      {row("Publications", m.publicationAlignment.matched.length ? m.publicationAlignment.matched.join("; ") : "—", m.publicationAlignment.explanation)}
      {row("Experience", m.experienceAlignment.matched.length ? m.experienceAlignment.matched.join("; ") : "—", m.experienceAlignment.explanation)}
      {row("English", human(m.english.status), `${m.english.explanation} ${m.english.action}`)}
      {row("Funding", m.funding)}
      {row("Application fee", m.applicationCost)}
      {row("Deadline", m.deadline)}
      <p className="mt-2 text-xs text-slate-500">{m.disclaimer}</p>
    </Section>
  );
}

function SourcesSection({ o, onChange }: { o: Detail; onChange: () => void }) {
  const [url, setUrl] = useState("");
  const [busy, setBusy] = useState(false);
  const [field, setField] = useState("deadline.APPLICATION");
  const [value, setValue] = useState("");
  const [note, setNote] = useState("");
  const add = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    try {
      const r = await api.post<{ filled: string[]; conflicts: { label: string }[] }>(`/opportunities/${o.id}/sources`, { url });
      toast(`Source added. Filled: ${r.filled.join(", ") || "nothing new"}${r.conflicts.length ? ` · ${r.conflicts.length} conflict(s) flagged` : ""}`);
      setUrl("");
      onChange();
    } catch (err) {
      toast((err as Error).message, "err");
    } finally {
      setBusy(false);
    }
  };
  const correct = async (e: FormEvent) => {
    e.preventDefault();
    try {
      await api.patch(`/opportunities/${o.id}`, { field, value, note: note || undefined });
      toast("Saved as “entered by you”");
      setValue("");
      setNote("");
      onChange();
    } catch (err) {
      toast((err as Error).message, "err");
    }
  };
  return (
    <Section title="Sources & verification">
      <ul className="mb-3 space-y-1.5 text-sm">
        {o.sources.map((s) => (
          <li key={s.id} className="flex flex-wrap items-center gap-1.5">
            <SourceBadge sourceType={s.sourceType} />
            <a className="break-all text-brand-600 hover:underline" href={s.url} target="_blank" rel="noreferrer">{s.title || s.url}</a>
            <span className="text-xs text-slate-500">verified {fmtDateTime(s.lastVerifiedAt)}</span>
          </li>
        ))}
      </ul>
      <form onSubmit={add} className="mb-4 flex gap-2">
        <input className="input" type="url" required placeholder="Add another official page (e.g. graduate admissions / English requirements)" value={url} onChange={(e) => setUrl(e.target.value)} />
        <button className="btn-secondary" disabled={busy}>{busy ? <Loader2 size={14} className="animate-spin" /> : "Add"}</button>
      </form>
      <h3 className="mb-2">Correct a fact (after confirming with the university)</h3>
      <form onSubmit={correct} className="grid gap-2 sm:grid-cols-2">
        <select className="input" value={field} onChange={(e) => setField(e.target.value)}>
          <option value="deadline.APPLICATION">Application deadline (YYYY-MM-DD)</option>
          <option value="deadline.FUNDING">Funding deadline (YYYY-MM-DD)</option>
          <option value="funding.category">Funding category</option>
          <option value="fee.status">Application fee status</option>
          <option value="english.status">English requirement</option>
          <option value="applyUrl">Application URL</option>
          <option value="country">Country</option>
          <option value="university">University</option>
        </select>
        {field === "funding.category" ? (
          <select className="input" value={value} onChange={(e) => setValue(e.target.value)} required>
            <option value="">Choose…</option>
            {["FULLY_FUNDED", "PARTIALLY_FUNDED", "SALARIED_POSITION", "SCHOLARSHIP_AVAILABLE", "FUNDING_COMPETITIVE", "SELF_FUNDED"].map((v) => <option key={v} value={v}>{human(v)}</option>)}
          </select>
        ) : field === "fee.status" ? (
          <select className="input" value={value} onChange={(e) => setValue(e.target.value)} required>
            <option value="">Choose…</option>
            <option value="FREE">Free</option>
            <option value="FEE_REQUIRED">Fee required</option>
          </select>
        ) : field === "english.status" ? (
          <select className="input" value={value} onChange={(e) => setValue(e.target.value)} required>
            <option value="">Choose…</option>
            {["REQUIRED_AT_APPLICATION", "REQUIRED_LATER", "NOT_REQUIRED", "WAIVER_POSSIBLE"].map((v) => <option key={v} value={v}>{human(v)}</option>)}
          </select>
        ) : (
          <input className="input" required placeholder={field.startsWith("deadline") ? "2026-12-01" : "Value"} value={value} onChange={(e) => setValue(e.target.value)} />
        )}
        <input className="input sm:col-span-2" placeholder="How you confirmed it (e.g. email from admissions office, 22 Sep)" value={note} onChange={(e) => setNote(e.target.value)} />
        <button className="btn-secondary sm:col-span-2">Save correction</button>
      </form>
    </Section>
  );
}

function GenerateSection({ opportunityId }: { opportunityId: string }) {
  const { data, reload } = useLoad(() => api.get<{ items: Generated[] }>(`/generated?opportunityId=${opportunityId}`), [opportunityId]);
  const status = useLoad(() => api.get<{ ai: { enabled: boolean; provider: string } }>("/settings/status"));
  const [tone, setTone] = useState("ACADEMIC");
  const [useAI, setUseAI] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const nav = useNavigate();
  const gen = async (path: string, label: string) => {
    setBusy(label);
    try {
      const r = await api.post<{ generated: Generated }>(path, { opportunityId, tone, useAI });
      toast(`${label} draft created — review every sentence`);
      nav(`/generated/${r.generated.id}`);
    } catch (e) {
      toast((e as Error).message, "err");
    } finally {
      setBusy(null);
      reload();
    }
  };
  return (
    <Section title={<span id="generate">Tailored documents</span>}>
      <p className="mb-3 text-sm text-slate-600">
        Drafts use only your verified profile, your master documents and facts from the official source. Anything missing is left as a [BRACKETED PLACEHOLDER]; unsupported names or numbers are flagged.
      </p>
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <button className="btn-primary" onClick={() => gen("/generate-sop", "SOP")} disabled={!!busy}><PenLine size={14} /> Generate SOP</button>
        <select className="input w-auto" value={tone} onChange={(e) => setTone(e.target.value)}>
          <option value="ACADEMIC">Academic tone</option>
          <option value="RESEARCH_FOCUSED">Research-focused</option>
          <option value="CONCISE">Concise</option>
          <option value="FORMAL">Formal</option>
        </select>
        <button className="btn-secondary" onClick={() => gen("/generate-cover-letter", "Cover letter")} disabled={!!busy}><FileText size={14} /> Generate cover letter</button>
        <button className="btn-secondary" onClick={() => gen("/generate-research-proposal", "Research proposal")} disabled={!!busy}><FileText size={14} /> Research proposal draft</button>
        <label className={`flex items-center gap-1.5 text-xs ${status.data?.ai.enabled ? "" : "opacity-50"}`}>
          <input type="checkbox" disabled={!status.data?.ai.enabled} checked={useAI} onChange={(e) => setUseAI(e.target.checked)} /> Use AI ({status.data?.ai.enabled ? status.data.ai.provider : "not configured"})
        </label>
        {busy && <Loader2 size={16} className="animate-spin text-slate-500" />}
      </div>
      {data?.items.length ? (
        <ul className="divide-y divide-slate-100 text-sm">
          {data.items.map((g) => (
            <li key={g.id} className="flex items-center justify-between py-1.5">
              <Link to={`/generated/${g.id}`} className="text-brand-600 hover:underline">{g.title}</Link>
              <span className="flex items-center gap-1.5">
                {g.warnings.length > 0 && <Badge tone="amber">{g.warnings.length} to check</Badge>}
                <Badge tone={g.status === "APPROVED" ? "green" : "slate"}>{g.status}</Badge>
              </span>
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-sm text-slate-500">No drafts yet for this opportunity.</p>
      )}
    </Section>
  );
}

function SupervisorSection({ o, onChange }: { o: Detail; onChange: () => void }) {
  const [url, setUrl] = useState("");
  const [busy, setBusy] = useState(false);
  const drafts = useLoad(() => api.get<{ items: EmailDraft[] }>("/email-drafts"), []);
  const [open, setOpen] = useState<EmailDraft | null>(null);
  const discover = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    try {
      const r = await api.post<{ items: unknown[] }>("/supervisors/discover", { url, opportunityId: o.id });
      toast(`${r.items.length} academic(s) found on the official page`);
      onChange();
    } catch (err) {
      toast((err as Error).message, "err");
    } finally {
      setBusy(false);
    }
  };
  const draft = async (purpose: string, supervisorId?: string) => {
    try {
      const r = await api.post<{ draft: EmailDraft }>("/email-drafts", { opportunityId: o.id, supervisorId, purpose });
      setOpen(r.draft);
      drafts.reload();
    } catch (err) {
      toast((err as Error).message, "err");
    }
  };
  const mine = drafts.data?.items.filter((d) => d.opportunity?.id === o.id) ?? [];
  return (
    <Section title={<span className="flex items-center gap-2"><UserSearch size={16} /> Supervisors & contact emails</span>}>
      {o.supervisorRequired === "YES" && <div className="mb-3"><Alert>This opportunity requires or recommends contacting a supervisor before applying.</Alert></div>}
      <form onSubmit={discover} className="mb-3 flex gap-2">
        <input className="input" type="url" required placeholder="Official department staff / people page URL" value={url} onChange={(e) => setUrl(e.target.value)} />
        <button className="btn-secondary" disabled={busy}>{busy ? <Loader2 size={14} className="animate-spin" /> : "Find academics"}</button>
      </form>
      {o.supervisors.length > 0 && (
        <ul className="mb-3 divide-y divide-slate-100 text-sm">
          {o.supervisors.map((s) => (
            <li key={s.id} className="flex flex-wrap items-start justify-between gap-2 py-2">
              <div>
                <p className="font-medium">
                  {s.profileUrl ? <a className="hover:underline" href={s.profileUrl} target="_blank" rel="noreferrer">{s.name}</a> : s.name} {s.title && <span className="text-xs text-slate-500">· {s.title}</span>}
                </p>
                <p className="text-xs text-slate-500">{s.researchAreas.join(", ") || "Research areas not listed"} {s.email && `· ${s.email}`}</p>
                <EvidenceButton evidence={[{ sourceUrl: s.sourceUrl, sourceType: "OFFICIAL_UNIVERSITY", snippet: s.snippet ?? "", accessedAt: new Date().toISOString(), method: "RULE" }]} />
              </div>
              <div className="flex items-center gap-1.5">
                {s.relevance > 0 && <Badge tone="green">{s.relevance} shared interest(s)</Badge>}
                <button className="btn-secondary" onClick={() => draft("INITIAL_CONTACT", s.id)}><Mail size={14} /> Draft email</button>
              </div>
            </li>
          ))}
        </ul>
      )}
      <div className="flex flex-wrap gap-2">
        {["INITIAL_CONTACT", "AVAILABILITY", "FUNDING", "RESEARCH_INTEREST", "FOLLOW_UP", "CLARIFICATION"].map((p) => (
          <button key={p} className="btn-ghost text-xs" onClick={() => draft(p)}>Draft: {human(p)}</button>
        ))}
      </div>
      {mine.length > 0 && (
        <ul className="mt-3 divide-y divide-slate-100 text-sm">
          {mine.map((d) => (
            <li key={d.id} className="flex items-center justify-between py-1.5">
              <button className="text-left text-brand-600 hover:underline" onClick={() => setOpen(d)}>{d.subject}</button>
              <Badge tone={d.status === "MARKED_SENT" ? "green" : "slate"}>{human(d.status)}</Badge>
            </li>
          ))}
        </ul>
      )}
      <EmailModal draft={open} onClose={() => { setOpen(null); drafts.reload(); }} />
    </Section>
  );
}

export function EmailModal({ draft, onClose }: { draft: EmailDraft | null; onClose: () => void }) {
  const [to, setTo] = useState("");
  const [subject, setSubject] = useState("");
  const [body, setBody] = useState("");
  useEffect(() => {
    if (draft) {
      setTo(draft.to ?? "");
      setSubject(draft.subject);
      setBody(draft.body);
    }
  }, [draft]);
  if (!draft) return null;
  const save = async (status?: string) => {
    await api.patch(`/email-drafts/${draft.id}`, { to, subject, body, ...(status ? { status } : {}) });
    toast(status === "MARKED_SENT" ? "Marked as sent by you" : "Draft saved");
  };
  const mailto = `mailto:${encodeURIComponent(to)}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
  return (
    <Modal open={!!draft} onClose={onClose} title="Email draft — you send it, not the app" wide>
      <div className="space-y-2">
        {draft.warnings.length > 0 && (
          <Alert title="Check these before sending">
            {draft.warnings.map((w) => <div key={w.claim}>{w.message}</div>)}
          </Alert>
        )}
        <Field label="To"><input className="input" value={to} onChange={(e) => setTo(e.target.value)} /></Field>
        <Field label="Subject"><input className="input" value={subject} onChange={(e) => setSubject(e.target.value)} /></Field>
        <Field label="Body" hint="Replace every [BRACKETED] placeholder with genuine, specific content.">
          <textarea className="input h-72 font-mono text-xs" value={body} onChange={(e) => setBody(e.target.value)} />
        </Field>
        <div className="flex flex-wrap justify-end gap-2">
          <button className="btn-secondary" onClick={() => { navigator.clipboard.writeText(`${subject}\n\n${body}`); toast("Copied"); }}>Copy</button>
          <button className="btn-secondary" onClick={() => save()}>Save draft</button>
          <a className="btn-secondary" href={mailto} onClick={() => save("APPROVED")}>Open in my email app</a>
          <button className="btn-primary" onClick={async () => { await save("MARKED_SENT"); onClose(); }}>I sent it myself</button>
        </div>
      </div>
    </Modal>
  );
}
