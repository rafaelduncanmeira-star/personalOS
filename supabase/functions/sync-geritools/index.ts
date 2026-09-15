// GeriTools (Supabase próprio) → hub.subscriptions + hub.enrollments (source geritools)
// Lê o banco do GeriTools com a service-role dele. Ajuste os nomes de tabela/coluna à realidade do projeto.
import { createClient } from "npm:@supabase/supabase-js@2";
import { db, env, productIdFor, upsertCustomer, withRun } from "../_shared/hub.ts";

const geri = createClient(env("GERITOOLS_SUPABASE_URL"), env("GERITOOLS_SERVICE_ROLE_KEY"), { auth: { persistSession: false } });

Deno.serve((req) =>
  withRun("geritools", req, async () => {
    const productId = await productIdFor("geritools", "geritools");
    if (!productId) throw new Error("mapeie o produto GeriTools em hub.product_source_refs (source geritools, external_id geritools)");
    // Esperado: tabela `subscriptions` com user_id, status, plan, price, current_period_end, created_at, canceled_at
    // e `profiles` com id, email, full_name. Ajustar se o schema do GeriTools for outro.
    const { data: subs, error } = await geri.from("subscriptions").select("id, user_id, status, plan, price, interval, created_at, canceled_at, current_period_end, profiles(email, full_name)");
    if (error) throw error;
    let rows = 0;
    for (const s of subs ?? []) {
      const p = (s as any).profiles ?? {};
      const customerId = await upsertCustomer({ email: p.email, name: p.full_name, source: "geritools", external_id: s.user_id });
      const active = ["active", "trialing", "past_due"].includes(String(s.status));
      await db.from("subscriptions").upsert({
        source: "geritools", external_id: String(s.id), product_id: productId, customer_id: customerId,
        status: s.status === "trialing" ? "trial" : s.status === "past_due" ? "past_due" : active ? "active" : "canceled",
        interval: s.interval === "year" ? "annual" : "monthly", amount: Number(s.price ?? 0),
        started_at: s.created_at, canceled_at: s.canceled_at ?? null, ended_at: !active ? s.current_period_end ?? s.canceled_at ?? null : null, raw: s,
      }, { onConflict: "source,external_id" });
      await db.from("enrollments").upsert({
        source: "geritools", external_id: String(s.id), product_id: productId, customer_id: customerId,
        status: active ? "active" : "expired", access_start: String(s.created_at).slice(0, 10),
        access_end: s.current_period_end ? String(s.current_period_end).slice(0, 10) : null, updated_at: new Date().toISOString(),
      }, { onConflict: "source,external_id" });
      rows++;
    }
    return rows;
  }));
