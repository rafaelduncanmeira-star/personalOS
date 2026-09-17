"use client";

import { Suspense, useState } from "react";
import { useSearchParams } from "next/navigation";
import { createBrowserClient } from "@supabase/ssr";
import { SUPABASE_PUBLISHABLE_KEY, SUPABASE_URL } from "@/lib/supabase-config";

function LoginForm() {
  const sp = useSearchParams();
  const [email, setEmail] = useState("");
  const [state, setState] = useState<"idle" | "sending" | "sent" | "error">("idle");
  const [msg, setMsg] = useState(sp.get("erro") ? `Não foi possível entrar (${sp.get("erro")}). Peça um novo link.` : "");

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setState("sending");
    const supabase = createBrowserClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY);
    const { error } = await supabase.auth.signInWithOtp({
      email: email.trim().toLowerCase(),
      options: { emailRedirectTo: `${location.origin}/auth/callback`, shouldCreateUser: true },
    });
    if (error) { setState("error"); setMsg(error.message); } else setState("sent");
  }

  return (
    <form onSubmit={submit} className="card w-full max-w-sm p-8">
      <div className="mb-1 text-2xl font-black">Geri Hub</div>
      <p className="mb-6 text-[13.5px] text-ink-2">Você recebe um link de acesso por e-mail. Só endereços cadastrados pela gestão entram.</p>
      <label className="eyebrow mb-2 block" htmlFor="email">E-mail</label>
      <input id="email" type="email" required value={email} onChange={(e) => setEmail(e.target.value)}
        className="mb-4 w-full rounded-lg border border-line-strong bg-surface-2 px-3 py-2.5 text-ink outline-none focus:border-brand" placeholder="voce@gericlass.com.br" />
      <button className="btn btn-brand w-full" type="submit" disabled={state === "sent" || state === "sending"}>
        {state === "sent" ? "Link enviado" : state === "sending" ? "Enviando…" : "Enviar link"}
      </button>
      {(state === "error" || (state === "idle" && msg)) && <p className="mt-3 text-[13px] text-bad">{msg}</p>}
      {state === "sent" && <p className="mt-3 text-[13px] text-accent">Confira sua caixa de entrada e abra o link neste mesmo navegador.</p>}
    </form>
  );
}

export default function Login() {
  return (
    <div className="grid min-h-screen w-full place-items-center p-6">
      <Suspense><LoginForm /></Suspense>
    </div>
  );
}
