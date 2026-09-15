import postgres from "postgres";

// Conexão direta ao Postgres (Supabase pooler em produção, Postgres local em dev).
// O app roda só no servidor (server components) e faz a checagem de papel na aplicação;
// as policies de RLS no schema `hub` continuam valendo para acessos via PostgREST.
const url = process.env.DATABASE_URL;
if (!url) throw new Error("DATABASE_URL não definida");

declare global {
  var __hubSql: ReturnType<typeof postgres> | undefined;
}

export const sql =
  globalThis.__hubSql ??
  postgres(url, {
    max: 5,
    idle_timeout: 20,
    prepare: false, // compatível com o pooler do Supabase em modo transaction
    connection: { TimeZone: "America/Sao_Paulo" },
    types: {
      numeric: { to: 1700, from: [1700], serialize: (x: number) => String(x), parse: parseFloat },
      int8: { to: 20, from: [20], serialize: (x: number) => String(x), parse: parseInt },
    },
  });

if (process.env.NODE_ENV !== "production") globalThis.__hubSql = sql;
