// GeriTools / GeriUpdates (mesmo projeto Supabase) → hub.enrollments
// A fonte é shared.app_access: uma assinatura do GeriUpdates (via Guru) libera todos os apps GeriClass.
// origin = 'geriupdates' → produto GeriUpdates; demais origens → GeriTools. Assinaturas (MRR) vêm do webhook da Guru.
import { productIdFor, sql, upsert, upsertCustomer, withRun } from "../_shared/hub.ts";

type Access = { auth_user_id: string; email: string | null; full_name: string | null; role: string | null; active: boolean;
  access_until: string | null; origin: string | null; guru_status: string | null; created_at: string | null; updated_at: string | null };

Deno.serve((req) =>
  withRun("geritools", req, async () => {
    const geriupdates = await productIdFor("geritools", "geriupdates");
    const geritools = await productIdFor("geritools", "geritools");
    if (!geritools) throw new Error("mapeie o produto GeriTools em hub.product_source_refs (source geritools, external_id geritools)");
    const rows = await sql<Access[]>`select auth_user_id, email, full_name, role, active, access_until::text, origin, guru_status,
      created_at::text, updated_at::text from shared.app_access where email is not null`;
    let n = 0;
    for (const a of rows) {
      const productId = (a.origin === "geriupdates" && geriupdates) ? geriupdates : geritools;
      const customerId = await upsertCustomer({ email: a.email, name: a.full_name, source: "geritools", external_id: a.auth_user_id });
      const expired = a.access_until ? new Date(a.access_until) < new Date() : false;
      const status = !a.active ? "canceled" : expired ? "expired" : "active";
      await upsert("enrollments", {
        source: "geritools", external_id: a.auth_user_id, product_id: productId, customer_id: customerId, status,
        access_start: (a.created_at ?? new Date().toISOString()).slice(0, 10),
        access_end: a.access_until ? a.access_until.slice(0, 10) : null,
        raw: { role: a.role, origin: a.origin, guru_status: a.guru_status }, updated_at: new Date().toISOString(),
      }, ["source", "external_id"]);
      n++;
    }
    return n;
  }));
