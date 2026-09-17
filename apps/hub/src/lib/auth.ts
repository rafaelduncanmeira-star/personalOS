import { AUTH_MODE } from "./supabase-config";
import { rpcOne } from "./rpc";

export type Role = "admin" | "gestor" | "comercial" | "trafego" | "financeiro" | "leitura";
export type HubUser = { id: string; email: string; name: string; role: Role };

/**
 * Usuário logado no hub.
 * - dev: HUB_DEV_USER (e-mail) sem login, lendo o Postgres de DATABASE_URL.
 * - supabase: sessão do Supabase Auth (magic link) → public.hub_me() liga o e-mail ao cadastro em hub.users.
 */
export async function getCurrentUser(): Promise<HubUser | null> {
  if (AUTH_MODE === "dev") {
    const { sql } = await import("./db");
    const email = process.env.HUB_DEV_USER ?? "rafaelduncanmeira@gmail.com";
    const [u] = await sql<HubUser[]>`select id, email, name, role from hub.users where email = ${email} and active`;
    return u ?? null;
  }
  const { supabaseServer } = await import("./supabase-server");
  const supabase = await supabaseServer();
  const { data } = await supabase.auth.getUser();
  if (!data.user) return null;
  return rpcOne<HubUser>("hub_me");
}

/** E-mail da sessão do Supabase (mesmo sem cadastro no hub); null em modo dev ou sem sessão. */
export async function getSessionEmail(): Promise<string | null> {
  if (AUTH_MODE === "dev") return null;
  const { supabaseServer } = await import("./supabase-server");
  const supabase = await supabaseServer();
  const { data } = await supabase.auth.getUser();
  return data.user?.email ?? null;
}

export const canSeeFinance =(r: Role) => ["admin", "gestor", "financeiro"].includes(r);
export const canSeeSales = (r: Role) => ["admin", "gestor", "financeiro", "comercial", "trafego"].includes(r);
export const canSeeTraffic = (r: Role) => ["admin", "gestor", "financeiro", "trafego"].includes(r);
export const canSeeCommercial = (r: Role) => ["admin", "gestor", "financeiro", "comercial"].includes(r);
