import { Download, FilePlus2, Lock, ScanSearch, Trash2, Upload } from "lucide-react";
import { useState, type FormEvent } from "react";
import { Alert, Badge, Empty, Field, Modal, Section, Spinner, toast, useLoad } from "../components/ui";
import { api, download } from "../lib/api";
import { fmtDateTime, human } from "../lib/format";
import type { VaultDocument } from "../lib/types";

interface Proposal { kind: string; title: string; organization?: string; dates?: string; description?: string; sourceLine: string }

export default function Documents() {
  const { data, loading, reload } = useLoad(() => api.get<{ items: VaultDocument[]; types: string[] }>("/documents"));
  const [uploadFor, setUploadFor] = useState<VaultDocument | "new" | null>(null);
  const [proposals, setProposals] = useState<{ versionId: string; docId: string; items: Proposal[]; selected: Set<number> } | null>(null);

  if (loading && !data) return <Spinner />;
  const docs = data?.items ?? [];
  const types = data?.types ?? [];

  const analyze = async (docId: string, versionId: string) => {
    try {
      const r = await api.post<{ proposals: Proposal[] }>("/analyze-document", { versionId });
      setProposals({ versionId, docId, items: r.proposals, selected: new Set(r.proposals.map((_, i) => i)) });
    } catch (e) {
      toast((e as Error).message, "err");
    }
  };
  const importSelected = async () => {
    if (!proposals) return;
    const chosen = proposals.items.filter((_, i) => proposals.selected.has(i));
    const r = await api.post<{ imported: number }>("/profile/import", { proposals: chosen, sourceDocumentId: proposals.docId });
    toast(`${r.imported} item(s) added to your verified profile`);
    setProposals(null);
  };

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1>Document vault</h1>
          <p className="flex items-center gap-1.5 text-sm text-slate-500"><Lock size={13} /> Files are encrypted at rest (AES-256-GCM). New uploads create new versions — originals are never overwritten.</p>
        </div>
        <button className="btn-primary" onClick={() => setUploadFor("new")}><Upload size={15} /> Upload document</button>
      </div>

      {!docs.length ? (
        <Empty title="Your vault is empty">Upload your CV, transcripts, degree certificates, passport, master SOP, recommendation letters and English-medium certificate.</Empty>
      ) : (
        types.filter((t) => docs.some((d) => d.type === t)).map((t) => (
          <Section key={t} title={human(t)}>
            <div className="space-y-3">
              {docs.filter((d) => d.type === t).map((d) => (
                <div key={d.id} className="rounded-lg border border-slate-200 p-3">
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <div>
                      <p className="font-medium">{d.name} {d.sensitive && <Badge tone="purple"><Lock size={10} /> sensitive</Badge>} <Badge tone={d.status === "READY" ? "green" : "slate"}>{d.status}</Badge></p>
                      <p className="text-xs text-slate-500">
                        {[d.language && `Language: ${d.language}`, d.relevantProgram && `For: ${d.relevantProgram}`, d.documentDate && `Date: ${d.documentDate}`, d.notes].filter(Boolean).join(" · ") || "No metadata"}
                      </p>
                    </div>
                    <div className="flex gap-1.5">
                      <select className="rounded border border-slate-200 px-1 py-0.5 text-xs" value={d.status} onChange={async (e) => { await api.patch(`/documents/${d.id}`, { status: e.target.value }); reload(); }}>
                        {["DRAFT", "READY", "NEEDS_UPDATE", "ARCHIVED"].map((s) => <option key={s}>{s}</option>)}
                      </select>
                      <button className="btn-secondary" onClick={() => setUploadFor(d)}><FilePlus2 size={14} /> New version</button>
                      <button className="btn-ghost" onClick={async () => { if (confirm(`Delete “${d.name}” and all its versions?`)) { await api.del(`/documents/${d.id}`); reload(); } }} aria-label="Delete"><Trash2 size={14} /></button>
                    </div>
                  </div>
                  <table className="mt-2 w-full text-xs">
                    <tbody className="divide-y divide-slate-100">
                      {d.versions.map((v) => (
                        <tr key={v.id}>
                          <td className="py-1 font-mono font-medium">{v.label}</td>
                          <td className="py-1 text-slate-500">{v.originalName}</td>
                          <td className="py-1 text-slate-500">{(v.sizeBytes / 1024).toFixed(0)} KB</td>
                          <td className="py-1 text-slate-500">{fmtDateTime(v.createdAt)}</td>
                          <td className="py-1 text-right">
                            {(d.type === "CV" || d.type === "PUBLICATION") && <button className="btn-ghost text-xs" onClick={() => analyze(d.id, v.id)}><ScanSearch size={13} /> Analyse</button>}
                            <button className="btn-ghost text-xs" onClick={() => download(`/documents/versions/${v.id}/download`, v.originalName).catch((e) => toast(e.message, "err"))}><Download size={13} /></button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ))}
            </div>
          </Section>
        ))
      )}

      <UploadModal target={uploadFor} types={types} onClose={() => setUploadFor(null)} onDone={() => { setUploadFor(null); reload(); }} />

      <Modal open={!!proposals} onClose={() => setProposals(null)} title="Profile entries found in your CV" wide>
        {proposals && (
          <div className="space-y-3">
            <Alert tone="blue">These were extracted from your document. Tick only what is correct — nothing is added until you import it. Nothing is invented: each item quotes your CV.</Alert>
            <div className="max-h-[55vh] overflow-y-auto">
              <table className="w-full text-sm">
                <tbody className="divide-y divide-slate-100">
                  {proposals.items.map((p, i) => (
                    <tr key={i} className="align-top">
                      <td className="py-1.5 pr-2"><input type="checkbox" checked={proposals.selected.has(i)} onChange={(e) => { const s = new Set(proposals.selected); if (e.target.checked) s.add(i); else s.delete(i); setProposals({ ...proposals, selected: s }); }} /></td>
                      <td className="py-1.5 pr-2"><Badge>{human(p.kind)}</Badge></td>
                      <td className="py-1.5">
                        <p className="font-medium">{p.title}</p>
                        {(p.organization || p.dates) && <p className="text-xs text-slate-500">{[p.organization, p.dates].filter(Boolean).join(" · ")}</p>}
                        <p className="text-xs text-slate-400 italic">“{p.sourceLine}”</p>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="flex justify-end gap-2">
              <button className="btn-secondary" onClick={() => setProposals(null)}>Cancel</button>
              <button className="btn-primary" disabled={!proposals.selected.size} onClick={importSelected}>Import {proposals.selected.size} selected</button>
            </div>
          </div>
        )}
      </Modal>
    </div>
  );
}

function UploadModal({ target, types, onClose, onDone }: { target: VaultDocument | "new" | null; types: string[]; onClose: () => void; onDone: () => void }) {
  const [busy, setBusy] = useState(false);
  if (!target) return null;
  const isNew = target === "new";
  const submit = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    for (const [k, v] of [...fd.entries()]) if (v === "") fd.delete(k);
    setBusy(true);
    try {
      const r = await api.post<{ version: { label: string } }>(isNew ? "/documents" : `/documents/${target.id}/versions`, fd);
      toast(`Uploaded as ${r.version.label}`);
      onDone();
    } catch (err) {
      toast((err as Error).message, "err");
    } finally {
      setBusy(false);
    }
  };
  return (
    <Modal open onClose={onClose} title={isNew ? "Upload document" : `New version of “${target.name}”`}>
      <form onSubmit={submit} className="space-y-3">
        <Field label="File (PDF, DOCX, TXT, PNG/JPG — max 25 MB)"><input className="input" type="file" name="file" required accept=".pdf,.docx,.doc,.txt,.md,.png,.jpg,.jpeg,.webp" /></Field>
        {isNew && (
          <>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Type">
                <select className="input" name="type" defaultValue="CV">{types.map((t) => <option key={t} value={t}>{human(t)}</option>)}</select>
              </Field>
              <Field label="Name"><input className="input" name="name" placeholder="e.g. Master's transcript" /></Field>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Language"><input className="input" name="language" placeholder="English" /></Field>
              <Field label="Document date"><input className="input" name="documentDate" placeholder="2025-07" /></Field>
            </div>
            <Field label="Relevant degree / programme"><input className="input" name="relevantProgram" placeholder="MSc Intelligent Systems" /></Field>
          </>
        )}
        <Field label="Version label prefix (optional)" hint="e.g. CV_PhD_NLP → saved as CV_PhD_NLP_v2"><input className="input" name="labelPrefix" /></Field>
        <Field label="Notes"><input className="input" name="notes" /></Field>
        <div className="flex justify-end gap-2">
          <button type="button" className="btn-secondary" onClick={onClose}>Cancel</button>
          <button className="btn-primary" disabled={busy}>{busy ? "Encrypting & uploading…" : "Upload"}</button>
        </div>
      </form>
    </Modal>
  );
}
