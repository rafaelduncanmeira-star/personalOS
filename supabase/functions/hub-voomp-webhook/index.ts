// Geri Hub · webhook da Voomp Creators (vendas das pós-graduações) → hub.orders (source vump)
// O payload da Voomp não é documentado publicamente: este handler guarda o evento bruto sempre
// e tenta os nomes de campo mais comuns; ajustar após o primeiro evento real (ver hub.orders.raw).
import { errMsg, json, markIntegration, productIdFor, round2, secret, sql, upsert, upsertCustomer } from "../_shared/hub.ts";

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
    const method = String(pick(sale, "payment_method", "payment.method") ?? "");
    const order = await upsert("orders", {
      source: "vump", external_id: externalId, product_id: productId, customer_id: customerId, status, sold_at: soldAt,
      approved_at: status === "approved" ? pick(sale, "approved_at", "paid_at") ?? soldAt : null,
      gross_amount: round2(gross), installments: Number(pick(sale, "installments", "installments_number") ?? 1) || 1,
      payment_method: /pix/i.test(method) ? "pix" : /bol/i.test(method) ? "boleto" : "credit_card",
      raw: body,
    }, ["source", "external_id"]);
    await sql`delete from hub.order_deductions where order_id = ${order.id} and source = 'vump'`;
    if (producerNet != null && gross > Number(producerNet)) {
      await sql`insert into hub.order_deductions (order_id, kind, amount, occurred_at, source, note)
        values (${order.id}, 'fee_partner', ${round2(gross - Number(producerNet))}, ${soldAt}, 'vump', 'Voomp + Anhanguera (bruto − repasse ao produtor)')`;
    }
    await markIntegration("vump", null);
    return json({ ok: true, id: order.id });
  } catch (e) {
    const msg = errMsg(e);
    await markIntegration("vump", msg);
    return json({ ok: false, error: msg }, 500);
  }
});
