// Conta Azul (API v2, OAuth 2.0) → hub.cost_entries (contas a pagar por competência)
// O refresh_token vem da autorização inicial (uma vez) e fica no Vault como HUB_CONTAAZUL_REFRESH_TOKEN.
// TODO(V3): rotacionar o refresh_token no Vault quando a Conta Azul devolver um novo.
import { env, fetchJson, round2, secret, sql, upsert, withRun, window } from "../_shared/hub.ts";

type Any = Record<string, any>;
const base = env("HUB_CONTAAZUL_BASE_URL", "https://api-v2.contaazul.com");

async function accessToken() {
  const basic = btoa(`${await secret("HUB_CONTAAZUL_CLIENT_ID")}:${await secret("HUB_CONTAAZUL_CLIENT_SECRET")}`);
  const refresh = await secret("HUB_CONTAAZUL_REFRESH_TOKEN");
  const body = new URLSearchParams({ grant_type: "refresh_token", refresh_token: refresh });
  const r = await fetchJson<{ access_token: string; refresh_token?: string }>("https://auth.contaazul.com/oauth2/token", {
    method: "POST", body, headers: { authorization: `Basic ${basic}`, "content-type": "application/x-www-form-urlencoded" },
  });
  if (r.refresh_token && r.refresh_token !== refresh) {
    await sql`select vault.update_secret((select id from vault.secrets where name = 'HUB_CONTAAZUL_REFRESH_TOKEN' order by created_at desc limit 1), ${r.refresh_token})`;
  }
  return r.access_token;
}

const catCache = new Map<string, string | null>();
async function categoryId(name: string | null) {
  if (!name) return null;
  if (!catCache.has(name)) {
    const [c] = await sql<{ id: string }[]>`select id from hub.cost_categories where lower(name) = lower(${name}) limit 1`;
    catCache.set(name, c?.id ?? null);
  }
  return catCache.get(name)!;
}

Deno.serve((req) =>
  withRun("contaazul", req, async () => {
    const { from, to } = window(req, 45);
    const token = await accessToken();
    const headers = { authorization: `Bearer ${token}`, accept: "application/json" };
    let rows = 0, pagina = 1;
    while (true) {
      const q = new URLSearchParams({ data_competencia_de: from, data_competencia_ate: to, pagina: String(pagina), tamanho_pagina: "100" });
      const res = await fetchJson<{ itens?: Any[]; items?: Any[] } | Any[]>(`${base}/v1/financeiro/eventos-financeiros/contas-a-pagar/buscar?${q}`, { headers });
      const items = Array.isArray(res) ? res : res.itens ?? res.items ?? [];
      for (const it of items) {
        const competence = String(it.data_competencia ?? it.data_vencimento ?? from).slice(0, 7) + "-01";
        await upsert("cost_entries", {
          source: "contaazul", external_id: String(it.id), category_id: await categoryId(it.categoria?.nome ?? it.categoria_nome ?? null),
          description: it.descricao ?? it.observacao ?? "Conta a pagar", amount: round2(Number(it.valor_total ?? it.valor ?? 0)),
          competence_month: competence, paid_at: it.data_pagamento ?? null, vendor: it.fornecedor?.nome ?? it.pessoa?.nome ?? null, raw: it,
        }, ["source", "external_id"]);
        rows++;
      }
      if (items.length < 100) break;
      pagina++;
    }
    return rows;
  }));
