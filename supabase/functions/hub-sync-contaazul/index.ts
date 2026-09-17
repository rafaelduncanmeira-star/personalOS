// Conta Azul (API v2, OAuth 2.0) → hub.cost_entries (contas a pagar por competência)
// Token: o refresh_token vem da autorização inicial (uma vez) e é guardado como segredo da função.
// TODO(V3): rotacionar o refresh_token via Supabase Vault quando a Conta Azul devolver um novo.
import { db, env, fetchJson, round2, withRun, window, secret } from "../_shared/hub.ts";

type Any = Record<string, any>;
const base = env("CONTAAZUL_BASE_URL", "https://api-v2.contaazul.com");

async function accessToken() {
  const basic = btoa(`${(await secret("HUB_CONTAAZUL_CLIENT_ID"))}:${(await secret("HUB_CONTAAZUL_CLIENT_SECRET"))}`);
  const body = new URLSearchParams({ grant_type: "refresh_token", refresh_token: (await secret("HUB_CONTAAZUL_REFRESH_TOKEN")) });
  const r = await fetchJson<{ access_token: string; refresh_token?: string }>("https://auth.contaazul.com/oauth2/token", {
    method: "POST", body, headers: { authorization: `Basic ${basic}`, "content-type": "application/x-www-form-urlencoded" },
  });
  if (r.refresh_token && r.refresh_token !== (await secret("HUB_CONTAAZUL_REFRESH_TOKEN"))) console.warn("Conta Azul devolveu novo refresh_token; atualize o segredo CONTAAZUL_REFRESH_TOKEN");
  return r.access_token;
}

const catCache = new Map<string, string | null>();
async function categoryId(name: string | null) {
  if (!name) return null;
  if (!catCache.has(name)) {
    const { data } = await db.from("cost_categories").select("id").ilike("name", name).maybeSingle();
    catCache.set(name, data?.id ?? null);
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
      const res = await fetchJson<{ itens?: Any[]; items?: Any[]; total_itens?: number } | Any[]>(`${base}/v1/financeiro/eventos-financeiros/contas-a-pagar/buscar?${q}`, { headers });
      const items = Array.isArray(res) ? res : res.itens ?? res.items ?? [];
      for (const it of items) {
        const competence = String(it.data_competencia ?? it.data_vencimento ?? from).slice(0, 7) + "-01";
        const { error } = await db.from("cost_entries").upsert({
          source: "contaazul", external_id: String(it.id), category_id: await categoryId(it.categoria?.nome ?? it.categoria_nome ?? null),
          description: it.descricao ?? it.observacao ?? "Conta a pagar", amount: round2(Number(it.valor_total ?? it.valor ?? 0)),
          competence_month: competence, paid_at: it.data_pagamento ?? null, vendor: it.fornecedor?.nome ?? it.pessoa?.nome ?? null, raw: it,
        }, { onConflict: "source,external_id" });
        if (error) throw error;
        rows++;
      }
      if (items.length < 100) break;
      pagina++;
    }
    return rows;
  }));
