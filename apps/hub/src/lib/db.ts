import postgres from "postgres";

// Conexão direta ao Postgres (Supabase pooler em produção, Postgres local em dev).
// O app roda só no servidor (server components) e faz a checagem de papel na aplicação;
// as policies de RLS no schema `hub` continuam valendo para acessos via PostgREST.
// A conexão é criada de forma preguiçosa para o build não depender de DATABASE_URL.

type Sql = ReturnType<typeof postgres>;

declare global {
  var __hubSql: Sql | undefined;
}

function connect(): Sql {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL não definida. Configure a variável de ambiente (pooler do Supabase em produção).");
  const client = postgres(url, {
    max: 5,
    idle_timeout: 20,
    prepare: false, // compatível com o pooler do Supabase em modo transaction
    connection: { TimeZone: "America/Sao_Paulo" },
    types: {
      numeric: { to: 1700, from: [1700], serialize: (x: number) => String(x), parse: parseFloat },
      int8: { to: 20, from: [20], serialize: (x: number) => String(x), parse: parseInt },
    },
  });
  if (process.env.NODE_ENV !== "production") globalThis.__hubSql = client;
  return client;
}

function getSql(): Sql {
  return globalThis.__hubSql ?? connect();
}

/** Tagged template: sql`select ...`. Tipos genéricos iguais aos do `postgres`. */
export const sql = new Proxy(function () {} as unknown as Sql, {
  apply(_t, _this, args: unknown[]) {
    return (getSql() as unknown as (...a: unknown[]) => unknown)(...args);
  },
  get(_t, prop) {
    return (getSql() as unknown as Record<string | symbol, unknown>)[prop];
  },
}) as Sql;
