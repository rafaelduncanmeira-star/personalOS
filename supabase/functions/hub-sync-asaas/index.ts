// Asaas → hub.payments (caixa). Janela: ?from&to (default últimos 3 dias, por data de pagamento e por data de criação).
import { db, env, fetchJson, normEmail, productIdFor, round2, withRun, window, secret } from "../_shared/hub.ts";

type Payment = {
  id: string; customer: string; value: number; netValue: number; originalValue?: number | null; status: string;
  billingType: string; dueDate: string; paymentDate?: string | null; clientPaymentDate?: string | null;
  installmentNumber?: number | null; externalReference?: string | null; subscription?: string | null; description?: string | null;
};

const base = env("ASAAS_BASE_URL", "https://api.asaas.com/v3");
const headers = { access_token: (await secret("HUB_ASAAS_API_KEY")), accept: "application/json" };
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

/** Liga o recebimento ao pedido: externalReference (id Guru) ou e-mail + valor da parcela + proximidade de data. */
async function linkOrder(p: Payment, email: string | null) {
  if (p.externalReference) {
    const { data } = await db.from("orders").select("id, product_id, customer_id").eq("source", "guru").eq("external_id", p.externalReference).maybeSingle();
    if (data) return data;
  }
  if (!email) return null;
  const { data } = await db.from("orders")
    .select("id, product_id, customer_id, gross_amount, discount_amount, installments, sold_at, customers!inner(email)")
    .eq("customers.email", email).gte("sold_at", new Date(new Date(p.dueDate).getTime() - 400 * 86400_000).toISOString())
    .order("sold_at", { ascending: false }).limit(20);
  const target = p.value;
  return (data ?? []).find((o: any) => Math.abs((o.gross_amount - o.discount_amount) / o.installments - target) < 1.5) ?? null;
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
          const { data } = await db.from("customers").select("id").eq("email", email).maybeSingle();
          customerId = data?.id ?? null;
        }
        const productId = order?.product_id ?? (await productIdFor("asaas", p.subscription ?? null));
        const { error } = await db.from("payments").upsert({
          source: "asaas", external_id: p.id, order_id: order?.id ?? null, product_id: productId, customer_id: customerId,
          status: statusMap[p.status] ?? "pending", due_date: p.dueDate,
          paid_at: p.clientPaymentDate ?? p.paymentDate ?? null,
          gross_amount: round2(p.value), fee_amount: round2(p.value - p.netValue), net_amount: round2(p.netValue),
          installment_number: p.installmentNumber ?? null, payment_method: methodMap[p.billingType] ?? "other", raw: p,
        }, { onConflict: "source,external_id" });
        if (error) throw error;
        rows++;
      }
    }
    return rows;
  }));
