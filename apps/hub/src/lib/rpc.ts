import { AUTH_MODE } from "./supabase-config";

type Params = Record<string, string | number | null | undefined>;

/**
 * Chama uma função `public.hub_*` do banco.
 * - supabase: via PostgREST com a sessão do usuário (RLS por papel, sem segredo no servidor)
 * - dev: via conexão direta ao Postgres (DATABASE_URL), mesma função SQL
 */
export async function rpc<T>(fn: string, params: Params = {}): Promise<T[]> {
  if (AUTH_MODE === "dev") {
    const { sql } = await import("./db");
    const keys = Object.keys(params);
    const args = keys.map((k, i) => `${k} => $${i + 1}`).join(", ");
    const values = keys.map((k) => (params[k] === undefined ? null : params[k]));
    const rows = await sql.unsafe(`select * from public.${fn}(${args})`, values as (string | number | null)[]);
    return rows as unknown as T[];
  }
  const { supabaseServer } = await import("./supabase-server");
  const supabase = await supabaseServer();
  const clean: Params = {};
  for (const [k, v] of Object.entries(params)) clean[k] = v === undefined ? null : v;
  const { data, error } = await supabase.rpc(fn, clean);
  if (error) throw new Error(`${fn}: ${error.message}`);
  return (data ?? []) as T[];
}

export async function rpcOne<T>(fn: string, params: Params = {}): Promise<T | null> {
  const rows = await rpc<T>(fn, params);
  return rows[0] ?? null;
}
