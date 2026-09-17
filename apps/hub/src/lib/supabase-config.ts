/**
 * Projeto Supabase do hub (schema `hub` dentro do projeto da GeriClass).
 * URL e chave publicável são públicas por natureza (vão para o browser); as variáveis
 * de ambiente, quando existirem, têm precedência. Nenhum segredo aqui.
 */
export const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "https://ogwepzrwmywnubfgndpn.supabase.co";
export const SUPABASE_PUBLISHABLE_KEY =
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? "sb_publishable_BwBpKV4-yCeQhYVuJ52STw_8kBaFr7u";

/** dev = sem login, lê o Postgres de DATABASE_URL; supabase = sessão do usuário via PostgREST */
export const AUTH_MODE: "dev" | "supabase" =
  process.env.HUB_AUTH_MODE === "dev" && process.env.DATABASE_URL ? "dev" : "supabase";
