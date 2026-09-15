import { notFound } from "next/navigation";
import { PageHeader } from "@/components/page-header";
import { BarChart, LineChart } from "@/components/charts";
import { Card, Empty, Kpi, StatusPill, Tag } from "@/components/ui";
import { canSeeFinance, getCurrentUser } from "@/lib/auth";
import { fmtBRL, fmtBRLCents, fmtBRLCompact, fmtInt, fmtPct, fmtX, monthShort } from "@/lib/format";
import { parseMonth } from "@/lib/period";
import { activeStudents, levelFor, listProducts, mrrSeries, productPnlSeries, recentOrders, roasDaily, targets } from "@/lib/queries";

export default async function Produto({ params, searchParams }: { params: Promise<{ slug: string }>; searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const user = (await getCurrentUser())!;
  const { slug } = await params;
  const sp = await searchParams;
  const month = parseMonth(sp.mes);
  const products = await listProducts();
  const product = products.find((p) => p.slug === slug);
  if (!product) notFound();
  const [series, students, mrr, orders, daily, tgts] = await Promise.all([productPnlSeries(slug, 6), activeStudents(), mrrSeries(6), recentOrders(10, slug), roasDaily(month, slug), targets(month)]);
  const cur = series.find((s) => s.month.startsWith(month)) ?? series[series.length - 1];
  const st = students.find((s) => s.slug === slug);
  const sub = mrr.filter((r) => r.slug === slug);
  const subNow = sub.find((r) => r.month.startsWith(month));
  const target = tgts.find((t) => t.product_id === product.id && t.metric === "margin_pct")?.value ?? product.target_margin_pct;
  const finance = canSeeFinance(user.role);

  return (
    <>
      <PageHeader title={product.name} subtitle={<>{product.family.replace("_", " ")} · {product.billing.replace("_", " ")} · entregue em {product.delivery ?? "—"}</>} month={month}
        extra={cur && <StatusPill level={levelFor(cur, target)} />} />
      <div className="grid grid-cols-2 gap-4 xl:grid-cols-4">
        <Kpi label="Receita bruta" value={fmtBRLCompact(cur?.gross)} sub={`líquida ${fmtBRLCompact(cur?.net_revenue)}`} />
        <Kpi label="Mídia · ROAS" value={fmtX(cur?.roas)} sub={`investido ${fmtBRLCompact(cur?.ad_spend)}`} />
        {finance ? <Kpi label="Margem" value={fmtPct(cur?.margin_pct)} tone={cur && target != null && (cur.margin_pct ?? 0) < target ? "bad" : "good"} sub={`meta ${fmtPct(target)} · lucro ${fmtBRLCompact(cur?.profit)}`} />
                 : <Kpi label="Contribuição após mídia" value={fmtBRLCompact(cur?.contribution_after_ads)} />}
        <Kpi label={product.billing === "subscription" ? "Assinantes ativos" : "Alunos ativos"} value={fmtInt(product.billing === "subscription" ? subNow?.active_subs : st?.active_students)}
          sub={product.billing === "subscription" ? `MRR ${fmtBRLCompact(subNow?.mrr)} · churn ${fmtPct(subNow?.churn_pct, 1)}` : "acesso vigente"} />
      </div>

      <div className="mt-4 grid gap-4 xl:grid-cols-2">
        <Card title="Receita · 6 meses" aside="bruta por competência">
          {series.length ? <BarChart data={series.map((s) => ({ label: monthShort(s.month), value: s.gross, highlight: s.month.startsWith(month), note: `${monthShort(s.month)}: ${fmtBRL(s.gross)}` }))} format="brlc" height={180} /> : <Empty>Sem histórico.</Empty>}
        </Card>
        {product.billing === "subscription" ? (
          <Card title="MRR e churn" aside="6 meses">
            {sub.length ? <LineChart labels={sub.map((r) => monthShort(r.month))} series={[{ name: "MRR", color: "var(--series-2)", values: sub.map((r) => r.mrr) }]} format="brlc" height={180} /> : <Empty>Sem assinaturas.</Empty>}
            <div className="mt-3 flex flex-wrap gap-2">{sub.map((r) => <Tag key={r.month}>{monthShort(r.month)} · churn {fmtPct(r.churn_pct, 1)}</Tag>)}</div>
          </Card>
        ) : (
          <Card title="Mídia diária vs. ROAS" aside="mês selecionado">
            {daily.length ? <LineChart labels={daily.map((d) => d.day.slice(8))} series={[{ name: "Investido", color: "var(--series-1)", values: daily.map((d) => d.spend) }]} format="brlc" height={180} /> : <Empty>Sem mídia neste produto.</Empty>}
          </Card>
        )}
      </div>

      {finance && (
        <Card title="Estrutura de resultado · 6 meses" aside="competência" className="mt-4">
          <div className="overflow-x-auto">
            <table className="data">
              <thead><tr><th>Mês</th><th className="num">Bruto</th><th className="num">Deduções</th><th className="num">Impostos</th><th className="num">Líquido</th><th className="num">Mídia</th><th className="num">Pessoas</th><th className="num">Diretos</th><th className="num">Overhead</th><th className="num">Lucro</th><th className="num">Margem</th></tr></thead>
              <tbody>
                {series.map((s) => (
                  <tr key={s.month} className={s.month.startsWith(month) ? "bg-surface-2" : ""}>
                    <td><b>{monthShort(s.month)}</b></td>
                    <td className="num">{fmtBRL(s.gross)}</td><td className="num text-ink-2">{fmtBRL(s.deductions)}</td><td className="num text-ink-2">{fmtBRL(s.taxes)}</td>
                    <td className="num">{fmtBRL(s.net_revenue)}</td><td className="num text-ink-2">{fmtBRL(s.ad_spend)}</td><td className="num text-ink-2">{fmtBRL(s.people_cost)}</td>
                    <td className="num text-ink-2">{fmtBRL(s.direct_costs)}</td><td className="num text-ink-2">{fmtBRL(s.overhead_alloc)}</td>
                    <td className={`num font-semibold ${s.profit < 0 ? "text-bad" : ""}`}>{fmtBRL(s.profit)}</td><td className="num font-semibold">{fmtPct(s.margin_pct)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      )}

      <Card title="Últimas vendas" className="mt-4">
        {orders.length ? (
          <table className="data">
            <thead><tr><th>Quando</th><th>Cliente</th><th className="num">Valor</th><th>Pagamento</th><th>Origem</th><th>Status</th></tr></thead>
            <tbody>
              {orders.map((o) => (
                <tr key={o.id}>
                  <td className="tnum text-ink-2">{new Date(o.sold_at).toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit", timeZone: "America/Sao_Paulo" })}</td>
                  <td>{o.customer ?? "—"}</td>
                  <td className="num">{fmtBRLCents(o.gross)}</td>
                  <td className="text-ink-2">{o.method ?? "—"}{o.installments > 1 && ` · ${o.installments}x`}</td>
                  <td className="text-ink-2">{o.utm_source ?? o.source}</td>
                  <td>{o.status === "approved" ? <span className="pill pill-good">Aprovada</span> : <span className="pill pill-bad">{o.status}</span>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : <Empty>Sem vendas registradas.</Empty>}
      </Card>
    </>
  );
}
