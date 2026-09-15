import { redirect } from "next/navigation";
import { PageHeader } from "@/components/page-header";
import { LineChart } from "@/components/charts";
import { Card, Delta, Empty, Kpi, ProductLink, Tag } from "@/components/ui";
import { canSeeSales, getCurrentUser } from "@/lib/auth";
import { delta, fmtBRL, fmtBRLCents, fmtBRLCompact, fmtInt, monthShort, fmtPct } from "@/lib/format";
import { parseMonth, shiftMonth } from "@/lib/period";
import { accrualByProductMonth, activeStudents, mrrSeries, productPnl, recentOrders, salesMonthToDate } from "@/lib/queries";

const statusLabel: Record<string, string> = { approved: "Aprovada", refunded: "Reembolso", chargeback: "Chargeback", pending: "Pendente", canceled: "Cancelada", expired: "Expirada", partially_refunded: "Reemb. parcial" };

export default async function Vendas({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const user = (await getCurrentUser())!;
  if (!canSeeSales(user.role)) redirect("/");
  const sp = await searchParams;
  const month = parseMonth(sp.mes);
  const prev = shiftMonth(month, -1);
  const [products, series, mrr, students, orders, mtd, mtdPrev] = await Promise.all([
    productPnl(month), accrualByProductMonth(6), mrrSeries(6), activeStudents(), recentOrders(12), salesMonthToDate(month, 31), salesMonthToDate(prev, 31),
  ]);
  const gross = products.reduce((a, p) => a + p.gross, 0);
  const grossPrev = mtdPrev.reduce((a, p) => a + p.gross, 0);
  const orders_count = mtd.reduce((a, p) => a + p.orders_count, 0);
  const months = Array.from(new Set(series.map((s) => s.month))).sort();
  const top = products.filter((p) => p.gross > 0).sort((a, b) => b.gross - a.gross).slice(0, 4);
  const colors = ["var(--series-1)", "var(--series-2)", "var(--series-3)", "var(--series-4)"];
  const lineSeries = top.map((p, i) => ({ name: p.name, color: colors[i], values: months.map((m) => series.find((s) => s.month === m && s.slug === p.slug)?.gross ?? 0) }));
  const mrrNow = mrr.filter((r) => r.month === `${month}-01`);
  const mrrTotal = mrrNow.reduce((a, r) => a + r.mrr, 0);
  const totalStudents = students.reduce((a, s) => a + s.active_students, 0);

  return (
    <>
      <PageHeader title="Vendas" subtitle="Competência · Guru + Asaas + VUMP" month={month} />
      <div className="grid grid-cols-2 gap-4 xl:grid-cols-4">
        <Kpi label="Receita bruta" value={fmtBRLCompact(gross)} sub={<><Delta value={delta(gross, grossPrev)} /> vs. mês anterior</>} />
        <Kpi label="Vendas aprovadas" value={fmtInt(orders_count)} sub={`ticket médio ${orders_count ? fmtBRL(gross / orders_count) : "—"}`} />
        <Kpi label="MRR (assinaturas)" value={fmtBRLCompact(mrrTotal)} sub={mrrNow.map((r) => `${r.name} ${fmtBRLCompact(r.mrr)}`).join(" · ") || "sem assinaturas"} />
        <Kpi label="Alunos ativos" value={fmtInt(totalStudents)} sub="matriculados com acesso vigente" />
      </div>

      <div className="mt-4 grid gap-4 xl:grid-cols-[3fr_2fr]">
        <Card title="Receita por produto · 6 meses" aside="4 maiores do mês">
          {months.length ? <LineChart labels={months.map(monthShort)} series={lineSeries} format="brlc" height={220} /> : <Empty>Sem histórico.</Empty>}
        </Card>
        <Card title="Assinaturas" aside="MRR · churn · novos">
          {mrrNow.length ? (
            <table className="data">
              <thead><tr><th>Produto</th><th className="num">Ativas</th><th className="num">MRR</th><th className="num">Novas</th><th className="num">Churn</th></tr></thead>
              <tbody>
                {mrrNow.map((r) => (
                  <tr key={r.slug}>
                    <td><ProductLink slug={r.slug}>{r.name}</ProductLink></td>
                    <td className="num">{fmtInt(r.active_subs)}</td>
                    <td className="num">{fmtBRL(r.mrr)}</td>
                    <td className="num text-accent">+{fmtInt(r.new_subs)}</td>
                    <td className={`num ${r.churn_pct != null && r.churn_pct > 5 ? "text-bad" : ""}`}>{fmtPct(r.churn_pct, 1)} <span className="text-ink-3">({r.churned_subs})</span></td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : <Empty>Sem assinaturas no mês.</Empty>}
          <div className="eyebrow mt-3">Churn = cancelamentos ÷ base no início do mês</div>
        </Card>
      </div>

      <Card title="Detalhe por produto" aside="Receita · deduções · líquido" className="mt-4">
        <div className="overflow-x-auto">
          <table className="data">
            <thead><tr><th>Produto</th><th className="num">Vendas</th><th className="num">Bruto</th><th className="num">Deduções</th><th className="num">Impostos</th><th className="num">Líquido</th><th className="num">Alunos ativos</th></tr></thead>
            <tbody>
              {products.map((p) => {
                const cur = mtd.find((r) => r.product_id === p.product_id);
                const st = students.find((s) => s.product_id === p.product_id);
                return (
                  <tr key={p.product_id}>
                    <td><ProductLink slug={p.slug}>{p.name}</ProductLink> <span className="ml-2"><Tag>{p.family.replace("_", " ")}</Tag></span></td>
                    <td className="num">{fmtInt(cur?.orders_count ?? 0)}</td>
                    <td className="num">{fmtBRL(p.gross)}</td>
                    <td className="num text-ink-2">−{fmtBRL(p.deductions)}</td>
                    <td className="num text-ink-2">−{fmtBRL(p.taxes)}</td>
                    <td className="num font-semibold">{fmtBRL(p.net_revenue)}</td>
                    <td className="num">{st ? fmtInt(st.active_students) : "—"}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </Card>

      <Card title="Últimas vendas" aside="tempo real via webhook da Guru" className="mt-4">
        <div className="overflow-x-auto">
          <table className="data">
            <thead><tr><th>Quando</th><th>Produto</th><th>Cliente</th><th className="num">Valor</th><th>Pagamento</th><th>Origem</th><th>Status</th></tr></thead>
            <tbody>
              {orders.map((o) => (
                <tr key={o.id}>
                  <td className="tnum text-ink-2">{new Date(o.sold_at).toLocaleString("pt-BR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit", timeZone: "America/Sao_Paulo" })}</td>
                  <td><b>{o.product}</b></td>
                  <td>{o.customer ?? "—"}</td>
                  <td className="num">{fmtBRLCents(o.gross)}</td>
                  <td className="text-ink-2">{o.method ?? "—"}{o.installments > 1 && ` · ${o.installments}x`}</td>
                  <td className="text-ink-2">{o.utm_source ?? o.source}</td>
                  <td>{o.status === "approved" ? <span className="pill pill-good">Aprovada</span> : <span className="pill pill-bad">{statusLabel[o.status] ?? o.status}</span>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>
    </>
  );
}
