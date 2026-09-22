import { useState } from "react";
import { OpportunityCard } from "../components/opportunity";
import { Empty, Spinner, useLoad } from "../components/ui";
import { api } from "../lib/api";
import type { OpportunitySummary } from "../lib/types";

export default function Shortlist() {
  const [includeClosed, setIncludeClosed] = useState(false);
  const [archived, setArchived] = useState(false);
  const { data, loading, reload } = useLoad(
    () => api.get<{ items: OpportunitySummary[] }>(`/opportunities?saved=true&sort=deadline${includeClosed ? "&includeClosed=true" : ""}${archived ? "&includeArchived=true" : ""}`),
    [includeClosed, archived],
  );
  const items = (data?.items ?? []).filter((o) => (archived ? o.archived : !o.archived));
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1>Shortlist</h1>
          <p className="text-sm text-slate-500">Saved opportunities, soonest deadline first. Deadlines are monitored and you are notified 30/14/7/3/1 days before.</p>
        </div>
        <div className="flex gap-4 text-sm text-slate-600">
          <label className="flex items-center gap-1.5"><input type="checkbox" checked={includeClosed} onChange={(e) => setIncludeClosed(e.target.checked)} /> Include closed</label>
          <label className="flex items-center gap-1.5"><input type="checkbox" checked={archived} onChange={(e) => setArchived(e.target.checked)} /> Show archived</label>
        </div>
      </div>
      {loading && !data ? <Spinner /> : !items.length ? <Empty title="Nothing saved yet">Save opportunities from Discover or with the browser extension.</Empty> : (
        <div className="grid gap-4 lg:grid-cols-2">
          {items.map((o) => <OpportunityCard key={o.id} o={o} onChange={reload} />)}
        </div>
      )}
    </div>
  );
}
