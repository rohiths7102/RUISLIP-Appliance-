"use client";
import { Suspense, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Lock } from "lucide-react";

// noindex belt-and-braces (middleware also sets X-Robots-Tag on every admin response)
export const dynamic = "force-dynamic";

function SignInForm() {
  const router = useRouter();
  const params = useSearchParams();
  // Only same-origin paths are honoured (guards against open-redirect); the API
  // re-validates too. Default lands on the admin home.
  const raw = params.get("callbackUrl") || "";
  const callbackUrl = raw.startsWith("/") && !raw.startsWith("//") ? raw : "";

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setErr("");
    setBusy(true);
    try {
      const r = await fetch("/api/auth/login", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, password, callbackUrl }),
      });
      if (r.ok) {
        const j = await r.json().catch(() => ({}));
        router.push(j.redirect || "/admin");
        router.refresh();
        return;
      }
      if (r.status === 429) {
        const j = await r.json().catch(() => ({}));
        const wait = r.headers.get("retry-after");
        setErr(j.error || `Too many attempts. Try again${wait ? ` in ${wait}s` : " shortly"}.`);
      } else {
        setErr("Invalid email or password.");
      }
    } catch {
      setErr("Couldn't reach the server. Please try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="relative flex min-h-screen items-center justify-center bg-navy px-4">
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(80%_60%_at_50%_0%,rgba(63,157,240,.18),transparent_60%)]" />
      <form onSubmit={submit} className="relative w-full max-w-sm rounded-2xl border border-white/10 bg-white p-8 shadow-2xl">
        <div className="mb-5 flex items-center gap-3">
          <span className="flex h-11 w-11 items-center justify-center rounded-lg bg-navy text-sky"><Lock size={18} /></span>
          <div>
            <h1 className="font-display text-xl font-semibold leading-none">Owner sign in</h1>
            <p className="mt-1 font-mono text-[10px] uppercase tracking-[0.16em] text-blue-deep">Euronics Ruislip</p>
          </div>
        </div>

        {err && <div className="mb-4 rounded-lg border border-red-200 bg-red-50 px-3 py-2.5 text-sm text-red-700">{err}</div>}

        <div className="grid gap-3">
          <input required type="email" placeholder="Email" value={email} onChange={(e) => setEmail(e.target.value)}
            autoComplete="username" className="rounded-lg border border-line px-3.5 py-2.5 text-sm outline-none focus:border-blue" />
          <input required type="password" placeholder="Password" value={password} onChange={(e) => setPassword(e.target.value)}
            autoComplete="current-password" className="rounded-lg border border-line px-3.5 py-2.5 text-sm outline-none focus:border-blue" />
          <button disabled={busy}
            className="rounded-full bg-navy px-5 py-3 text-sm font-bold text-paper transition-colors hover:bg-navy-2 disabled:opacity-50">
            {busy ? "Signing in…" : "Sign in"}
          </button>
        </div>

        <p className="mt-5 text-center text-[11px] leading-relaxed text-ink/40">
          Microsoft / Google sign-in replaces this once the design is signed off.
        </p>
      </form>
    </div>
  );
}

export default function SignInPage() {
  return (
    <Suspense fallback={<div className="min-h-screen bg-navy" />}>
      <SignInForm />
    </Suspense>
  );
}
