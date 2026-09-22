import { Bookmark, BookmarkCheck, ExternalLink, FileText, Mail, PenLine, Play } from "lucide-react";
import type { ReactNode } from "react";
import { Link, useNavigate } from "react-router-dom";
import { api } from "../lib/api";
import { daysLabel, englishShort, feeLabel, fmtDate, human, upper } from "../lib/format";
import type { Extraction, MatchAnalysis, OpportunitySummary } from "../lib/types";
import { Badge, CertaintyBadge, EnglishBadge, EvidenceButton, FactValue, FeeBadge, FundingBadge, SourceBadge, StatusBadge, toast, UrgencyBadge } from "./ui";

export function OpportunityCard({ o, onChange }: { o: OpportunitySummary; onChange?: () => void }) {
  const nav = useNavigate();
  const toggleSave = async () => {
    await api.patch(`/opportunities/${o.id}`, { shortlisted: !o.shortlisted });
    toast(o.shortlisted ? "Removed from shortlist" : "Added to shortlist");
    onChange?.();
  };
  const start = async () => {
    try {
      const r = await api.post<{ application: { id: string } }>("/applications", { opportunityId: o.id });
      nav(`/applications/${r.application.id}`);
    } catch (e) {
      toast((e as Error).message, "err");
    }
  };
  const docsReady = o.requiredDocuments.length;
  return (
    <article className="card flex flex-col gap-3 p-4">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-xs font-medium tracking-wide text-slate-500 uppercase">
            {o.universityName ?? "University unknown"} · {o.country ?? "Country unknown"}
          </p>
          <Link to={`/opportunities/${o.id}`} className="mt-0.5 block font-semibold text-slate-900 hover:text-brand-700">
            {o.title}
          </Link>
          {o.researchAreas.length > 0 && <p className="mt-1 truncate text-xs text-slate-500">{o.researchAreas.slice(0, 5).join(" · ")}</p>}
        </div>
        <div className="flex shrink-0 flex-col items-end gap-1">
          <StatusBadge status={o.status} />
          {o.isDemo && <Badge tone="purple">DEMO DATA</Badge>}
        </div>
      </div>

      <div className="flex flex-wrap gap-1.5">
        <FundingBadge value={o.fundingCategory} />
        <FeeBadge status={o.feeStatus} label={feeLabel(o)} />
        <EnglishBadge status={o.englishStatus} />
        {o.researchAlignment && o.researchAlignment !== "UNKNOWN" && <Badge tone={o.researchAlignment === "HIGH" ? "green" : o.researchAlignment === "MEDIUM" ? "blue" : "slate"}>Alignment: {o.researchAlignment}</Badge>}
        {o.conflictCount > 0 && <Badge tone="red">CONFLICTING INFO</Badge>}
        {!!o.pendingChanges && <Badge tone="red">CHANGE DETECTED</Badge>}
      </div>

      <dl className="grid grid-cols-2 gap-x-4 gap-y-1.5 text-sm sm:grid-cols-3">
        <Item label="Deadline">
          {o.primaryDeadline ? fmtDate(o.primaryDeadline) : o.rolling ? "Rolling" : "UNKNOWN"}{" "}
          <UrgencyBadge urgency={o.urgency}>{daysLabel(o.daysRemaining)}</UrgencyBadge>
        </Item>
        <Item label="Tuition">{human(o.tuition === "UNKNOWN" ? null : o.tuition)}</Item>
        <Item label="Stipend / salary">{o.stipend ?? o.salary ?? "UNKNOWN"}</Item>
        <Item label="Documents">{docsReady ? `${docsReady} required` : "Not found — verify"}</Item>
        <Item label="Source">
          <SourceBadge sourceType={o.sourceType} />
        </Item>
        <Item label="Verification">
          <CertaintyBadge certainty={o.verificationStatus === "VERIFIED" ? "VERIFIED" : o.verificationStatus === "CONFLICTING" ? "CONFLICTING" : "POSSIBLE"} />
        </Item>
      </dl>

      <div className="mt-auto flex flex-wrap gap-1.5 border-t border-slate-100 pt-3">
        <Link to={`/opportunities/${o.id}`} className="btn-primary">
          View
        </Link>
        <a href={o.officialUrl} target="_blank" rel="noreferrer" className="btn-secondary">
          <ExternalLink size={14} /> Official source
        </a>
        <button className="btn-secondary" onClick={toggleSave}>
          {o.shortlisted ? <BookmarkCheck size={14} /> : <Bookmark size={14} />} {o.shortlisted ? "Saved" : "Save"}
        </button>
        {o.applicationId ? (
          <Link to={`/applications/${o.applicationId}`} className="btn-secondary">
            <Play size={14} /> Application
          </Link>
        ) : (
          <button className="btn-secondary" onClick={start}>
            <Play size={14} /> Start application
          </button>
        )}
        <Link to={`/opportunities/${o.id}#generate`} className="btn-ghost">
          <PenLine size={14} /> SOP
        </Link>
        <Link to={`/opportunities/${o.id}#generate`} className="btn-ghost">
          <FileText size={14} /> Cover letter
        </Link>
      </div>
    </article>
  );
}

function Item({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="min-w-0">
      <dt className="text-xs text-slate-500">{label}</dt>
      <dd className="flex flex-wrap items-center gap-1 text-slate-800">{children}</dd>
    </div>
  );
}

/** Next steps derived only from what is (and is not) known. */
export function nextSteps(ex: Extraction, match?: MatchAnalysis): string[] {
  const s: string[] = [];
  if (ex.sourceType === "THIRD_PARTY") s.push("Find the official university page for this opportunity and analyse that instead.");
  if (ex.positionStatus.value === "CLOSED") s.push("This position appears CLOSED — look for the next call.");
  if (ex.conflicts.length) s.push(`Resolve ${ex.conflicts.length} conflicting fact(s) by checking with the university.`);
  if (!ex.deadlines.some((d) => d.kind === "APPLICATION")) s.push("Find the application deadline (not stated on this page).");
  if (ex.deadlines.some((d) => d.yearInferred || d.ambiguousFormat)) s.push("Confirm the exact deadline date — the year or format is ambiguous on the page.");
  if (!ex.funding.category.value) s.push("Verify funding: the page does not state it explicitly.");
  if (!ex.fee.status.value) s.push("Check whether there is an application fee (not stated).");
  if (["NEEDS_VERIFICATION", "REQUIRED_STAGE_UNCLEAR", null].includes(ex.english.status.value)) s.push("Verify IELTS/English requirements on the graduate admissions page (you can add it as a second source).");
  if (ex.english.status.value === "REQUIRED_AT_APPLICATION") s.push("IELTS/TOEFL is needed AT application — plan your test or ask whether a waiver applies to you.");
  if (ex.supervisorRequired.value) s.push("Contact a potential supervisor before applying (the page requires/recommends it).");
  if (ex.documents.some((d) => d.key === "RESEARCH_PROPOSAL" && d.necessity === "REQUIRED")) s.push("Prepare a research proposal (required).");
  if (!ex.documents.length) s.push("Required documents were not found — check the 'How to apply' page.");
  if (match?.degreeCompatibility.level === "CHECK_REQUIREMENT") s.push("Check the degree requirement against your qualifications.");
  if (!s.length) s.push("Save it, start the application and prepare the documents listed.");
  return s;
}

/** The "can I apply?" answer panel: WHERE / WHAT / DEADLINE / FUNDING / FEE / IELTS / DOCUMENTS / SOURCE / NEXT. */
export function AnswerPanel({ ex, match }: { ex: Extraction; match?: MatchAnalysis }) {
  const appDeadlines = ex.deadlines.filter((d) => d.kind === "APPLICATION");
  const fundingDeadlines = ex.deadlines.filter((d) => d.kind === "FUNDING" || d.kind === "SCHOLARSHIP");
  const otherDeadlines = ex.deadlines.filter((d) => !["APPLICATION", "FUNDING", "SCHOLARSHIP", "OTHER"].includes(d.kind));
  const fee = ex.fee;
  return (
    <div className="grid gap-3 lg:grid-cols-2">
      <Q q="WHERE?">
        <FactValue fact={ex.university} /> <span className="text-slate-400">·</span> <FactValue fact={ex.country} />
        {ex.department.value && <div className="text-sm text-slate-600">{ex.department.value}</div>}
      </Q>
      <Q q="WHAT?">
        <FactValue fact={ex.title} />
        <div className="mt-1 flex flex-wrap gap-1 text-xs">
          {ex.positionType.value && <Badge>{upper(ex.positionType.value)}</Badge>}
          {ex.researchAreas.map((a) => (
            <Badge key={a} tone="blue">
              {a}
            </Badge>
          ))}
        </div>
      </Q>
      <Q q="DEADLINE?">
        <DeadlineList label="Application deadline" items={appDeadlines} empty={ex.rolling.value ? "Rolling admission (no fixed deadline)" : "UNKNOWN — not found on this page"} />
        <DeadlineList label="Funding / scholarship deadline" items={fundingDeadlines} empty="None stated" />
        {otherDeadlines.length > 0 && <DeadlineList label="Other important dates" items={otherDeadlines} empty="" />}
      </Q>
      <Q q="FUNDING?">
        <div className="flex flex-wrap items-center gap-1.5">
          <FundingBadge value={ex.funding.category.value ?? "FUNDING_UNKNOWN"} />
          <CertaintyBadge certainty={ex.funding.category.certainty} />
          <EvidenceButton evidence={ex.funding.category.evidence} note={ex.funding.category.note} />
        </div>
        <dl className="mt-2 grid grid-cols-[8rem_1fr] gap-y-1 text-sm">
          <dt className="text-slate-500">Tuition</dt>
          <dd><FactValue fact={ex.funding.tuition} render={(v) => human(v)} /></dd>
          <dt className="text-slate-500">Stipend</dt>
          <dd><FactValue fact={ex.funding.stipend} render={(v) => `${v.currency} ${v.amount.toLocaleString()}${v.period === "MONTH" ? " / month" : v.period === "YEAR" ? " / year" : ""}`} /></dd>
          {ex.funding.salary.value && (
            <>
              <dt className="text-slate-500">Salary</dt>
              <dd><FactValue fact={ex.funding.salary} /></dd>
            </>
          )}
          <dt className="text-slate-500">Duration</dt>
          <dd><FactValue fact={ex.funding.duration} /></dd>
          {ex.funding.guaranteed.value && (
            <>
              <dt className="text-slate-500">Award type</dt>
              <dd><FactValue fact={ex.funding.guaranteed} render={(v) => human(v)} /></dd>
            </>
          )}
          {ex.funding.benefits.length > 0 && (
            <>
              <dt className="text-slate-500">Also stated</dt>
              <dd className="flex flex-wrap gap-1">
                {ex.funding.benefits.map((b) => (
                  <span key={b.benefit} className="inline-flex items-center gap-1">
                    <Badge tone="green">{b.benefit}</Badge>
                    <EvidenceButton evidence={b.evidence} />
                  </span>
                ))}
              </dd>
            </>
          )}
        </dl>
      </Q>
      <Q q="FEE?">
        {fee.status.value === "FREE" ? (
          <div className="flex flex-wrap items-center gap-1.5">
            <Badge tone="green">FREE APPLICATION</Badge>
            <CertaintyBadge certainty={fee.status.certainty} />
            <EvidenceButton evidence={fee.status.evidence} note={fee.status.note} />
          </div>
        ) : (
          <FactValue fact={fee.amount} render={(v) => `${v.currency} ${v.amount}`} unknownText={fee.status.value === "FEE_REQUIRED" ? "Fee required (amount not stated)" : "UNKNOWN"} />
        )}
        {fee.status.note && fee.status.value === "FREE" && <p className="mt-1 text-xs text-amber-700">{fee.status.note}</p>}
        <div className="mt-1 text-sm">
          Fee waiver: <FactValue fact={fee.waiver} render={(v) => (v === "AVAILABLE" ? "Available" : "Not available")} unknownText="Not stated" />
        </div>
        {fee.waiverEligibility && <p className="mt-1 text-xs text-slate-600">Eligibility: “{fee.waiverEligibility}”</p>}
        {fee.otherMandatoryCosts.length > 0 && (
          <div className="mt-1 text-xs text-slate-600">Other possible costs: {fee.otherMandatoryCosts.map((c) => c.label).join(", ")}</div>
        )}
      </Q>
      <Q q="IELTS / ENGLISH?">
        <p className="font-semibold text-slate-900">{ex.english.summary}</p>
        <div className="mt-1 flex flex-wrap items-center gap-1.5">
          <CertaintyBadge certainty={ex.english.status.certainty} />
          <EvidenceButton evidence={ex.english.status.evidence} note={ex.english.status.note} />
        </div>
        {ex.english.waivers.map((w) => (
          <p key={w.reason} className="mt-1 text-xs text-slate-600">
            Waiver condition: “{w.text}” <EvidenceButton evidence={w.evidence} /> — do not assume you qualify; confirm with the university.
          </p>
        ))}
        {match && <p className="mt-1 text-xs text-slate-600">For you: {match.english.explanation} {match.english.action}</p>}
      </Q>
      <Q q="DOCUMENTS?">
        {ex.documents.length ? (
          <ul className="space-y-1 text-sm">
            {ex.documents.map((d) => (
              <li key={d.key} className="flex flex-wrap items-center gap-1.5">
                <span className={d.necessity === "NOT_REQUIRED" ? "text-slate-400 line-through" : ""}>{d.label}</span>
                <Badge tone={d.necessity === "REQUIRED" ? "blue" : d.necessity === "OPTIONAL" ? "slate" : d.necessity === "NOT_REQUIRED" ? "slate" : "amber"}>{upper(d.necessity)}</Badge>
                {d.count && <span className="text-xs text-slate-500">×{d.count}</span>}
                {d.maxPages && <span className="text-xs text-slate-500">max {d.maxPages} pages</span>}
                {d.maxWords && <span className="text-xs text-slate-500">max {d.maxWords} words</span>}
                {d.format && <span className="text-xs text-slate-500">{d.format}</span>}
                <EvidenceButton evidence={d.evidence} certainty={d.certainty} />
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-sm text-slate-500">UNKNOWN — no document list found on this page.</p>
        )}
      </Q>
      <Q q="SOURCE?">
        <div className="flex flex-wrap items-center gap-1.5">
          <SourceBadge sourceType={ex.sourceType} />
          <a href={ex.url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-sm break-all text-brand-600 hover:underline">
            <ExternalLink size={12} /> {ex.pageTitle || ex.url}
          </a>
        </div>
        <p className="mt-1 text-xs text-slate-500">{ex.sourceTypeReason}. Accessed {new Date(ex.accessedAt).toLocaleString()}.</p>
        {ex.applyUrl.value && (
          <p className="mt-1 text-sm">
            Application link: <a className="text-brand-600 hover:underline break-all" href={ex.applyUrl.value} target="_blank" rel="noreferrer">{ex.applyUrl.value}</a>
          </p>
        )}
        {ex.supervisors.length > 0 && (
          <p className="mt-1 text-sm">
            <Mail size={12} className="mr-1 inline" />
            Named contact: {ex.supervisors.map((s) => `${s.name}${s.email ? ` <${s.email}>` : ""}`).join(", ")}
          </p>
        )}
      </Q>
      <div className="rounded-xl border-2 border-brand-100 bg-brand-50 p-4 lg:col-span-2">
        <p className="text-xs font-bold tracking-wider text-brand-700">WHAT DO I NEED TO DO NEXT?</p>
        <ol className="mt-2 list-decimal space-y-1 pl-5 text-sm text-slate-800">
          {nextSteps(ex, match).map((s) => (
            <li key={s}>{s}</li>
          ))}
        </ol>
      </div>
    </div>
  );
}

function Q({ q, children }: { q: string; children: ReactNode }) {
  return (
    <div className="rounded-xl border border-slate-200 bg-white p-4">
      <p className="mb-1.5 text-xs font-bold tracking-wider text-slate-500">{q}</p>
      {children}
    </div>
  );
}

function DeadlineList({ label, items, empty }: { label: string; items: Extraction["deadlines"]; empty: string }) {
  return (
    <div className="mb-2 last:mb-0">
      <p className="text-xs text-slate-500">{label}</p>
      {items.length === 0 ? (
        <p className="text-sm font-medium text-slate-500">{empty}</p>
      ) : (
        items.map((d, i) => (
          <div key={i} className="flex flex-wrap items-center gap-1.5 text-sm">
            <span className="font-semibold text-slate-900">{d.date ? fmtDate(d.date) : d.dateText}</span>
            {d.time && <span className="text-slate-600">{d.time} {d.timezone ?? ""}</span>}
            {d.round && <Badge>{d.round}</Badge>}
            {d.kind !== "APPLICATION" && d.kind !== "FUNDING" && <Badge>{upper(d.kind)}</Badge>}
            <CertaintyBadge certainty={d.certainty} />
            <EvidenceButton evidence={d.evidence} note={d.note} />
          </div>
        ))
      )}
    </div>
  );
}

export { englishShort };
