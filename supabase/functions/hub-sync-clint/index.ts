// Clint CRM → hub.pipelines / pipeline_stages / deals / deal_stage_events / leads
// Requer plano Elite (chave em Conta → API). Base https://api.clint.digital, header api-token.
import { env, fetchJson, insertMany, secret, sql, upsert, upsertCustomer, withRun, window } from "../_shared/hub.ts";

type Any = Record<string, any>;
const base = env("HUB_CLINT_BASE_URL", "https://api.clint.digital");
const headers = { "api-token": await secret("HUB_CLINT_API_TOKEN"), accept: "application/json" };

async function* paged(path: string, params: Record<string, string> = {}) {
  let page = 1;
  while (true) {
    const q = new URLSearchParams({ ...params, limit: "200", page: String(page) });
    const res = await fetchJson<{ data?: Any[]; hasNext?: boolean } | Any[]>(`${base}${path}?${q}`, { headers });
    const data = Array.isArray(res) ? res : res.data ?? [];
    for (const d of data) yield d;
    if (Array.isArray(res) ? data.length < 200 : !res.hasNext) break;
    page++;
  }
}

Deno.serve((req) =>
  withRun("clint", req, async () => {
    const { from } = window(req);
    // Usuários (vendedores) → hub.users por e-mail (não cria; só liga quem já existe)
    const owners = new Map<string, string>();
    for await (const u of paged("/v1/users")) {
      const [hu] = await sql<{ id: string }[]>`select id from hub.users where lower(email) = lower(${String(u.email ?? "")}) limit 1`;
      if (hu) owners.set(String(u.id), hu.id);
    }
    // Pipelines (groups) e etapas
    const stageIds = new Map<string, string>();
    const pipelineIds = new Map<string, string>();
    const pipelineProduct = new Map<string, string | null>();
    for await (const g of paged("/v1/groups")) {
      const pl = await upsert("pipelines", { source: "clint", external_id: String(g.id), name: g.name }, ["source", "external_id"]);
      pipelineIds.set(String(g.id), pl.id);
      const [pp] = await sql<{ product_id: string | null }[]>`select product_id from hub.pipelines where id = ${pl.id}`;
      pipelineProduct.set(pl.id, pp?.product_id ?? null);
      const stages: Any[] = g.stages ?? g.pipeline_stages ?? [];
      for (const [i, s] of stages.entries()) {
        const name = String(s.name ?? "");
        const st = await upsert("pipeline_stages", {
          pipeline_id: pl.id, external_id: String(s.id), name, position: Number(s.position ?? s.order ?? i + 1),
          is_won: /ganh|fech|won/i.test(name) || s.type === "won", is_lost: /perd|lost/i.test(name) || s.type === "lost",
        }, ["pipeline_id", "position"]);
        stageIds.set(String(s.id), st.id);
      }
    }
    // Negócios atualizados na janela
    let rows = 0;
    for await (const d of paged("/v1/deals", { updated_at_start: from })) {
      const pipelineId = pipelineIds.get(String(d.group_id ?? d.group?.id));
      if (!pipelineId) continue;
      const productId = pipelineProduct.get(pipelineId) ?? null;
      const contact = d.contact ?? {};
      const customerId = await upsertCustomer({ email: contact.email, name: contact.name, phone: contact.fullPhone ?? contact.phone, source: "clint", external_id: contact.id });
      const won = d.won_at ?? (d.status === "won" ? d.updated_at : null);
      const lost = d.lost_at ?? (d.status === "lost" ? d.updated_at : null);
      const lead = await upsert("leads", {
        source: "clint", external_id: `contact:${contact.id ?? d.id}`, customer_id: customerId, product_id: productId,
        origin: d.origin?.name ?? contact.origin?.name ?? null, created_at: contact.created_at ?? d.created_at ?? new Date().toISOString(), raw: contact,
      }, ["source", "external_id"]);
      const deal = await upsert("deals", {
        source: "clint", external_id: String(d.id), pipeline_id: pipelineId, stage_id: stageIds.get(String(d.stage_id ?? d.stage?.id)) ?? null,
        lead_id: lead.id, customer_id: customerId, product_id: productId,
        owner_user_id: owners.get(String(d.user_id ?? d.owner?.id)) ?? null, title: d.name ?? d.title ?? null,
        value: d.value != null ? Number(d.value) : null, created_at: d.created_at ?? new Date().toISOString(),
        won_at: won, lost_at: lost, lost_reason: d.lost_status?.name ?? d.lost_reason ?? null, raw: d, updated_at: new Date().toISOString(),
      }, ["source", "external_id"]);
      // Histórico de etapas (para tempo por etapa), reescrito por negócio (idempotente)
      try {
        const hist = await fetchJson<{ data?: Any[] } | Any[]>(`${base}/v2/deals/${d.id}/history`, { headers });
        const events = (Array.isArray(hist) ? hist : hist.data ?? []).map((ev) => ({
          deal_id: deal.id, from_stage_id: stageIds.get(String(ev.from_stage_id ?? ev.old_stage?.id)) ?? null,
          to_stage_id: stageIds.get(String(ev.to_stage_id ?? ev.stage_id ?? ev.new_stage?.id)) ?? null,
          moved_at: ev.created_at ?? ev.date ?? new Date().toISOString(),
        })).filter((r) => r.to_stage_id);
        await sql`delete from hub.deal_stage_events where deal_id = ${deal.id}`;
        await insertMany("deal_stage_events", events);
      } catch (e) { console.warn("history", d.id, e instanceof Error ? e.message : e); }
      rows++;
    }
    return rows;
  }));
