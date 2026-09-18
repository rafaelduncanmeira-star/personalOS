// Utilidades comuns às sincronizações do Geri Hub (Supabase Edge Functions · Deno).
// Acesso ao banco por conexão direta (SUPABASE_DB_URL, injetada pela Supabase nas funções):
// o schema `hub` não é exposto pelo PostgREST e o projeto é compartilhado com o GeriTools.
import postgres from "npm:postgres@3";

export const sql = postgres(Deno.env.get("SUPABASE_DB_URL")!, { prepare: false, max: 3, idle_timeout: 5 });

type Row = Record<string, unknown>;

export const env = (k: string, fallback?: string) => {
  const v = Deno.env.get(k) ?? fallback;
  if (v === undefined) throw new Error(`variável ${k} não definida`);
  return v;
};

/** Segredo de integração: variável HUB_* da função ou o Supabase Vault. Prefixo HUB_ obrigatório (projeto compartilhado). */
export async function secret(name: string): Promise<string> {
  if (!name.startsWith("HUB_")) throw new Error(`segredo ${name}: use o prefixo HUB_`);
  const fromEnv = Deno.env.get(name);
  if (fromEnv) return fromEnv;
  const [r] = await sql<{ v: string | null }[]>`select decrypted_secret as v from vault.decrypted_secrets where name = ${name} order by created_at desc limit 1`;
  if (!r?.v) throw new Error(`segredo ${name} não cadastrado (Vault)`);
  return r.v;
}

export const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

/** Janela de sincronização: ?from=YYYY-MM-DD&to=YYYY-MM-DD, senão últimos `days` dias. */
export function window(req: Request, days = 3) {
  const u = new URL(req.url);
  const to = u.searchParams.get("to") ?? new Date().toISOString().slice(0, 10);
  const from = u.searchParams.get("from") ?? new Date(Date.now() - days * 86400_000).toISOString().slice(0, 10);
  return { from, to };
}

/** insert … on conflict (conflict) do update; devolve o id. Valores jsonb podem ir como objeto. */
export async function upsert(table: string, row: Row, conflict: string[]): Promise<{ id: string }> {
  const cols = Object.keys(row);
  const updates = cols.filter((c) => !conflict.includes(c));
  const data = Object.fromEntries(cols.map((c) => [c, prep(row[c])]));
  const [r] = await sql<{ id: string }[]>`
    insert into hub.${sql(table)} ${sql(data, ...cols)}
    on conflict (${sql(conflict)}) do update set ${sql(data, ...updates)}
    returning id`;
  return r;
}
const prep = (v: unknown) => (v !== null && typeof v === "object" && !(v instanceof Date) ? JSON.stringify(v) : v);

export async function insertMany(table: string, rows: Row[]) {
  if (!rows.length) return;
  const cols = Object.keys(rows[0]);
  const data = rows.map((r) => Object.fromEntries(cols.map((c) => [c, prep(r[c])])));
  await sql`insert into hub.${sql(table)} ${sql(data, ...cols)}`;
}

/** Executa `fn` registrando em hub.sync_runs e atualizando hub.integrations. */
export async function withRun(source: string, req: Request, fn: () => Promise<number>) {
  const { from, to } = window(req);
  const [run] = await sql<{ id: string }[]>`insert into hub.sync_runs (source, window_from, window_to) values (${source}, ${from}, ${to}) returning id`;
  try {
    const rows = await fn();
    await sql`update hub.sync_runs set status = 'ok', finished_at = now(), rows_upserted = ${rows} where id = ${run.id}`;
    await sql`update hub.integrations set last_success_at = now(), last_error = null, enabled = true where source = ${source}`;
    return json({ ok: true, source, rows, from, to });
  } catch (e) {
    const msg = errMsg(e);
    await sql`update hub.sync_runs set status = 'error', finished_at = now(), error = ${msg} where id = ${run.id}`;
    await sql`update hub.integrations set last_error = ${msg} where source = ${source}`;
    console.error(source, msg);
    return json({ ok: false, source, error: msg }, 500);
  }
}

export const errMsg = (e: unknown) => (e instanceof Error ? e.message : typeof e === "object" ? JSON.stringify(e) : String(e));

export async function markIntegration(source: string, error: string | null) {
  if (error) await sql`update hub.integrations set last_error = ${error} where source = ${source}`;
  else await sql`update hub.integrations set last_success_at = now(), last_error = null, enabled = true where source = ${source}`;
}

const productCache = new Map<string, string | null>();
/** Produto do hub a partir do id externo numa fonte (hub.product_source_refs). */
export async function productIdFor(source: string, externalId: string | number | null | undefined) {
  if (externalId == null) return null;
  const key = `${source}:${externalId}`;
  if (productCache.has(key)) return productCache.get(key)!;
  const [r] = await sql<{ product_id: string }[]>`select product_id from hub.product_source_refs where source = ${source} and external_id = ${String(externalId)} limit 1`;
  productCache.set(key, r?.product_id ?? null);
  return r?.product_id ?? null;
}

export const normEmail = (e?: string | null) => (e ?? "").trim().toLowerCase() || null;
export const digits = (s?: string | null) => (s ?? "").replace(/\D/g, "") || null;

/** Cliente único por e-mail; devolve o id. Campos vazios não sobrescrevem os existentes. */
export async function upsertCustomer(c: { email?: string | null; name?: string | null; phone?: string | null; document?: string | null; source?: string; external_id?: string | number | null }) {
  const email = normEmail(c.email);
  if (!email) return null;
  const [r] = await sql<{ id: string }[]>`
    insert into hub.customers (email, name, phone, document) values (${email}, ${c.name ?? null}, ${digits(c.phone)}, ${digits(c.document)})
    on conflict (email) do update set
      name = coalesce(excluded.name, hub.customers.name),
      phone = coalesce(excluded.phone, hub.customers.phone),
      document = coalesce(excluded.document, hub.customers.document)
    returning id`;
  if (r && c.source && c.external_id != null) {
    await sql`insert into hub.customer_source_refs (customer_id, source, external_id) values (${r.id}, ${c.source}, ${String(c.external_id)})
      on conflict (source, external_id) do update set customer_id = excluded.customer_id`;
  }
  return r?.id ?? null;
}

export async function fetchJson<T = unknown>(url: string, init: RequestInit = {}): Promise<T> {
  const res = await fetch(url, init);
  if (!res.ok) throw new Error(`${init.method ?? "GET"} ${url} → ${res.status} ${(await res.text()).slice(0, 300)}`);
  return res.json() as Promise<T>;
}

export const round2 = (n: number) => Math.round(n * 100) / 100;
