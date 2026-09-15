"use client";

import { useState } from "react";
import { createBrowserClient } from "@supabase/ssr";

export default function Login() {
  const [email, setEmail] = useState("");
  const [state, setState] = useState<"idle" | "sent" | "error">("idle");
  const [msg, setMsg] = useState("");

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    const url = process.env.NEXT_PUBLIC_SUPABASE_URL, key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
    if (!url || !key) { setState("error"); setMsg("Supabase Auth não configurado neste ambiente."); return; }
    const supabase = createBrowserClient(url, key);
    const { error } = await supabase.auth.signInWithOtp({ email, options: { emailRedirectTo: `${location.origin}/` } });
    if (error) { setState("error"); setMsg(error.message); } else setState("sent");
  }

  return (
    <div className="grid min-h-screen place-items-center p-6">
      <form onSubmit={submit} className="card w-full max-w-sm p-8">
        <div className="mb-1 text-2xl font-black">Geri Hub</div>
        <p className="mb-6 text-[13.5px] text-ink-2">Você recebe um link de acesso por e-mail. Só endereços cadastrados entram.</p>
        <label className="eyebrow mb-2 block" htmlFor="email">E-mail</label>
        <input id="email" type="email" required value={email} onChange={(e) => setEmail(e.target.value)} className="mb-4 w-full rounded-lg border border-line-strong bg-surface-2 px-3 py-2.5 text-ink outline-none focus:border-brand" placeholder="voce@gericlass.com.br" />
        <button className="btn btn-brand w-full" type="submit" disabled={state === "sent"}>{state === "sent" ? "Link enviado" : "Enviar link"}</button>
        {state === "error" && <p className="mt-3 text-[13px] text-bad">{msg}</p>}
        {state === "sent" && <p className="mt-3 text-[13px] text-accent">Confira sua caixa de entrada.</p>}
      </form>
    </div>
  );
}
