// Utilidades comuns às sincronizações (Supabase Edge Functions · Deno).
import { createClient } from "npm:@supabase/supabase-js@2";

export const db = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  { db: { schema: "hub" }, auth: { persistSession: false } },
);

export const env = (k: string, fallback?: string) => {
  const v = Deno.env.get(k) ?? fallback;
  if (v === undefined) throw new Error(`variável ${k} não definida`);
  return v;
};

export const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

/** Janela de sincronização: ?from=YYYY-MM-DD&to=YYYY-MM-DD, senão últimos `days` dias. */
export function window(req: Request, days = 3) {
  const u = new URL(req.url);
  const to = u.searchParams.get("to") ?? new Date().toISOString().slice(0, 10);
  const from = u.searchParams.get("from") ?? new Date(Date.now() - days * 86400_000).toISOString().slice(0, 10);
  return { from, to };
}

/** Executa `fn` registrando em hub.sync_runs e atualizando hub.integrations. */
export async function withRun(source: string, req: Request, fn: () => Promise<number>) {
  const { from, to } = window(req);
  const { data: run } = await db.from("sync_runs").insert({ source, window_from: from, window_to: to }).select("id").single();
  try {
    const rows = await fn();
    await db.from("sync_runs").update({ status: "ok", finished_at: new Date().toISOString(), rows_upserted: rows }).eq("id", run!.id);
    await db.from("integrations").update({ last_success_at: new Date().toISOString(), last_error: null, enabled: true }).eq("source", source);
    return json({ ok: true, source, rows, from, to });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    await db.from("sync_runs").update({ status: "error", finished_at: new Date().toISOString(), error: msg }).eq("id", run!.id);
    await db.from("integrations").update({ last_error: msg }).eq("source", source);
    console.error(source, msg);
    return json({ ok: false, source, error: msg }, 500);
  }
}

const productCache = new Map<string, string | null>();
/** Produto do hub a partir do id externo numa fonte (hub.product_source_refs). */
export async function productIdFor(source: string, externalId: string | number | null | undefined) {
  if (externalId == null) return null;
  const key = `${source}:${externalId}`;
  if (productCache.has(key)) return productCache.get(key)!;
  const { data } = await db.from("product_source_refs").select("product_id").eq("source", source).eq("external_id", String(externalId)).maybeSingle();
  productCache.set(key, data?.product_id ?? null);
  return data?.product_id ?? null;
}

export const normEmail = (e?: string | null) => (e ?? "").trim().toLowerCase() || null;
export const digits = (s?: string | null) => (s ?? "").replace(/\D/g, "") || null;

/** Cliente único por e-mail; devolve o id. */
export async function upsertCustomer(c: { email?: string | null; name?: string | null; phone?: string | null; document?: string | null; source?: string; external_id?: string | number | null }) {
  const email = normEmail(c.email);
  if (!email) return null;
  const { data } = await db.from("customers")
    .upsert({ email, name: c.name ?? undefined, phone: digits(c.phone) ?? undefined, document: digits(c.document) ?? undefined }, { onConflict: "email", ignoreDuplicates: false })
    .select("id").single();
  if (data && c.source && c.external_id != null) {
    await db.from("customer_source_refs").upsert({ customer_id: data.id, source: c.source, external_id: String(c.external_id) }, { onConflict: "source,external_id" });
  }
  return data?.id ?? null;
}

export async function fetchJson<T = unknown>(url: string, init: RequestInit = {}): Promise<T> {
  const res = await fetch(url, init);
  if (!res.ok) throw new Error(`${init.method ?? "GET"} ${url} → ${res.status} ${(await res.text()).slice(0, 300)}`);
  return res.json() as Promise<T>;
}

export const round2 = (n: number) => Math.round(n * 100) / 100;
export const chunk = <T>(arr: T[], n: number) => Array.from({ length: Math.ceil(arr.length / n) }, (_, i) => arr.slice(i * n, i * n + n));
