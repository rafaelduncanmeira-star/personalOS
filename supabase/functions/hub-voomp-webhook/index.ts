// Webhook da Voomp Creators (vendas das pós-graduações) → hub.orders (source vump)
// O payload da Voomp não é documentado publicamente: este handler guarda o evento bruto sempre
// e tenta os nomes de campo mais comuns; ajustar após o primeiro evento real (ver hub.orders.raw).
import { db, json, productIdFor, round2, secret, upsertCustomer } from "../_shared/hub.ts";

type Any = Record<string, any>;
const pick = (o: Any, ...paths: string[]) => {
  for (const p of paths) {
    const v = p.split(".").reduce<any>((acc, k) => (acc == null ? undefined : acc[k]), o);
    if (v !== undefined && v !== null && v !== "") return v;
  }
  return undefined;
};
const statusMap: Record<string, string> = { approved: "approved", paid: "approved", aprovada: "approved", pago: "approved", completed: "approved",
  pending: "pending", pendente: "pending", waiting: "pending", refunded: "refunded", reembolsada: "refunded", estornada: "refunded",
  chargeback: "chargeback", canceled: "canceled", cancelada: "canceled", expired: "expired", expirada: "expired" };

Deno.serve(async (req) => {
  if (req.method !== "POST") return json({ error: "method" }, 405);
  const u = new URL(req.url);
  const token = u.searchParams.get("token") ?? req.headers.get("x-voomp-token") ?? req.headers.get("token");
  if (token !== (await secret("HUB_VOOMP_WEBHOOK_SECRET"))) return json({ error: "unauthorized" }, 401);
  const body = (await req.json()) as Any;
  try {
    const sale = body.data ?? body.sale ?? body.transaction ?? body;
    const externalId = String(pick(sale, "id", "transaction_id", "sale_id", "code") ?? crypto.randomUUID());
    const productExt = pick(sale, "product.id", "product_id", "product.code", "product.uuid");
    const productId = await productIdFor("vump", productExt);
    const customerId = await upsertCustomer({
      email: pick(sale, "buyer.email", "customer.email", "client.email", "email"),
      name: pick(sale, "buyer.name", "customer.name", "client.name", "name"),
      document: pick(sale, "buyer.document", "customer.document", "buyer.cpf"),
      phone: pick(sale, "buyer.phone", "customer.phone"), source: "vump", external_id: pick(sale, "buyer.id", "customer.id"),
    });
    const gross = Number(pick(sale, "amount", "value", "price", "total", "product.price") ?? 0);
    const producerNet = pick(sale, "producer_value", "commission.value", "net_value", "creator_amount");
    const status = statusMap[String(pick(sale, "status", "event", "type") ?? "").toLowerCase()] ?? "pending";
    const soldAt = pick(sale, "approved_at", "created_at", "date", "paid_at") ?? new Date().toISOString();
    const { data: order, error } = await db.from("orders").upsert({
      source: "vump", external_id: externalId, product_id: productId, customer_id: customerId, status, sold_at: soldAt,
      approved_at: status === "approved" ? pick(sale, "approved_at", "paid_at") ?? soldAt : null,
      gross_amount: round2(gross), installments: Number(pick(sale, "installments", "installments_number") ?? 1) || 1,
      payment_method: /pix/i.test(String(pick(sale, "payment_method", "payment.method") ?? "")) ? "pix" : /bol/i.test(String(pick(sale, "payment_method", "payment.method") ?? "")) ? "boleto" : "credit_card",
      raw: body,
    }, { onConflict: "source,external_id" }).select("id").single();
    if (error) throw error;
    await db.from("order_deductions").delete().eq("order_id", order.id).eq("source", "vump");
    if (producerNet != null && gross > Number(producerNet)) {
      await db.from("order_deductions").insert({ order_id: order.id, kind: "fee_partner", amount: round2(gross - Number(producerNet)), occurred_at: soldAt, source: "vump", note: "Voomp + Anhanguera (bruto − repasse ao produtor)" });
    }
    await db.from("integrations").update({ last_success_at: new Date().toISOString(), last_error: null, enabled: true }).eq("source", "vump");
    return json({ ok: true, id: order.id });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    await db.from("integrations").update({ last_error: msg }).eq("source", "vump");
    return json({ ok: false, error: msg }, 500);
  }
});
