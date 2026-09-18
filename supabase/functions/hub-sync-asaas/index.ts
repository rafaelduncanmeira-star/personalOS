// Asaas → hub.payments (caixa). Janela: ?from&to (default últimos 3 dias, por data de pagamento e por data de criação).
import { env, fetchJson, normEmail, productIdFor, round2, secret, sql, upsert, withRun, window } from "../_shared/hub.ts";

type Payment = {
  id: string; customer: string; value: number; netValue: number; originalValue?: number | null; status: string;
  billingType: string; dueDate: string; paymentDate?: string | null; clientPaymentDate?: string | null;
  installmentNumber?: number | null; externalReference?: string | null; subscription?: string | null; description?: string | null;
};

const base = env("HUB_ASAAS_BASE_URL", "https://api.asaas.com/v3");
const headers = { access_token: await secret("HUB_ASAAS_API_KEY"), accept: "application/json" };
const statusMap: Record<string, string> = {
  PENDING: "pending", RECEIVED: "received", CONFIRMED: "received", RECEIVED_IN_CASH: "received",
  OVERDUE: "overdue", REFUNDED: "refunded", REFUND_REQUESTED: "refunded", REFUND_IN_PROGRESS: "refunded",
  CHARGEBACK_REQUESTED: "chargeback", CHARGEBACK_DISPUTE: "chargeback", AWAITING_CHARGEBACK_REVERSAL: "chargeback",
  DUNNING_REQUESTED: "overdue", DUNNING_RECEIVED: "received", AWAITING_RISK_ANALYSIS: "pending",
};
const methodMap: Record<string, string> = { PIX: "pix", CREDIT_CARD: "credit_card", DEBIT_CARD: "credit_card", BOLETO: "boleto", TRANSFER: "transfer", UNDEFINED: "other" };

const customerEmail = new Map<string, string | null>();
async function emailOf(customerId: string) {
  if (!customerEmail.has(customerId)) {
    const c = await fetchJson<{ email?: string }>(`${base}/customers/${customerId}`, { headers });
    customerEmail.set(customerId, normEmail(c.email));
  }
  return customerEmail.get(customerId)!;
}

async function* list(params: Record<string, string>) {
  let offset = 0;
  while (true) {
    const q = new URLSearchParams({ ...params, limit: "100", offset: String(offset) });
    const page = await fetchJson<{ data: Payment[]; hasMore: boolean }>(`${base}/payments?${q}`, { headers });
    for (const p of page.data) yield p;
    if (!page.hasMore) break;
    offset += 100;
  }
}

type OrderRef = { id: string; product_id: string | null; customer_id: string | null };

/** Liga o recebimento ao pedido: externalReference (id Guru) ou e-mail + valor da parcela + proximidade de data. */
async function linkOrder(p: Payment, email: string | null): Promise<OrderRef | null> {
  if (p.externalReference) {
    const [o] = await sql<OrderRef[]>`select id, product_id, customer_id from hub.orders where source = 'guru' and external_id = ${p.externalReference} limit 1`;
    if (o) return o;
  }
  if (!email) return null;
  const [o] = await sql<OrderRef[]>`
    select o.id, o.product_id, o.customer_id from hub.orders o join hub.customers c on c.id = o.customer_id
    where c.email = ${email} and o.sold_at >= ${p.dueDate}::date - interval '400 days'
      and abs((o.gross_amount - o.discount_amount) / o.installments - ${p.value}) < 1.5
    order by o.sold_at desc limit 1`;
  return o ?? null;
}

Deno.serve((req) =>
  withRun("asaas", req, async () => {
    const { from, to } = window(req);
    const seen = new Set<string>();
    let rows = 0;
    const windows: Record<string, string>[] = [
      { "paymentDate[ge]": from, "paymentDate[le]": to },
      { "dateCreated[ge]": from, "dateCreated[le]": to },
    ];
    for (const params of windows) {
      for await (const p of list(params)) {
        if (seen.has(p.id)) continue;
        seen.add(p.id);
        const email = await emailOf(p.customer);
        const order = await linkOrder(p, email);
        let customerId = order?.customer_id ?? null;
        if (!customerId && email) {
          const [c] = await sql<{ id: string }[]>`select id from hub.customers where email = ${email}`;
          customerId = c?.id ?? null;
        }
        const productId = order?.product_id ?? (await productIdFor("asaas", p.subscription ?? null));
        await upsert("payments", {
          source: "asaas", external_id: p.id, order_id: order?.id ?? null, product_id: productId, customer_id: customerId,
          status: statusMap[p.status] ?? "pending", due_date: p.dueDate,
          paid_at: p.clientPaymentDate ?? p.paymentDate ?? null,
          gross_amount: round2(p.value), fee_amount: round2(p.value - p.netValue), net_amount: round2(p.netValue),
          installment_number: p.installmentNumber ?? null, payment_method: methodMap[p.billingType] ?? "other", raw: p,
        }, ["source", "external_id"]);
        rows++;
      }
    }
    return rows;
  }));
