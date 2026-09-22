import { useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import { apiCall, getSettings, saveSettings, type Settings } from "./lib/client";

function Options() {
  const [s, setS] = useState<Settings | null>(null);
  const [server, setServer] = useState("");
  const [status, setStatus] = useState<string | null>(null);
  useEffect(() => {
    getSettings().then((x) => {
      setS(x);
      setServer(x.serverUrl);
    });
  }, []);
  if (!s) return null;
  const save = async () => {
    await saveSettings({ serverUrl: server.replace(/\/$/, "") });
    try {
      await apiCall<{ ok: boolean }>("/health");
      setStatus("Saved. Server reachable.");
    } catch (e) {
      setStatus(`Saved, but the server is not reachable: ${(e as Error).message}`);
    }
  };
  return (
    <div className="wrap stack" style={{ width: 520 }}>
      <header><img src="icons/icon32.png" alt="" width={20} height={20} /> PhD Assistant — Options</header>
      <label>Server URL (where the PhD Assistant API runs)<input value={server} onChange={(e) => setServer(e.target.value)} /></label>
      <div className="row"><button className="primary" onClick={save}>Save</button>{status && <span className="muted">{status}</span>}</div>
      <p className="muted">Signed in as: {s.email ?? "not signed in"} (sign in from the toolbar popup).</p>
      <p className="muted">Permissions: the extension only reads a page when you click “Analyze this opportunity” or “Assist form” (activeTab). It stores your session token in extension storage, never your password.</p>
      <button onClick={async () => { await saveSettings({ token: null, email: null }); setS({ ...s, token: null, email: null }); }}>Sign out</button>
    </div>
  );
}

createRoot(document.getElementById("root")!).render(<Options />);
