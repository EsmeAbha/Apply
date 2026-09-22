import { AlertTriangle, ExternalLink, FileSearch, Info, Loader2, X } from "lucide-react";
import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { englishShort, fmtDateTime, human, upper } from "../lib/format";
import type { Certainty, Evidence, Fact, Urgency } from "../lib/types";

type Tone = "green" | "amber" | "red" | "blue" | "slate" | "purple" | "orange";
const TONES: Record<Tone, string> = {
  green: "bg-emerald-50 text-emerald-800 ring-emerald-200",
  amber: "bg-amber-50 text-amber-800 ring-amber-200",
  orange: "bg-orange-50 text-orange-800 ring-orange-200",
  red: "bg-red-50 text-red-700 ring-red-200",
  blue: "bg-blue-50 text-blue-800 ring-blue-200",
  slate: "bg-slate-100 text-slate-700 ring-slate-200",
  purple: "bg-violet-50 text-violet-800 ring-violet-200",
};

export function Badge({ tone = "slate", children, title }: { tone?: Tone; children: ReactNode; title?: string }) {
  return (
    <span className={`chip ${TONES[tone]}`} title={title}>
      {children}
    </span>
  );
}

export function FundingBadge({ value }: { value: string }) {
  const map: Record<string, [Tone, string]> = {
    FULLY_FUNDED: ["green", "FULLY FUNDED"],
    SALARIED_POSITION: ["green", "SALARIED POSITION"],
    PARTIALLY_FUNDED: ["amber", "PARTIALLY FUNDED"],
    SCHOLARSHIP_AVAILABLE: ["blue", "SCHOLARSHIP AVAILABLE"],
    FUNDING_COMPETITIVE: ["amber", "FUNDING COMPETITIVE"],
    SELF_FUNDED: ["red", "SELF-FUNDED"],
  };
  const [tone, label] = map[value] ?? ["slate", "FUNDING UNKNOWN"];
  return <Badge tone={tone}>{label}</Badge>;
}

export function FeeBadge({ status, label }: { status: string; label: string }) {
  const tone: Tone = status === "FREE" ? "green" : status === "FEE_WAIVER_AVAILABLE" ? "blue" : status === "FEE_REQUIRED" ? "amber" : "slate";
  return <Badge tone={tone}>{status === "FREE" ? "FREE APPLICATION" : `Fee: ${label}`}</Badge>;
}

export function EnglishBadge({ status }: { status: string }) {
  const tone: Tone =
    status === "REQUIRED_LATER" || status === "NOT_REQUIRED" ? "green" : status === "WAIVER_POSSIBLE" ? "blue" : status === "REQUIRED_AT_APPLICATION" ? "amber" : status === "UNKNOWN" ? "slate" : "orange";
  return <Badge tone={tone}>IELTS: {englishShort(status)}</Badge>;
}

export function UrgencyBadge({ urgency, children }: { urgency: Urgency; children?: ReactNode }) {
  const map: Record<Urgency, Tone> = { CRITICAL: "red", URGENT: "orange", SOON: "amber", UPCOMING: "blue", LATER: "slate", CLOSED: "slate", UNKNOWN: "slate" };
  return <Badge tone={map[urgency]}>{children ?? urgency}</Badge>;
}

export function CertaintyBadge({ certainty }: { certainty: Certainty | string }) {
  const map: Record<string, [Tone, string]> = {
    VERIFIED: ["green", "VERIFIED"],
    LIKELY: ["blue", "LIKELY"],
    POSSIBLE: ["amber", "POSSIBLE"],
    CONFLICTING: ["red", "CONFLICTING"],
    USER_ENTERED: ["purple", "ENTERED BY YOU"],
    UNKNOWN: ["slate", "UNKNOWN"],
  };
  const [tone, label] = map[certainty] ?? ["slate", upper(certainty)];
  return <Badge tone={tone}>{label}</Badge>;
}

export function SourceBadge({ sourceType }: { sourceType: string }) {
  if (sourceType === "OFFICIAL_UNIVERSITY") return <Badge tone="green">Official university</Badge>;
  if (sourceType === "INSTITUTIONAL_PORTAL") return <Badge tone="blue">Official recruitment portal</Badge>;
  if (sourceType === "GOVERNMENT") return <Badge tone="green">Government / funder</Badge>;
  if (sourceType === "THIRD_PARTY") return <Badge tone="red">THIRD-PARTY — VERIFY WITH UNIVERSITY</Badge>;
  if (sourceType === "USER_ENTERED") return <Badge tone="purple">Entered by you</Badge>;
  return <Badge tone="amber">Unrecognised source — verify</Badge>;
}

export function StatusBadge({ status }: { status: string }) {
  const map: Record<string, Tone> = { OPEN: "green", OPENING_SOON: "blue", DEADLINE_APPROACHING: "orange", CLOSED: "slate", UNKNOWN: "slate" };
  return <Badge tone={map[status] ?? "slate"}>{upper(status)}</Badge>;
}

/** Popover showing the verbatim source evidence behind a fact. */
export function EvidenceButton({ evidence, certainty, note }: { evidence: Evidence[]; certainty?: string; note?: string }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const h = (e: MouseEvent) => ref.current && !ref.current.contains(e.target as Node) && setOpen(false);
    document.addEventListener("mousedown", h);
    return () => document.removeEventListener("mousedown", h);
  }, [open]);
  if (!evidence?.length && !note) return null;
  return (
    <div className="relative inline-block" ref={ref}>
      <button type="button" className="inline-flex items-center gap-0.5 text-xs text-brand-600 hover:underline" onClick={() => setOpen((o) => !o)}>
        <FileSearch size={13} /> source
      </button>
      {open && (
        <div className="absolute z-30 mt-1 w-[26rem] max-w-[90vw] rounded-lg border border-slate-200 bg-white p-3 text-left text-xs shadow-lg right-0">
          {evidence.map((e, i) => (
            <div key={i} className="mb-2 border-b border-slate-100 pb-2 last:mb-0 last:border-0 last:pb-0">
              <blockquote className="border-l-2 border-brand-100 pl-2 text-slate-700 italic">“{e.snippet}”</blockquote>
              <div className="mt-1.5 flex flex-wrap items-center gap-1.5 text-slate-500">
                <SourceBadge sourceType={e.sourceType} />
                {e.method === "AI_QUOTE_VERIFIED" && <Badge tone="purple">AI · quote verified</Badge>}
                {e.method === "STRUCTURED_DATA" && <Badge tone="slate">Structured data</Badge>}
                <span>Accessed {fmtDateTime(e.accessedAt)}</span>
              </div>
              {e.sourceUrl !== "user" && (
                <a href={e.sourceUrl} target="_blank" rel="noreferrer" className="mt-1 flex items-center gap-1 break-all text-brand-600 hover:underline">
                  <ExternalLink size={11} /> {e.sourceTitle || e.sourceUrl}
                </a>
              )}
            </div>
          ))}
          {certainty && (
            <div className="mt-1 flex items-center gap-1.5 text-slate-500">
              Confidence: <CertaintyBadge certainty={certainty} />
            </div>
          )}
          {note && <p className="mt-1.5 text-slate-600">{note}</p>}
        </div>
      )}
    </div>
  );
}

export function FactValue<T>({ fact, render, unknownText = "UNKNOWN" }: { fact: Fact<T>; render?: (v: T) => ReactNode; unknownText?: string }) {
  if (fact.value === null || fact.value === undefined) {
    return (
      <span className="inline-flex items-center gap-1.5 text-slate-500">
        <span className="font-medium">{unknownText}</span>
        {fact.note && <span className="text-xs">({fact.note})</span>}
      </span>
    );
  }
  return (
    <span className="inline-flex flex-wrap items-center gap-1.5">
      <span className="font-medium text-slate-900">{render ? render(fact.value) : String(fact.value)}</span>
      <CertaintyBadge certainty={fact.certainty} />
      <EvidenceButton evidence={fact.evidence} note={fact.note} />
    </span>
  );
}

export function Spinner({ label }: { label?: string }) {
  return (
    <div className="flex items-center gap-2 p-6 text-sm text-slate-500">
      <Loader2 className="animate-spin" size={16} /> {label ?? "Loading…"}
    </div>
  );
}

export function Empty({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <div className="rounded-xl border border-dashed border-slate-300 bg-white p-8 text-center">
      <p className="font-medium text-slate-700">{title}</p>
      {children && <div className="mt-2 text-sm text-slate-500">{children}</div>}
    </div>
  );
}

export function Alert({ tone = "amber", children, title }: { tone?: "amber" | "red" | "blue" | "green"; children: ReactNode; title?: string }) {
  const cls = { amber: "border-amber-200 bg-amber-50 text-amber-900", red: "border-red-200 bg-red-50 text-red-900", blue: "border-blue-200 bg-blue-50 text-blue-900", green: "border-emerald-200 bg-emerald-50 text-emerald-900" }[tone];
  const Icon = tone === "blue" || tone === "green" ? Info : AlertTriangle;
  return (
    <div className={`flex gap-2 rounded-lg border p-3 text-sm ${cls}`}>
      <Icon size={16} className="mt-0.5 shrink-0" />
      <div>
        {title && <p className="font-semibold">{title}</p>}
        <div>{children}</div>
      </div>
    </div>
  );
}

export function Modal({ open, onClose, title, children, wide }: { open: boolean; onClose: () => void; title: string; children: ReactNode; wide?: boolean }) {
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-slate-900/40 p-4 pt-16" onMouseDown={onClose}>
      <div className={`card w-full ${wide ? "max-w-4xl" : "max-w-lg"} p-5`} onMouseDown={(e) => e.stopPropagation()}>
        <div className="mb-4 flex items-center justify-between">
          <h2>{title}</h2>
          <button className="btn-ghost" onClick={onClose} aria-label="Close">
            <X size={16} />
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}

export function Section({ title, actions, children, className = "" }: { title: ReactNode; actions?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <section className={`card p-4 ${className}`}>
      <div className="mb-3 flex items-center justify-between gap-2">
        <h2 className="text-base">{title}</h2>
        {actions && <div className="flex items-center gap-2">{actions}</div>}
      </div>
      {children}
    </section>
  );
}

/** Minimal data-loading hook with reload. */
export function useLoad<T>(fn: () => Promise<T>, deps: unknown[] = []) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const load = useCallback(fn, deps);
  const reload = useCallback(async () => {
    setLoading(true);
    try {
      setData(await load());
      setError(null);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, [load]);
  useEffect(() => {
    reload();
  }, [reload]);
  return { data, error, loading, reload, setData };
}

let toastListener: ((msg: string, tone: "ok" | "err") => void) | null = null;
export const toast = (msg: string, tone: "ok" | "err" = "ok") => toastListener?.(msg, tone);

export function Toaster() {
  const [items, setItems] = useState<{ id: number; msg: string; tone: "ok" | "err" }[]>([]);
  useEffect(() => {
    toastListener = (msg, tone) => {
      const id = Date.now() + Math.random();
      setItems((x) => [...x, { id, msg, tone }]);
      setTimeout(() => setItems((x) => x.filter((i) => i.id !== id)), tone === "err" ? 7000 : 3500);
    };
    return () => {
      toastListener = null;
    };
  }, []);
  return (
    <div className="fixed right-4 bottom-4 z-[60] flex w-96 max-w-[90vw] flex-col gap-2">
      {items.map((t) => (
        <div key={t.id} className={`rounded-lg px-4 py-2.5 text-sm shadow-lg ${t.tone === "err" ? "bg-red-700 text-white" : "bg-slate-900 text-white"}`}>
          {t.msg}
        </div>
      ))}
    </div>
  );
}

export function Field({ label, children, hint }: { label: string; children: ReactNode; hint?: string }) {
  return (
    <label className="block">
      <span className="label">{label}</span>
      {children}
      {hint && <span className="mt-0.5 block text-xs text-slate-500">{hint}</span>}
    </label>
  );
}

export { human };
