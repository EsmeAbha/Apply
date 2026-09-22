import { GraduationCap } from "lucide-react";
import { useState, type FormEvent } from "react";
import { toast } from "../components/ui";
import { api, setToken } from "../lib/api";

export default function Login() {
  const [mode, setMode] = useState<"login" | "register">("login");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    try {
      const r = await api.post<{ token: string }>(`/auth/${mode}`, { email, password, client: "web" });
      setToken(r.token);
      window.dispatchEvent(new Event("auth-changed"));
    } catch (err) {
      toast((err as Error).message, "err");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex min-h-screen items-center justify-center bg-gradient-to-br from-slate-50 to-brand-50 p-4">
      <div className="card w-full max-w-md p-8">
        <div className="mb-6 flex items-center gap-3">
          <div className="rounded-xl bg-brand-700 p-2 text-white">
            <GraduationCap size={24} />
          </div>
          <div>
            <h1 className="text-xl">PhD Application Intelligence Assistant</h1>
            <p className="text-sm text-slate-500">Find open, funded PhDs — verified from official sources.</p>
          </div>
        </div>
        <form onSubmit={submit} className="space-y-3">
          <label className="block">
            <span className="label">Email</span>
            <input className="input" type="email" autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} required />
          </label>
          <label className="block">
            <span className="label">Password {mode === "register" && "(min. 10 characters)"}</span>
            <input className="input" type="password" autoComplete={mode === "login" ? "current-password" : "new-password"} value={password} onChange={(e) => setPassword(e.target.value)} required minLength={mode === "register" ? 10 : 1} />
          </label>
          <button className="btn-primary w-full py-2" disabled={busy}>
            {mode === "login" ? "Sign in" : "Create account"}
          </button>
        </form>
        <p className="mt-4 text-center text-sm text-slate-600">
          {mode === "login" ? "New here?" : "Already have an account?"}{" "}
          <button className="text-brand-600 hover:underline" onClick={() => setMode(mode === "login" ? "register" : "login")}>
            {mode === "login" ? "Create an account" : "Sign in"}
          </button>
        </p>
        <p className="mt-6 text-xs text-slate-400">Your data stays on your own server. Documents are encrypted at rest. The assistant never submits applications for you.</p>
      </div>
    </div>
  );
}
