import { cookies } from "next/headers";
import { createServerClient } from "@supabase/ssr";
import { sql } from "./db";

export type Role = "admin" | "gestor" | "comercial" | "trafego" | "financeiro" | "leitura";
export type HubUser = { id: string; email: string; name: string; role: Role };

/**
 * Usuário logado no hub.
 * - HUB_AUTH_MODE=dev: usa HUB_DEV_USER (e-mail) sem login, para desenvolvimento local.
 * - produção: sessão do Supabase Auth (magic link) → e-mail → hub.users (lista de permitidos).
 */
export async function getCurrentUser(): Promise<HubUser | null> {
  if (process.env.HUB_AUTH_MODE === "dev") {
    const email = process.env.HUB_DEV_USER ?? "rafaelduncanmeira@gmail.com";
    const [u] = await sql<HubUser[]>`select id, email, name, role from hub.users where email = ${email} and active`;
    return u ?? null;
  }
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !key) return null;
  const store = await cookies();
  const supabase = createServerClient(url, key, {
    cookies: { getAll: () => store.getAll(), setAll: () => {} },
  });
  const { data } = await supabase.auth.getUser();
  const email = data.user?.email?.toLowerCase();
  if (!email) return null;
  const [u] = await sql<HubUser[]>`select id, email, name, role from hub.users where lower(email) = ${email} and active`;
  if (u && data.user) {
    await sql`update hub.users set auth_user_id = ${data.user.id} where id = ${u.id} and auth_user_id is null`;
  }
  return u ?? null;
}

export const canSeeFinance = (r: Role) => ["admin", "gestor", "financeiro"].includes(r);
export const canSeeSales = (r: Role) => ["admin", "gestor", "financeiro", "comercial", "trafego"].includes(r);
export const canSeeTraffic = (r: Role) => ["admin", "gestor", "financeiro", "trafego"].includes(r);
export const canSeeCommercial = (r: Role) => ["admin", "gestor", "financeiro", "comercial"].includes(r);
