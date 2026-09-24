import { useEffect, useState, type FormEvent } from "react";
import { createRoot } from "react-dom/client";
import { apiCall, getSettings, saveSettings, type Settings } from "./lib/client";

interface Fact<T> { value: T | null; certainty: string; evidence: { snippet: string }[]; note?: string }
interface Extraction {
  url: string; sourceType: string; warnings: string[];
  title: Fact<string>; university: Fact<string>; country: Fact<string>; applyUrl: Fact<string>;
  deadlines: { kind: string; date: string | null; certainty: string; time?: string; timezone?: string }[];
  funding: { category: Fact<string>; stipend: Fact<{ amount: number; currency: string; period?: string }>; tuition: Fact<string> };
  fee: { status: Fact<string>; amount: Fact<{ amount: number; currency: string }>; waiver: Fact<string> };
  english: { summary: string; status: Fact<string> };
  documents: { key: string; label: string; necessity: string }[];
  supervisors: { name: string }[];
}
interface Analysis { extraction: Extraction; existingId: string | null; match: { researchAlignment: { level: string } } }

const h = (s?: string | null) => (s ? s.replace(/_/g, " ") : "UNKNOWN");

function Login({ settings, onDone }: { settings: Settings; onDone: () => void }) {
  const [server, setServer] = useState(settings.serverUrl);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setErr(null);
    try {
      await saveSettings({ serverUrl: server.replace(/\/$/, "") });
      const r = await apiCall<{ token: string }>("/auth/login", { body: { email, password, client: "extension" } });
      await saveSettings({ token: r.token, email });
      onDone();
    } catch (x) {
      setErr((x as Error).message);
    }
  };
  return (
    <form onSubmit={submit} className="stack">
      <p className="muted">Sign in to your PhD Assistant server.</p>
      <label>Server URL<input value={server} onChange={(e) => setServer(e.target.value)} /></label>
      <label>Email<input type="email" required value={email} onChange={(e) => setEmail(e.target.value)} /></label>
      <label>Password<input type="password" required value={password} onChange={(e) => setPassword(e.target.value)} /></label>
      {err && <p className="err">{err}</p>}
      <button className="primary">Sign in</button>
    </form>
  );
}

function Result({ a, onSave, settings }: { a: Analysis; onSave: () => void; settings: Settings }) {
  const ex = a.extraction;
  const app = ex.deadlines.filter((d) => d.kind === "APPLICATION");
  const fund = ex.deadlines.filter((d) => d.kind === "FUNDING" || d.kind === "SCHOLARSHIP");
  const stip = ex.funding.stipend.value;
  const cert = (c: string) => <span className={`cert ${c}`}>{c === "USER_ENTERED" ? "YOU" : c}</span>;
  return (
    <div className="stack">
      {ex.warnings.slice(0, 3).map((w) => <p key={w} className={w.startsWith("THIRD") ? "err" : "warn"}>{w}</p>)}
      <dl>
        <dt>University</dt><dd>{ex.university.value ?? "UNKNOWN"} · {ex.country.value ?? "?"}</dd>
        <dt>Program / position</dt><dd>{ex.title.value ?? "UNKNOWN"}</dd>
        <dt>Deadline</dt><dd>{app.length ? app.map((d, i) => <span key={i}>{d.date} {d.time ?? ""} {d.timezone ?? ""} {cert(d.certainty)} </span>) : "UNKNOWN"}</dd>
        {fund.length > 0 && (<><dt>Funding deadline</dt><dd>{fund.map((d, i) => <span key={i}>{d.date} {cert(d.certainty)} </span>)}</dd></>)}
        <dt>Funding</dt><dd>{h(ex.funding.category.value ?? "FUNDING_UNKNOWN")} {ex.funding.category.value && cert(ex.funding.category.certainty)}{stip && <div>Stipend: {stip.currency} {stip.amount.toLocaleString()}{stip.period === "MONTH" ? "/month" : stip.period === "YEAR" ? "/year" : ""}</div>}<div>Tuition: {h(ex.funding.tuition.value)}</div></dd>
        <dt>Application fee</dt><dd>{ex.fee.status.value === "FREE" ? "FREE" : ex.fee.amount.value ? `${ex.fee.amount.value.currency} ${ex.fee.amount.value.amount}` : ex.fee.status.value ? "Fee (amount not stated)" : "UNKNOWN"}{ex.fee.waiver.value === "AVAILABLE" ? " · waiver available" : ""}</dd>
        <dt>IELTS</dt><dd>{ex.english.summary}</dd>
        <dt>Documents</dt><dd>{ex.documents.filter((d) => d.necessity === "REQUIRED").map((d) => d.label).join(", ") || "UNKNOWN"}</dd>
        {ex.supervisors.length > 0 && (<><dt>Supervisor</dt><dd>{ex.supervisors.map((s) => s.name).join(", ")}</dd></>)}
        {ex.applyUrl.value && (<><dt>Application URL</dt><dd className="break">{ex.applyUrl.value}</dd></>)}
        <dt>Source</dt><dd>{h(ex.sourceType)}</dd>
        <dt>Research alignment</dt><dd>{a.match.researchAlignment.level}</dd>
      </dl>
      <div className="row">
        <button className="primary" onClick={onSave}>{a.existingId ? "SAVE / CHECK FOR CHANGES" : "SAVE OPPORTUNITY"}</button>
        {a.existingId && <button onClick={() => chrome.tabs.create({ url: `${settings.serverUrl}/opportunities/${a.existingId}` })}>Open</button>}
      </div>
    </div>
  );
}

function Main({ settings, onLogout }: { settings: Settings; onLogout: () => void }) {
  const [tab, setTab] = useState<chrome.tabs.Tab | null>(null);
  const [manual, setManual] = useState("");
  const [country, setCountry] = useState("");
  const [area, setArea] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const [analysis, setAnalysis] = useState<Analysis | null>(null);
  const [lastInput, setLastInput] = useState<{ url: string; html?: string } | null>(null);

  useEffect(() => {
    chrome.tabs.query({ active: true, currentWindow: true }).then(([t]) => setTab(t ?? null));
  }, []);

  const run = async (label: string, fn: () => Promise<void>) => {
    setBusy(label);
    setErr(null);
    setInfo(null);
    try {
      await fn();
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(null);
    }
  };

  const analyzeThis = () =>
    run("Analysing…", async () => {
      if (!tab?.id || !tab.url?.startsWith("http")) throw new Error("Open a university web page first.");
      const [res] = await chrome.scripting.executeScript({ target: { tabId: tab.id }, func: () => document.documentElement.outerHTML });
      const html = res?.result as string;
      setLastInput({ url: tab.url, html });
      setAnalysis(await apiCall<Analysis>("/analyze-url", { body: { url: tab.url, html } }));
    });

  const analyzeManual = (e: FormEvent) => {
    e.preventDefault();
    run("Fetching & analysing…", async () => {
      setLastInput({ url: manual });
      setAnalysis(await apiCall<Analysis>("/analyze-url", { body: { url: manual } }));
    });
  };

  const searchFree = () => {
    const query = ["PhD", "doctoral", area.trim(), country.trim(), "fully funded university position"].filter(Boolean).join(" ");
    chrome.tabs.create({ url: `https://www.google.com/search?q=${encodeURIComponent(query)}` });
  };

  const collectSearchResults = (openNext = false) =>
    run("Collecting search results…", async () => {
      if (!tab?.id || !tab.url || !/^https:\/\/(www\.)?google\./i.test(tab.url)) throw new Error("Open a Google results page first.");
      const [res] = await chrome.scripting.executeScript({
        target: { tabId: tab.id },
        func: () => {
          const seen = new Set<string>();
          const links = [...document.querySelectorAll<HTMLAnchorElement>("a[href]")]
            .map((a) => ({ url: a.href, title: (a.innerText || a.getAttribute("aria-label") || "").trim() }))
            .filter((x) => /^https?:\/\//i.test(x.url) && !/google\./i.test(new URL(x.url).hostname) && x.title.length > 0)
            .filter((x) => { const key = new URL(x.url).toString(); if (seen.has(key)) return false; seen.add(key); return true; })
            .slice(0, 20);
          const next = [...document.querySelectorAll<HTMLAnchorElement>("a[href]")]
            .find((a) => /^(next|more results)$/i.test(a.getAttribute("aria-label") ?? a.textContent?.trim() ?? ""))?.href ?? null;
          return { links, next };
        },
      });
      const result = res?.result as { links: { url: string; title: string }[]; next: string | null } | undefined;
      const links = result?.links ?? [];
      if (!links.length) throw new Error("No external results found on this page.");
      await apiCall<{ job: { id: string } }>("/crawl", { body: { urls: links.map((x) => x.url), maxPerSeed: 1 } });
      if (openNext && result?.next) {
        await chrome.tabs.update(tab.id!, { url: result.next });
        setInfo(`Sent ${links.length} results. The next Google results page is opening; reopen the extension there.`);
      } else {
        setInfo(`Sent ${links.length} search results for analysis. Open the dashboard and review the discovered opportunities.`);
        chrome.tabs.create({ url: `${settings.serverUrl}/discover` });
      }
    });

  const save = () =>
    run("Saving…", async () => {
      if (!lastInput) return;
      const r = await apiCall<{ opportunity: { id: string }; created: boolean; changesDetected: unknown[] }>("/opportunities", { body: lastInput.html ? lastInput : { extraction: analysis!.extraction } });
      setInfo(r.created ? "Saved to your dashboard." : r.changesDetected.length ? `Already saved — ${r.changesDetected.length} change(s) detected for your review.` : "Already saved — no changes.");
      setAnalysis({ ...analysis!, existingId: r.opportunity.id });
    });

  const assistForm = () =>
    run("Scanning form…", async () => {
      if (!tab?.id) throw new Error("No active tab");
      const { values } = await apiCall<{ values: Record<string, string | null> }>("/profile/form-values");
      const siteKey = tab.url ? new URL(tab.url).hostname : "";
      if (siteKey) {
        const memory = await apiCall<{ items: { fieldKey: string; value: string }[] }>(`/form-answers?siteKey=${encodeURIComponent(siteKey)}`);
        for (const answer of memory.items) values[answer.fieldKey] = answer.value;
      }
      await chrome.scripting.executeScript({ target: { tabId: tab.id }, files: ["formAssist.js"] });
      await chrome.tabs.sendMessage(tab.id, { type: "PHD_FORM_ASSIST", values });
      setInfo("Form review panel opened on the page. Sensitive fields are highlighted red and never filled.");
    });

  return (
    <div className="stack">
      <div className="tabinfo" title={tab?.url}>{tab?.title ?? "…"}</div>
      <div className="row">
        <button className="primary grow" disabled={!!busy} onClick={analyzeThis}>Analyze this opportunity</button>
        <button disabled={!!busy} onClick={assistForm} title="Suggest values for application-form fields">Assist form</button>
      </div>
      <form onSubmit={analyzeManual} className="row">
        <input className="grow" type="url" placeholder="…or paste an official URL" value={manual} onChange={(e) => setManual(e.target.value)} required />
        <button disabled={!!busy}>Go</button>
      </form>
      <section className="free-search">
        <b>Free discovery</b>
        <p className="muted">Search Google by country, then collect the result links for analysis. No paid search API.</p>
        <div className="row">
          <input className="grow" placeholder="Country" value={country} onChange={(e) => setCountry(e.target.value)} />
          <input className="grow" placeholder="Subject (optional)" value={area} onChange={(e) => setArea(e.target.value)} />
        </div>
        <div className="row">
          <button className="primary grow" disabled={!country.trim() || !!busy} onClick={searchFree}>Search Google</button>
          <button className="grow" disabled={!!busy} onClick={() => collectSearchResults(false)}>Collect this page</button>
          <button className="grow" disabled={!!busy} onClick={() => collectSearchResults(true)}>Collect + next page</button>
        </div>
      </section>
      {busy && <p className="muted">{busy}</p>}
      {err && <p className="err">{err}</p>}
      {info && <p className="ok">{info}</p>}
      {analysis && <Result a={analysis} settings={settings} onSave={save} />}
      <div className="row footer">
        <button onClick={() => chrome.tabs.create({ url: settings.serverUrl })}>Open dashboard</button>
        <span className="muted grow">{settings.email}</span>
        <button onClick={async () => { await saveSettings({ token: null }); onLogout(); }}>Sign out</button>
      </div>
    </div>
  );
}

function App() {
  const [settings, setSettings] = useState<Settings | null>(null);
  const reload = () => getSettings().then(setSettings);
  useEffect(() => {
    reload();
  }, []);
  if (!settings) return null;
  return (
    <div className="wrap">
      <header><img src="icons/icon32.png" alt="" width={20} height={20} /> PhD Assistant</header>
      {settings.token ? <Main settings={settings} onLogout={reload} /> : <Login settings={settings} onDone={reload} />}
      <p className="fine">Never submits applications, sends emails or pays fees. Facts are shown with their source certainty.</p>
    </div>
  );
}

createRoot(document.getElementById("root")!).render(<App />);
