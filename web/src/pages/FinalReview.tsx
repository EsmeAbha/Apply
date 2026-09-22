import { Download, ExternalLink, Pencil, ShieldCheck } from "lucide-react";
import { useState, type ReactNode } from "react";
import { Link, useParams } from "react-router-dom";
import { Alert, Badge, CertaintyBadge, Modal, Spinner, toast, useLoad } from "../components/ui";
import { api, download } from "../lib/api";
import { fmtDate, fmtDateTime, human } from "../lib/format";
import type { AppDetail } from "./ApplicationDetail";

const PHRASE = "I SUBMITTED THIS APPLICATION MYSELF";

export default function FinalReview() {
  const { id } = useParams();
  const { data, loading, reload } = useLoad(() => api.get<AppDetail>(`/applications/${id}`), [id]);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [phrase, setPhrase] = useState("");
  const [reference, setReference] = useState("");
  if (loading && !data) return <Spinner />;
  if (!data) return null;
  const ex = data.extraction;
  const o = data.opportunity;
  const required = data.documents.filter((d) => d.necessity === "REQUIRED" || d.necessity === "UNKNOWN");
  const done = required.filter((d) => d.status === "READY" || d.status === "NOT_REQUIRED");
  const missing = required.filter((d) => !(d.status === "READY" || d.status === "NOT_REQUIRED"));
  const issues: string[] = [
    ...data.checklist.items.filter((i) => !i.done && i.key !== "final").map((i) => `${i.label}: ${i.detail}`),
    ...ex.warnings,
    ...(o.daysRemaining !== null && o.daysRemaining < 0 ? ["The application deadline has passed."] : []),
  ];
  const appDl = ex.deadlines.filter((d) => d.kind === "APPLICATION");
  const portal = data.application.portalUrl ?? ex.applyUrl.value ?? o.officialUrl;

  const confirm = async () => {
    try {
      await api.post(`/applications/${data.application.id}/confirm-submission`, { confirmation: phrase, reference: reference || undefined });
      toast("Submission recorded. Good luck!");
      setConfirmOpen(false);
      reload();
    } catch (e) {
      toast((e as Error).message, "err");
    }
  };

  const Row = ({ label, children }: { label: string; children: ReactNode }) => (
    <div className="grid grid-cols-1 gap-1 border-b border-slate-100 py-2 sm:grid-cols-[13rem_1fr]">
      <dt className="text-sm font-medium text-slate-500">{label}</dt>
      <dd className="text-sm text-slate-900">{children}</dd>
    </div>
  );

  return (
    <div className="mx-auto max-w-4xl space-y-4">
      <div className="card p-6">
        <p className="text-xs font-bold tracking-[0.2em] text-slate-500">FINAL APPLICATION REVIEW</p>
        <h1 className="mt-1">{o.title}</h1>
        <dl className="mt-4">
          <Row label="University">{o.universityName ?? "UNKNOWN"}</Row>
          <Row label="Program">{o.title} {o.department && <span className="text-slate-500">· {o.department}</span>}</Row>
          <Row label="Country">{o.country ?? "UNKNOWN"}</Row>
          <Row label="Official application URL">
            <a className="break-all text-brand-600 hover:underline" href={portal} target="_blank" rel="noreferrer">{portal}</a>
          </Row>
          <Row label="Deadline">
            {appDl.length ? appDl.map((d, i) => (
              <span key={i} className="mr-2 inline-flex items-center gap-1.5">{fmtDate(d.date)} {d.time} {d.timezone} <CertaintyBadge certainty={d.certainty} /></span>
            )) : "UNKNOWN"}
          </Row>
          <Row label="Funding">{human(ex.funding.category.value ?? "FUNDING_UNKNOWN")} <CertaintyBadge certainty={ex.funding.category.certainty} /></Row>
          <Row label="Application fee">{ex.fee.status.value === "FREE" ? "FREE" : ex.fee.amount.value ? `${ex.fee.amount.value.currency} ${ex.fee.amount.value.amount}${ex.fee.waiver.value === "AVAILABLE" ? " (waiver available)" : ""}` : "UNKNOWN"}</Row>
          <Row label="IELTS">{ex.english.summary} <span className="text-xs text-slate-500">· your status: {human(data.ieltsStatus)}</span></Row>
          <Row label="Required documents">{required.map((d) => d.label).join(", ") || "UNKNOWN"}</Row>
          <Row label="Completed documents">{done.length ? done.map((d) => <Badge key={d.id} tone="green">{d.label}</Badge>) : "None"}</Row>
          <Row label="Missing documents">{missing.length ? missing.map((d) => <Badge key={d.id} tone="red">{d.label} ({d.status})</Badge>) : <Badge tone="green">None</Badge>}</Row>
          <Row label="Potential issues">{issues.length ? <ul className="list-disc pl-5">{issues.map((i) => <li key={i}>{i}</li>)}</ul> : "None found"}</Row>
          <Row label="Conflicting information">{ex.conflicts.length ? ex.conflicts.map((c) => <div key={c.field}>{c.label}: {c.values.map((v) => v.value).join(" vs ")}</div>) : "None"}</Row>
          <Row label="Last verified">{fmtDateTime(o.lastVerifiedAt)}</Row>
        </dl>
      </div>

      <div className="card p-6">
        <p className="text-xs font-bold tracking-[0.2em] text-red-700">USER ACTION REQUIRED</p>
        <p className="mt-1 text-sm text-slate-600">
          This assistant never fills declarations, pays fees or clicks a portal's submit button. Submit on the official website yourself, then record it here.
        </p>
        {data.application.submittedAt ? (
          <div className="mt-3"><Alert tone="green" title="Submission recorded">You confirmed submission on {fmtDateTime(data.application.submittedAt)}.</Alert></div>
        ) : !data.checklist.readyForFinalReview ? (
          <div className="mt-3"><Alert>Some checks are incomplete (see Potential issues). You can still proceed, but review them first.</Alert></div>
        ) : null}
        <div className="mt-4 flex flex-wrap gap-2">
          <Link to={`/applications/${data.application.id}`} className="btn-secondary"><Pencil size={14} /> Edit</Link>
          <a href={portal} target="_blank" rel="noreferrer" className="btn-secondary"><ExternalLink size={14} /> Open official website</a>
          <button className="btn-secondary" onClick={() => download(`/applications/${data.application.id}/package`, "package.zip").catch((e) => toast(e.message, "err"))}><Download size={14} /> Download application package</button>
          <button className="btn-primary" disabled={!!data.application.submittedAt} onClick={() => setConfirmOpen(true)}><ShieldCheck size={14} /> Submit application…</button>
        </div>
      </div>

      <Modal open={confirmOpen} onClose={() => setConfirmOpen(false)} title="Record your submission">
        <div className="space-y-3 text-sm">
          <Alert tone="blue">
            Submitting happens on the university's portal: <a className="underline" href={portal} target="_blank" rel="noreferrer">open it</a>. Review every declaration there yourself. Once you have submitted, type the phrase below to record it.
          </Alert>
          <label className="block">
            <span className="label">Type: {PHRASE}</span>
            <input className="input" value={phrase} onChange={(e) => setPhrase(e.target.value)} />
          </label>
          <label className="block">
            <span className="label">Portal confirmation / reference number (optional)</span>
            <input className="input" value={reference} onChange={(e) => setReference(e.target.value)} />
          </label>
          <div className="flex justify-end gap-2">
            <button className="btn-secondary" onClick={() => setConfirmOpen(false)}>Cancel</button>
            <button className="btn-primary" disabled={phrase !== PHRASE} onClick={confirm}>Record submission</button>
          </div>
        </div>
      </Modal>
    </div>
  );
}
