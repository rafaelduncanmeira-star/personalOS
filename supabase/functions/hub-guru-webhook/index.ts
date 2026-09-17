// Webhook da Digital Manager Guru (vendas e assinaturas) → hub.orders / hub.order_deductions / hub.subscriptions
// Configurar na Guru: Configurações → Webhooks, todos os status, URL:
//   https://<projeto>.supabase.co/functions/v1/hub-guru-webhook?token=<GURU_WEBHOOK_SECRET>
// A Guru não assina o payload; o segredo na URL é a validação.
import { db, json, productIdFor, round2, secret, upsertCustomer } from "../_shared/hub.ts";

type Any = Record<string, any>;

const statusMap: Record<string, string> = {
  approved: "approved", paid: "approved", completed: "approved",
  pending: "pending", waiting_payment: "pending", billet_printed: "pending", analysis: "pending", authorized: "pending",
  refunded: "refunded", partially_refunded: "partially_refunded",
  chargeback: "chargeback", dispute: "chargeback",
  canceled: "canceled", cancelled: "canceled", refused: "canceled", abandoned: "canceled", blocked: "canceled",
  expired: "expired",
};
const methodMap: Record<string, string> = { pix: "pix", credit_card: "credit_card", creditcard: "credit_card", card: "credit_card", billet: "boleto", boleto: "boleto", bank_transfer: "transfer" };

async function handleTransaction(t: Any) {
  const productId = await productIdFor("guru", t.product?.marketplace_id ?? t.product?.id);
  const customerId = await upsertCustomer({
    email: t.contact?.email, name: t.contact?.name, document: t.contact?.doc,
    phone: [t.contact?.phone_local_code, t.contact?.phone_number].filter(Boolean).join(""),
    source: "guru", external_id: t.contact?.id,
  });
  const status = statusMap[String(t.status ?? "").toLowerCase()] ?? "pending";
  const gross = Number(t.payment?.gross ?? t.payment?.total ?? t.product?.total_value ?? 0);
  const discount = Number(t.payment?.discount_value ?? 0);
  const net = Number(t.payment?.net ?? gross);
  const soldAt = t.dates?.ordered_at ?? t.dates?.created_at ?? new Date().toISOString();

  const { data: order, error } = await db.from("orders").upsert({
    source: "guru", external_id: String(t.id), product_id: productId, customer_id: customerId, status,
    sold_at: soldAt, approved_at: t.dates?.confirmed_at ?? null,
    gross_amount: round2(gross + discount), discount_amount: round2(discount),
    payment_method: methodMap[String(t.payment?.method ?? "").toLowerCase()] ?? "other",
    installments: Number(t.installments?.qty ?? 1) || 1,
    utm_source: t.source?.utm_source ?? null, utm_medium: t.source?.utm_medium ?? null, utm_campaign: t.source?.utm_campaign ?? null,
    utm_content: t.source?.utm_content ?? null, utm_term: t.source?.utm_term ?? null,
    affiliate: t.affiliations?.[0]?.name ?? null, raw: t,
  }, { onConflict: "source,external_id" }).select("id").single();
  if (error) throw error;

  // Deduções da fonte guru: recalculadas a cada evento (idempotente)
  await db.from("order_deductions").delete().eq("order_id", order.id).eq("source", "guru");
  const ded: Any[] = [];
  const fees = round2(gross - net);
  if (fees > 0 && status !== "pending") ded.push({ order_id: order.id, kind: "fee_gateway", amount: fees, occurred_at: soldAt, source: "guru", note: "gross − net (Guru + Asaas); refinado pelo Asaas" });
  const interest = Number(t.installments?.interest ?? 0);
  if (interest > 0) ded.push({ order_id: order.id, kind: "fee_installment", amount: round2(interest), occurred_at: soldAt, source: "guru" });
  for (const a of t.affiliations ?? []) if (Number(a.value) > 0) ded.push({ order_id: order.id, kind: "commission_affiliate", amount: round2(Number(a.value)), occurred_at: soldAt, source: "guru", note: a.name });
  if (status === "refunded" || status === "chargeback" || status === "partially_refunded") {
    ded.push({ order_id: order.id, kind: status === "chargeback" ? "chargeback" : "refund", amount: round2(gross), occurred_at: t.dates?.updated_at ?? new Date().toISOString(), source: "guru" });
  }
  if (ded.length) await db.from("order_deductions").insert(ded);
  return order.id;
}

const subStatus: Record<string, string> = { active: "active", trial: "trial", past_due: "past_due", pastdue: "past_due", canceled: "canceled", cancelled: "canceled", expired: "expired", paused: "paused", inactive: "expired" };
const intervalFor = (days: number) => (days >= 360 ? "annual" : days >= 180 ? "semiannual" : days >= 90 ? "quarterly" : "monthly");

async function handleSubscription(s: Any) {
  const productId = await productIdFor("guru", s.product?.marketplace_id ?? s.product?.id);
  const customerId = await upsertCustomer({ email: s.contact?.email, name: s.contact?.name, document: s.contact?.doc, source: "guru", external_id: s.contact?.id });
  const status = subStatus[String(s.last_status ?? s.status ?? "").toLowerCase()] ?? "active";
  const { data, error } = await db.from("subscriptions").upsert({
    source: "guru", external_id: String(s.subscription_code ?? s.id), product_id: productId, customer_id: customerId, status,
    interval: intervalFor(Number(s.charged_every_days ?? 30)), amount: Number(s.next_cycle_value ?? s.last_transaction?.payment?.total ?? 0),
    started_at: s.dates?.started_at ?? s.dates?.created_at ?? new Date().toISOString(),
    canceled_at: s.dates?.canceled_at ?? (status === "canceled" ? s.cancelled_by?.date ?? new Date().toISOString() : null),
    ended_at: s.dates?.cycle_end_date ?? null, cancel_reason: s.cancel_reason ?? null, raw: s,
  }, { onConflict: "source,external_id" }).select("id").single();
  if (error) throw error;
  if (s.last_transaction?.id) {
    const orderId = await handleTransaction({ ...s.last_transaction, contact: s.last_transaction.contact ?? s.contact, product: s.last_transaction.product ?? s.product });
    await db.from("orders").update({ subscription_id: data.id }).eq("id", orderId);
  }
  return data.id;
}

Deno.serve(async (req) => {
  if (req.method !== "POST") return json({ error: "method" }, 405);
  if (new URL(req.url).searchParams.get("token") !== (await secret("HUB_GURU_WEBHOOK_SECRET"))) return json({ error: "unauthorized" }, 401);
  const body = (await req.json()) as Any;
  try {
    const kind = body.webhook_type ?? (body.subscription_code ? "subscription" : "transaction");
    const id = kind === "subscription" ? await handleSubscription(body) : await handleTransaction(body);
    await db.from("integrations").update({ last_success_at: new Date().toISOString(), last_error: null, enabled: true }).eq("source", "guru");
    return json({ ok: true, kind, id });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    await db.from("integrations").update({ last_error: msg }).eq("source", "guru");
    console.error("guru-webhook", msg);
    return json({ ok: false, error: msg }, 500); // 500 faz a Guru re-tentar
  }
});
