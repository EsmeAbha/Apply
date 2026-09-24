import { ExternalLink, Globe, Loader2, Plus, Radar, Save, Search, Trash2 } from "lucide-react";
import { useEffect, useState, type FormEvent } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { AnswerPanel, OpportunityCard } from "../components/opportunity";
import { Alert, Badge, Empty, Section, Spinner, toast, useLoad } from "../components/ui";
import { api } from "../lib/api";
import { fmtDateTime } from "../lib/format";
import type { Extraction, MatchAnalysis, OpportunitySummary } from "../lib/types";

interface AnalyzeResponse { ok: boolean; extraction: Extraction; existingId: string | null; match: MatchAnalysis; ai?: { accepted: string[]; rejected: string[] } }

export default function Discover() {
  return (
    <div className="space-y-5">
      <div>
        <h1>Discover</h1>
        <p className="text-sm text-slate-500">Go from “I found this PhD” to “I know whether I can apply” — every fact is linked to its source.</p>
      </div>
      <Analyzer />
      <Browser />
      <Crawler />
    </div>
  );
}

function Analyzer() {
  const [url, setUrl] = useState("");
  const [html, setHtml] = useState("");
  const [showHtml, setShowHtml] = useState(false);
  const [useAI, setUseAI] = useState(false);
  const [aiEnabled, setAiEnabled] = useState(false);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<AnalyzeResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const nav = useNavigate();

  useEffect(() => {
    api.get<{ ai: { enabled: boolean } }>("/settings/status").then((s) => setAiEnabled(s.ai.enabled)).catch(() => undefined);
  }, []);

  const analyze = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    setResult(null);
    try {
      setResult(await api.post<AnalyzeResponse>("/analyze-url", { url, html: showHtml && html ? html : undefined, useAI }));
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const save = async () => {
    if (!result) return;
    try {
      const r = await api.post<{ opportunity: OpportunitySummary; created: boolean; changesDetected: { field: string; old: string; new: string }[] }>("/opportunities", { extraction: result.extraction });
      toast(r.created ? "Opportunity saved" : r.changesDetected.length ? `Already saved — ${r.changesDetected.length} change(s) detected for review` : "Already saved — no changes");
      nav(`/opportunities/${r.opportunity.id}`);
    } catch (err) {
      toast((err as Error).message, "err");
    }
  };

  return (
    <Section title={<span className="flex items-center gap-2"><Search size={16} /> Analyse an opportunity page</span>}>
      <form onSubmit={analyze} className="space-y-2">
        <div className="flex flex-col gap-2 sm:flex-row">
          <input className="input flex-1" type="url" required placeholder="https://www.university.edu/… official PhD vacancy or admissions page" value={url} onChange={(e) => setUrl(e.target.value)} />
          <button className="btn-primary" disabled={busy}>
            {busy ? <Loader2 size={15} className="animate-spin" /> : <Search size={15} />} Analyse
          </button>
        </div>
        <div className="flex flex-wrap items-center gap-4 text-xs text-slate-600">
          <label className="flex items-center gap-1.5">
            <input type="checkbox" checked={showHtml} onChange={(e) => setShowHtml(e.target.checked)} /> Paste the page source myself (for pages that block automated access)
          </label>
          <label className={`flex items-center gap-1.5 ${aiEnabled ? "" : "opacity-50"}`} title={aiEnabled ? "" : "Configure an AI provider in server/.env to enable"}>
            <input type="checkbox" disabled={!aiEnabled} checked={useAI} onChange={(e) => setUseAI(e.target.checked)} /> Also use AI for fields the rules miss (quotes are verified on the page)
          </label>
        </div>
        {showHtml && <textarea className="input h-32 font-mono text-xs" placeholder="Paste the page HTML (View source → Select all → Copy)" value={html} onChange={(e) => setHtml(e.target.value)} />}
      </form>
      {error && <div className="mt-3"><Alert tone="red" title="Analysis failed">{error} No data was invented. Try the browser extension on this page, or paste the page source.</Alert></div>}
      {result && (
        <div className="mt-4 space-y-3">
          {result.extraction.warnings.map((w) => (
            <Alert key={w} tone={w.startsWith("THIRD-PARTY") ? "red" : "amber"}>{w}</Alert>
          ))}
          {result.ai && (
            <Alert tone="blue" title="AI assistance">
              Accepted (quote verified): {result.ai.accepted.join(", ") || "none"}. {result.ai.rejected.length > 0 && `Discarded ${result.ai.rejected.length} unverifiable suggestion(s).`}
            </Alert>
          )}
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="text-sm text-slate-600">
              Research alignment: <Badge tone={result.match.researchAlignment.level === "HIGH" ? "green" : result.match.researchAlignment.level === "MEDIUM" ? "blue" : "slate"}>{result.match.researchAlignment.level}</Badge> {result.match.researchAlignment.explanation}
            </p>
            {result.existingId ? (
              <div className="flex gap-2">
                <Link to={`/opportunities/${result.existingId}`} className="btn-secondary">Open saved copy</Link>
                <button className="btn-primary" onClick={save}><Save size={15} /> Save & check for changes</button>
              </div>
            ) : (
              <button className="btn-primary" onClick={save}><Save size={15} /> Save opportunity</button>
            )}
          </div>
          <AnswerPanel ex={result.extraction} match={result.match} />
        </div>
      )}
    </Section>
  );
}

const FILTER_KEYS = ["q", "country", "area", "funding", "fullyFunded", "freeOnly", "fee", "english", "deadlineWithin", "positionType", "supervisorRequired", "discovered", "includeClosed", "verifiedOnly", "sort"];

function Browser() {
  const [params, setParams] = useSearchParams();
  const qs = FILTER_KEYS.filter((k) => params.get(k)).map((k) => `${k}=${encodeURIComponent(params.get(k)!)}`).join("&");
  const { data, loading, reload } = useLoad(() => api.get<{ items: OpportunitySummary[] }>(`/opportunities?${qs}`), [qs]);
  const set = (k: string, v: string | boolean) => {
    const next = new URLSearchParams(params);
    if (v === "" || v === false) next.delete(k);
    else next.set(k, String(v));
    setParams(next, { replace: true });
  };
  const val = (k: string) => params.get(k) ?? "";
  const check = (k: string) => params.get(k) === "true";

  return (
    <Section title="Opportunities" actions={<span className="text-xs text-slate-500">{data?.items.length ?? 0} shown · no ranking of universities — filters only</span>}>
      <div className="mb-4 grid gap-2 md:grid-cols-4 lg:grid-cols-6">
        <input className="input md:col-span-2" placeholder="Search title, university, department…" value={val("q")} onChange={(e) => set("q", e.target.value)} />
        <input className="input" placeholder="Country" value={val("country")} onChange={(e) => set("country", e.target.value)} />
        <input className="input" placeholder="Research area" value={val("area")} onChange={(e) => set("area", e.target.value)} />
        <select className="input" value={val("funding")} onChange={(e) => set("funding", e.target.value)}>
          <option value="">Any funding</option>
          <option value="FULLY_FUNDED">Fully funded</option>
          <option value="SALARIED_POSITION">Salaried position</option>
          <option value="PARTIALLY_FUNDED">Partially funded</option>
          <option value="FUNDING_COMPETITIVE">Competitive funding</option>
          <option value="SCHOLARSHIP_AVAILABLE">Scholarship available</option>
          <option value="FUNDING_UNKNOWN">Funding unknown</option>
        </select>
        <select className="input" value={val("english")} onChange={(e) => set("english", e.target.value)}>
          <option value="">Any IELTS requirement</option>
          <option value="NOT_REQUIRED_INITIALLY">IELTS not required initially</option>
          <option value="WAIVER_POSSIBLE">Waiver possible</option>
          <option value="REQUIRED_AT_APPLICATION">Required at application</option>
          <option value="NEEDS_VERIFICATION">Needs verification</option>
        </select>
        <select className="input" value={val("fee")} onChange={(e) => set("fee", e.target.value)}>
          <option value="">Any application fee</option>
          <option value="FREE">Free applications only</option>
          <option value="WAIVER">Fee waiver available</option>
        </select>
        <select className="input" value={val("deadlineWithin")} onChange={(e) => set("deadlineWithin", e.target.value)}>
          <option value="">Any deadline</option>
          <option value="3">Next 3 days</option>
          <option value="7">Next 7 days</option>
          <option value="14">Next 14 days</option>
          <option value="30">Next 30 days</option>
          <option value="90">Next 90 days</option>
        </select>
        <select className="input" value={val("positionType")} onChange={(e) => set("positionType", e.target.value)}>
          <option value="">Any programme type</option>
          <option value="PHD_POSITION">PhD position</option>
          <option value="PHD_PROGRAM">PhD programme</option>
          <option value="SCHOLARSHIP">PhD scholarship / studentship</option>
          <option value="FELLOWSHIP">Fellowship</option>
        </select>
        <select className="input" value={val("supervisorRequired")} onChange={(e) => set("supervisorRequired", e.target.value)}>
          <option value="">Supervisor contact: any</option>
          <option value="YES">Supervisor required</option>
          <option value="NO">Supervisor not required</option>
          <option value="UNKNOWN">Not stated</option>
        </select>
        <select className="input" value={val("sort")} onChange={(e) => set("sort", e.target.value)}>
          <option value="">Sort: deadline</option>
          <option value="newest">Sort: newest</option>
          <option value="funding">Sort: funding</option>
          <option value="cost">Sort: application cost</option>
          <option value="alignment">Sort: research alignment</option>
        </select>
        <div className="flex flex-wrap items-center gap-3 text-xs text-slate-600 md:col-span-4 lg:col-span-6">
          {[
            ["fullyFunded", "Fully funded only"],
            ["freeOnly", "FREE applications only"],
            ["verifiedOnly", "Verified only"],
            ["discovered", "Newly discovered (not saved)"],
            ["includeClosed", "Include closed"],
          ].map(([k, l]) => (
            <label key={k} className="flex items-center gap-1.5">
              <input type="checkbox" checked={check(k)} onChange={(e) => set(k, e.target.checked)} /> {l}
            </label>
          ))}
          {qs && <button className="text-brand-600 hover:underline" onClick={() => setParams(new URLSearchParams(), { replace: true })}>Clear filters</button>}
        </div>
      </div>
      {loading && !data ? (
        <Spinner />
      ) : !data?.items.length ? (
        <Empty title="No opportunities match">Analyse an official page above, use the extension, or run discovery below.</Empty>
      ) : (
        <div className="grid gap-4 lg:grid-cols-2">
          {data.items.map((o) => (
            <OpportunityCard key={o.id} o={o} onChange={reload} />
          ))}
        </div>
      )}
    </Section>
  );
}

interface Seed { id: string; url: string; label: string | null; enabled: boolean; lastCrawledAt: string | null; lastStatus: string | null }
interface Job {
  id: string;
  status: string;
  pagesFetched: number;
  candidates: number;
  found: {
    id: string;
    title: string;
    url: string;
    isNew: boolean;
    alignment: string;
    university: string | null;
    country: string | null;
    funding: string;
    deadline: string;
    fee: string;
    english: string;
    documents: number;
    applyUrl: string | null;
  }[];
  leads: { url: string; title: string; reason: string }[];
  errors: { url: string; reason: string }[];
}
interface SearchCriteria { area: string; country: string; funding: string; programme: string; deadline: string }

function buildSearchQuery(criteria: SearchCriteria): string {
  const terms = ["PhD", "doctoral"];
  if (criteria.area.trim()) terms.push(criteria.area.trim());
  if (criteria.country.trim()) terms.push(criteria.country.trim());
  if (criteria.funding) terms.push(criteria.funding);
  if (criteria.programme) terms.push(criteria.programme);
  if (criteria.deadline) terms.push(criteria.deadline);
  terms.push("application");
  return terms.join(" ");
}

function Crawler() {
  const seeds = useLoad(() => api.get<{ items: Seed[] }>("/seeds"));
  const strategies = useLoad(() => api.get<{ items: { strategy: string; label: string; url: string }[] }>("/discovery/strategies"));
  const status = useLoad(() => api.get<{ search: { enabled: boolean } }>("/settings/status"));
  const [url, setUrl] = useState("");
  const [label, setLabel] = useState("");
  const [criteria, setCriteria] = useState<SearchCriteria>({ area: "", country: "", funding: "", programme: "", deadline: "" });
  const [job, setJob] = useState<Job | null>(null);

  useEffect(() => {
    if (!job || job.status !== "RUNNING") return;
    const id = setInterval(async () => {
      const r = await api.get<{ job: Job }>(`/crawl/${job.id}`);
      setJob(r.job);
      if (r.job.status !== "RUNNING") seeds.reload();
    }, 1500);
    return () => clearInterval(id);
  }, [job, seeds.reload]);

  const addSeed = async (e: FormEvent) => {
    e.preventDefault();
    try {
      await api.post("/seeds", { url, label: label || undefined });
      setUrl("");
      setLabel("");
      seeds.reload();
    } catch (err) {
      toast((err as Error).message, "err");
    }
  };
  const run = async (body: object) => {
    const r = await api.post<{ job: Job }>("/crawl", body);
    setJob(r.job);
    toast("Discovery started — pages are fetched politely (robots.txt + rate limits), this can take a few minutes.");
  };

  return (
    <div className="grid gap-5 lg:grid-cols-2">
      <Section title={<span className="flex items-center gap-2"><Radar size={16} /> Automated discovery</span>}>
        <p className="mb-3 text-sm text-slate-600">
          Add official vacancy listing pages or RSS feeds (e.g. a department's “open positions” page). The crawler follows PhD-related links on the same site, respects robots.txt and rate limits, and re-runs daily.
        </p>
        <form onSubmit={addSeed} className="mb-3 flex flex-col gap-2 sm:flex-row">
          <input className="input flex-1" type="url" required placeholder="https://…/jobs or /phd-positions or RSS feed" value={url} onChange={(e) => setUrl(e.target.value)} />
          <input className="input sm:w-40" placeholder="Label (optional)" value={label} onChange={(e) => setLabel(e.target.value)} />
          <button className="btn-secondary"><Plus size={15} /> Add</button>
        </form>
        {seeds.data?.items.length ? (
          <ul className="mb-3 divide-y divide-slate-100 text-sm">
            {seeds.data.items.map((s) => (
              <li key={s.id} className="flex items-center justify-between gap-2 py-1.5">
                <div className="min-w-0">
                  <a href={s.url} target="_blank" rel="noreferrer" className="block truncate text-brand-600 hover:underline">{s.label || s.url}</a>
                  <p className="text-xs text-slate-500">Last run: {fmtDateTime(s.lastCrawledAt)} {s.lastStatus && `· ${s.lastStatus}`}</p>
                </div>
                <div className="flex shrink-0 items-center gap-1">
                  <label className="flex items-center gap-1 text-xs"><input type="checkbox" checked={s.enabled} onChange={async (e) => { await api.patch(`/seeds/${s.id}`, { enabled: e.target.checked }); seeds.reload(); }} /> on</label>
                  <button className="btn-ghost" onClick={async () => { await api.del(`/seeds/${s.id}`); seeds.reload(); }} aria-label="Remove seed"><Trash2 size={14} /></button>
                </div>
              </li>
            ))}
          </ul>
        ) : (
          <p className="mb-3 text-xs text-slate-500">No seed pages yet.</p>
        )}
        <div className="flex flex-wrap gap-2">
          <button className="btn-primary" disabled={!seeds.data?.items.some((s) => s.enabled) || job?.status === "RUNNING"} onClick={() => run({})}>
            <Radar size={15} /> Run discovery now
          </button>
          {status.data?.search.enabled ? (
            <form className="basis-full space-y-2 rounded-lg border border-slate-200 bg-white p-3" onSubmit={(e) => { e.preventDefault(); run({ query: buildSearchQuery(criteria) }); }}>
              <p className="text-sm font-medium">Find opportunities for me</p>
              <p className="text-xs text-slate-500">Tell us what you want; the app searches the web and checks official sources before saving results.</p>
              <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-5">
                <input className="input" placeholder="Research area" value={criteria.area} onChange={(e) => setCriteria({ ...criteria, area: e.target.value })} />
                <input className="input" placeholder="Country or region" value={criteria.country} onChange={(e) => setCriteria({ ...criteria, country: e.target.value })} />
                <select className="input" value={criteria.funding} onChange={(e) => setCriteria({ ...criteria, funding: e.target.value })}>
                  <option value="">Any funding</option>
                  <option value="fully funded">Fully funded</option>
                  <option value="funded studentship">Funded studentship</option>
                  <option value="paid PhD position">Paid position</option>
                </select>
                <select className="input" value={criteria.programme} onChange={(e) => setCriteria({ ...criteria, programme: e.target.value })}>
                  <option value="">Any programme</option>
                  <option value="PhD position">PhD position</option>
                  <option value="PhD scholarship">PhD scholarship</option>
                  <option value="doctoral programme">Doctoral programme</option>
                </select>
                <select className="input" value={criteria.deadline} onChange={(e) => setCriteria({ ...criteria, deadline: e.target.value })}>
                  <option value="">Any deadline</option>
                  <option value="2026 deadline">2026 deadline</option>
                  <option value="2027 deadline">2027 deadline</option>
                  <option value="open now">Open now</option>
                </select>
              </div>
              <button className="btn-primary" disabled={!criteria.area.trim() && !criteria.country.trim() && !criteria.funding && !criteria.programme && !criteria.deadline}>
                <Search size={15} /> Find matching opportunities
              </button>
            </form>
          ) : (
            <Alert tone="blue" title="Automatic search is not configured">
              Add a Brave Search API key as <code>SEARCH_PROVIDER=brave</code> and <code>BRAVE_API_KEY</code> in <code>server/.env</code>, then restart the server. Until then, you can use the extension on any page you open or add an official university jobs page below.
            </Alert>
          )}
        </div>
        {job && (
          <div className="mt-3 rounded-lg bg-slate-50 p-3 text-sm">
            <p className="flex items-center gap-2 font-medium">
              {job.status === "RUNNING" && <Loader2 size={14} className="animate-spin" />} Job {job.status.toLowerCase()} — {job.pagesFetched} pages fetched, {job.candidates} candidates
            </p>
            {job.found.length > 0 && <p className="mt-3 text-xs font-medium text-slate-700">Review results: remove anything irrelevant, then open a result for full requirements.</p>}
            {job.found.map((f) => (
              <div key={f.id} className="mt-2 rounded-lg border border-slate-200 bg-white p-3 text-xs">
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div>
                    <Link className="font-medium text-brand-600 hover:underline" to={`/opportunities/${f.id}`}>{f.title}</Link>
                    <p className="text-slate-500">{f.university ?? "University unknown"} · {f.country ?? "Country unknown"}</p>
                  </div>
                  <button className="btn-ghost" onClick={async () => { await api.del(`/opportunities/${f.id}`); setJob({ ...job, found: job.found.filter((x) => x.id !== f.id) }); }} aria-label={`Remove ${f.title}`}>Remove</button>
                </div>
                <div className="mt-2 grid gap-x-4 gap-y-1 sm:grid-cols-2">
                  <span><b>Funding:</b> {f.funding.replace(/_/g, " ")}</span>
                  <span><b>Deadline:</b> {f.deadline}</span>
                  <span><b>Fee:</b> {f.fee.replace(/_/g, " ")}</span>
                  <span><b>Required documents:</b> {f.documents || "UNKNOWN"}</span>
                  <span className="sm:col-span-2"><b>English:</b> {f.english}</span>
                </div>
                <div className="mt-2 flex flex-wrap items-center gap-2">
                  <Badge tone={f.alignment === "HIGH" ? "green" : f.alignment === "MEDIUM" ? "blue" : "slate"}>alignment {f.alignment}</Badge>
                  {f.isNew && <Badge tone="green">NEW</Badge>}
                  <a className="text-brand-600 hover:underline" href={f.url} target="_blank" rel="noreferrer">Official source</a>
                  {f.applyUrl && <a className="text-brand-600 hover:underline" href={f.applyUrl} target="_blank" rel="noreferrer">Application link</a>}
                  <Link className="text-brand-600 hover:underline" to={`/opportunities/${f.id}`}>Analyze requirements</Link>
                </div>
              </div>
            ))}
            {job.leads.map((l) => (
              <p key={l.url} className="text-xs text-amber-800">Lead: <a className="underline" href={l.url} target="_blank" rel="noreferrer">{l.title || l.url}</a> — {l.reason}</p>
            ))}
            {job.errors.map((er) => (
              <p key={er.url} className="text-xs text-red-700">Crawl failed: {er.url} — {er.reason}</p>
            ))}
          </div>
        )}
      </Section>

      <Section title={<span className="flex items-center gap-2"><Globe size={16} /> Search strategies</span>}>
        <p className="mb-3 text-sm text-slate-600">
          Open these searches in your browser (based on your research interests and preferred countries). When you find an official page, click the extension's <b>Analyze this opportunity</b> or paste the URL above. Third-party listings are for discovery only.
        </p>
        {strategies.loading ? (
          <Spinner />
        ) : (
          <ul className="space-y-1.5 text-sm">
            {strategies.data?.items.map((s) => (
              <li key={s.url} className="flex items-start gap-2">
                <Badge>{s.strategy}</Badge>
                <a className="flex items-center gap-1 text-brand-600 hover:underline" href={s.url} target="_blank" rel="noreferrer">
                  {s.label} <ExternalLink size={11} />
                </a>
              </li>
            ))}
          </ul>
        )}
      </Section>
    </div>
  );
}
