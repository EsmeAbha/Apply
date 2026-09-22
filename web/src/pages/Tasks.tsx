import { Plus, Trash2 } from "lucide-react";
import { useState, type FormEvent } from "react";
import { Link } from "react-router-dom";
import { Badge, Section, Spinner, useLoad } from "../components/ui";
import { api } from "../lib/api";
import { fmtDate } from "../lib/format";
import type { Task } from "../lib/types";

export default function Tasks() {
  const { data, loading, reload } = useLoad(() => api.get<{ items: Task[] }>("/tasks"));
  const [title, setTitle] = useState("");
  const [due, setDue] = useState("");
  if (loading && !data) return <Spinner />;
  const items = data?.items ?? [];
  const today = new Date().toISOString().slice(0, 10);
  const open = items.filter((t) => !t.done);
  const groups: [string, Task[]][] = [
    ["Overdue", open.filter((t) => t.dueDate && t.dueDate.slice(0, 10) < today)],
    ["Today", open.filter((t) => t.dueDate?.slice(0, 10) === today)],
    ["Upcoming", open.filter((t) => t.dueDate && t.dueDate.slice(0, 10) > today)],
    ["No due date", open.filter((t) => !t.dueDate)],
    ["Done", items.filter((t) => t.done)],
  ];
  const add = async (e: FormEvent) => {
    e.preventDefault();
    await api.post("/tasks", { title, dueDate: due || null });
    setTitle("");
    setDue("");
    reload();
  };
  const toggle = async (t: Task) => {
    await api.patch(`/tasks/${t.id}`, { done: !t.done });
    reload();
  };
  return (
    <div className="space-y-5">
      <div>
        <h1>Tasks</h1>
        <p className="text-sm text-slate-500">Automatic tasks are created for missing documents and imminent deadlines. Add your own too.</p>
      </div>
      <form onSubmit={add} className="card flex flex-col gap-2 p-3 sm:flex-row">
        <input className="input flex-1" required placeholder="e.g. Ask Prof. X for a recommendation letter" value={title} onChange={(e) => setTitle(e.target.value)} />
        <input className="input sm:w-44" type="date" value={due} onChange={(e) => setDue(e.target.value)} />
        <button className="btn-primary"><Plus size={14} /> Add task</button>
      </form>
      {groups.map(([label, list]) =>
        list.length ? (
          <Section key={label} title={<span className={label === "Overdue" ? "text-red-700" : ""}>{label} · {list.length}</span>}>
            <ul className="divide-y divide-slate-100">
              {list.map((t) => (
                <li key={t.id} className="flex items-center gap-3 py-2 text-sm">
                  <input type="checkbox" checked={t.done} onChange={() => toggle(t)} />
                  <div className="min-w-0 flex-1">
                    <p className={t.done ? "text-slate-400 line-through" : ""}>{t.title}</p>
                    <p className="text-xs text-slate-500">
                      {t.dueDate && `Due ${fmtDate(t.dueDate)}`} {t.opportunity && <Link className="text-brand-600 hover:underline" to={`/opportunities/${t.opportunity.id}`}>· {t.opportunity.title}</Link>} {t.notes}
                    </p>
                  </div>
                  {t.kind === "AUTO" && <Badge tone="blue">auto</Badge>}
                  <button className="btn-ghost" onClick={async () => { await api.del(`/tasks/${t.id}`); reload(); }} aria-label="Delete"><Trash2 size={14} /></button>
                </li>
              ))}
            </ul>
          </Section>
        ) : null,
      )}
    </div>
  );
}
