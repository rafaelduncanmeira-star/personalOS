// Clint CRM → hub.pipelines / pipeline_stages / deals / deal_stage_events / leads
// Requer plano Elite (chave em Conta → API). Base https://api.clint.digital, header api-token.
import { db, env, fetchJson, upsertCustomer, withRun, window } from "../_shared/hub.ts";

type Any = Record<string, any>;
const base = env("CLINT_BASE_URL", "https://api.clint.digital");
const headers = { "api-token": env("CLINT_API_TOKEN"), accept: "application/json" };

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
      const { data } = await db.from("users").select("id").ilike("email", String(u.email ?? "")).maybeSingle();
      if (data) owners.set(String(u.id), data.id);
    }
    // Pipelines (groups) e etapas
    const stageIds = new Map<string, string>();
    const pipelineIds = new Map<string, string>();
    for await (const g of paged("/v1/groups")) {
      const { data: pl, error } = await db.from("pipelines").upsert({ source: "clint", external_id: String(g.id), name: g.name }, { onConflict: "source,external_id" }).select("id").single();
      if (error) throw error;
      pipelineIds.set(String(g.id), pl.id);
      const stages: Any[] = g.stages ?? g.pipeline_stages ?? [];
      for (const [i, s] of stages.entries()) {
        const name = String(s.name ?? "");
        const { data: st, error: e2 } = await db.from("pipeline_stages").upsert({
          pipeline_id: pl.id, external_id: String(s.id), name, position: Number(s.position ?? s.order ?? i + 1),
          is_won: /ganh|fech|won/i.test(name) || s.type === "won", is_lost: /perd|lost/i.test(name) || s.type === "lost",
        }, { onConflict: "pipeline_id,position" }).select("id").single();
        if (e2) throw e2;
        stageIds.set(String(s.id), st.id);
      }
    }
    // Negócios atualizados na janela
    let rows = 0;
    for await (const d of paged("/v1/deals", { updated_at_start: from })) {
      const pipelineId = pipelineIds.get(String(d.group_id ?? d.group?.id));
      if (!pipelineId) continue;
      const { data: pl } = await db.from("pipelines").select("product_id").eq("id", pipelineId).single();
      const contact = d.contact ?? {};
      const customerId = await upsertCustomer({ email: contact.email, name: contact.name, phone: contact.fullPhone ?? contact.phone, source: "clint", external_id: contact.id });
      const won = d.won_at ?? (d.status === "won" ? d.updated_at : null);
      const lost = d.lost_at ?? (d.status === "lost" ? d.updated_at : null);
      const { data: lead } = await db.from("leads").upsert({
        source: "clint", external_id: `contact:${contact.id ?? d.id}`, customer_id: customerId, product_id: pl?.product_id ?? null,
        origin: d.origin?.name ?? contact.origin?.name ?? null, created_at: contact.created_at ?? d.created_at ?? new Date().toISOString(), raw: contact,
      }, { onConflict: "source,external_id" }).select("id").single();
      const { data: deal, error } = await db.from("deals").upsert({
        source: "clint", external_id: String(d.id), pipeline_id: pipelineId, stage_id: stageIds.get(String(d.stage_id ?? d.stage?.id)) ?? null,
        lead_id: lead?.id ?? null, customer_id: customerId, product_id: pl?.product_id ?? null,
        owner_user_id: owners.get(String(d.user_id ?? d.owner?.id)) ?? null, title: d.name ?? d.title ?? null,
        value: d.value != null ? Number(d.value) : null, created_at: d.created_at ?? new Date().toISOString(),
        won_at: won, lost_at: lost, lost_reason: d.lost_status?.name ?? d.lost_reason ?? null, raw: d, updated_at: new Date().toISOString(),
      }, { onConflict: "source,external_id" }).select("id").single();
      if (error) throw error;
      // Histórico de etapas (para tempo por etapa)
      try {
        const hist = await fetchJson<{ data?: Any[] } | Any[]>(`${base}/v2/deals/${d.id}/history`, { headers });
        const events = Array.isArray(hist) ? hist : hist.data ?? [];
        const rowsEv = events.map((ev) => ({
          deal_id: deal.id, from_stage_id: stageIds.get(String(ev.from_stage_id ?? ev.old_stage?.id)) ?? null,
          to_stage_id: stageIds.get(String(ev.to_stage_id ?? ev.stage_id ?? ev.new_stage?.id)) ?? null,
          moved_at: ev.created_at ?? ev.date ?? new Date().toISOString(),
        })).filter((r) => r.to_stage_id);
        // histórico é reescrito por negócio (idempotente)
        await db.from("deal_stage_events").delete().eq("deal_id", deal.id);
        if (rowsEv.length) await db.from("deal_stage_events").insert(rowsEv);
      } catch (e) { console.warn("history", d.id, e instanceof Error ? e.message : e); }
      rows++;
    }
    return rows;
  }));
