// Curseduca → hub.enrollments (aluno ativo = situação ACTIVE + acesso vigente no grupo mapeado a um produto)
import { env, fetchJson, productIdFor, secret, upsert, upsertCustomer, withRun } from "../_shared/hub.ts";

type Group = { id: number | string; uuid: string; name: string; expirationType?: string | null; expirationInterval?: number | null };
type MemberGroup = { uuid?: string; id?: number | string; name?: string; enteredAt?: string; expiresAt?: string | null; customExpirationDate?: string | null; createdAt?: string };
type Member = {
  id: number | string; uuid: string; name: string; email: string; document?: string | null; situation: "ACTIVE" | "INACTIVE" | "BLOCKED";
  lastLogin?: string | null; createdAt?: string; groups?: MemberGroup[]; mobileTelephone?: string | null;
};

const base = env("HUB_CURSEDUCA_BASE_URL", "https://prof.curseduca.pro"); // confirmar no Swagger da conta
const headers = { api_key: await secret("HUB_CURSEDUCA_API_KEY"), accept: "application/json" };

async function* members() {
  let offset = 0;
  while (true) {
    const page = await fetchJson<{ data?: Member[]; hasMore?: boolean } | Member[]>(`${base}/members?limit=100&offset=${offset}`, { headers });
    const data = Array.isArray(page) ? page : page.data ?? [];
    for (const m of data) yield m;
    const more = Array.isArray(page) ? data.length === 100 : !!page.hasMore;
    if (!more) break;
    offset += 100;
  }
}

Deno.serve((req) =>
  withRun("curseduca", req, async () => {
    const groups = await fetchJson<{ data?: Group[] } | Group[]>(`${base}/groups`, { headers });
    const groupList = Array.isArray(groups) ? groups : groups.data ?? [];
    const groupProduct = new Map<string, string | null>();
    for (const g of groupList) groupProduct.set(String(g.uuid), (await productIdFor("curseduca", g.uuid)) ?? (await productIdFor("curseduca", g.id)));

    let rows = 0;
    for await (const m of members()) {
      const customerId = await upsertCustomer({ email: m.email, name: m.name, document: m.document, phone: m.mobileTelephone, source: "curseduca", external_id: m.id });
      for (const g of m.groups ?? []) {
        const key = String(g.uuid ?? g.id);
        const productId = groupProduct.get(key) ?? (await productIdFor("curseduca", key));
        if (!productId) continue; // grupo sem produto mapeado (ex.: "Todos os alunos")
        const accessEnd = g.customExpirationDate ?? g.expiresAt ?? null;
        const expired = accessEnd ? new Date(accessEnd) < new Date() : false;
        const status = m.situation === "BLOCKED" ? "blocked" : m.situation === "INACTIVE" ? "canceled" : expired ? "expired" : "active";
        await upsert("enrollments", {
          source: "curseduca", external_id: `${m.id}:${key}`, product_id: productId, customer_id: customerId, status,
          access_start: (g.enteredAt ?? g.createdAt ?? m.createdAt ?? new Date().toISOString()).slice(0, 10),
          access_end: accessEnd ? accessEnd.slice(0, 10) : null, last_access_at: m.lastLogin ?? null,
          raw: { member: { id: m.id, situation: m.situation }, group: g }, updated_at: new Date().toISOString(),
        }, ["source", "external_id"]);
        rows++;
      }
    }
    return rows;
  }));
