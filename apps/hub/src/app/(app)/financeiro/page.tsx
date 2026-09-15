import { redirect } from "next/navigation";
import { PageHeader } from "@/components/page-header";
import { HBars, LineChart } from "@/components/charts";
import { Card, Empty, Kpi, ProductLink, StatusPill } from "@/components/ui";
import { canSeeFinance, getCurrentUser } from "@/lib/auth";
import { fmtBRL, fmtBRLCompact, fmtInt, fmtPct, monthShort } from "@/lib/format";
import { parseMonth } from "@/lib/period";
import { cashByMonth, companyPnl, companyPnlSeries, costBreakdown, deductionsBreakdown, levelFor, productPnl, targets, teamCostByDepartment } from "@/lib/queries";

const dedLabel: Record<string, string> = {
  fee_platform: "Taxa Guru", fee_gateway: "Taxa Asaas", fee_installment: "Parcelamento", fee_partner: "Repasse VUMP/Anhanguera",
  commission_sales: "Comissão comercial", commission_affiliate: "Afiliados", refund: "Reembolsos", chargeback: "Chargebacks", tax: "Impostos", other: "Outros",
};

export default async function Financeiro({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const user = (await getCurrentUser())!;
  if (!canSeeFinance(user.role)) redirect("/");
  const sp = await searchParams;
  const month = parseMonth(sp.mes);
  const [pnl, series, cash, products, costs, team, deds, tgts] = await Promise.all([
    companyPnl(month), companyPnlSeries(6), cashByMonth(6), productPnl(month), costBreakdown(month), teamCostByDepartment(month), deductionsBreakdown(month), targets(month),
  ]);
  const cashMonth = cash.filter((c) => c.month === `${month}-01`);
  const cashNet = cashMonth.reduce((a, c) => a + c.net_received, 0);
  const cashTax = cashMonth.reduce((a, c) => a + c.taxes, 0);
  const months = series.map((s) => s.month.slice(0, 7));
  const cashByM = months.map((m) => cash.filter((c) => c.month.startsWith(m)).reduce((a, c) => a + c.net_received, 0));
  const targetFor = (id: string) => tgts.find((t) => t.product_id === id && t.metric === "margin_pct")?.value ?? null;

  const dre = pnl ? [
    { k: "Receita bruta (competência)", v: pnl.gross, strong: true },
    { k: "(−) Deduções: taxas, repasses, comissões, estornos", v: -pnl.deductions },
    { k: "(−) Impostos sobre receita (Presumido)", v: -pnl.taxes },
    { k: "= Receita líquida", v: pnl.net_revenue, strong: true },
    { k: "(−) Mídia paga", v: -pnl.ad_spend },
    { k: "(−) Pessoas alocadas a produto", v: -pnl.people_cost },
    { k: "(−) Custos diretos de produto", v: -pnl.direct_costs },
    { k: "(−) Overhead rateado (equipe geral + fixos)", v: -pnl.overhead },
    { k: "= Lucro líquido", v: pnl.profit, strong: true, tone: pnl.profit >= 0 ? "good" : "bad" },
  ] : [];

  return (
    <>
      <PageHeader title="Financeiro" subtitle="DRE gerencial · competência e caixa · lucro líquido após impostos" month={month} />
      <div className="grid grid-cols-2 gap-4 xl:grid-cols-4">
        <Kpi label="Lucro líquido (competência)" value={fmtBRLCompact(pnl?.profit)} tone={pnl && pnl.profit >= 0 ? "good" : "bad"} sub={`margem líquida ${fmtPct(pnl?.net_margin_pct, 1)}`} />
        <Kpi label="Receita líquida" value={fmtBRLCompact(pnl?.net_revenue)} sub={`bruta ${fmtBRLCompact(pnl?.gross)} · impostos ${fmtBRLCompact(pnl?.taxes)}`} />
        <Kpi label="Entrou no caixa" value={fmtBRLCompact(cashNet)} sub={`líquido de taxas · impostos estimados ${fmtBRLCompact(cashTax)}`} />
        <Kpi label="Custo variável" value={fmtPct(pnl?.variable_cost_pct)} sub="deduções + mídia sobre receita bruta" />
      </div>

      <div className="mt-4 grid gap-4 xl:grid-cols-[2fr_3fr]">
        <Card title="DRE do mês" aside="competência">
          {dre.length ? (
            <table className="data">
              <tbody>
                {dre.map((r) => (
                  <tr key={r.k}>
                    <td className={r.strong ? "font-semibold" : "text-ink-2"}>{r.k}</td>
                    <td className={`num ${r.strong ? "font-semibold" : ""} ${r.tone === "good" ? "text-accent" : r.tone === "bad" ? "text-bad" : ""}`}>{fmtBRL(r.v)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : <Empty>Sem dados no mês.</Empty>}
          <div className="eyebrow mt-3">Pró-labore e distribuição ficam fora do lucro operacional.</div>
        </Card>
        <Card title="Competência × caixa · 6 meses" aside="receita líquida vs. recebido">
          {series.length ? (
            <LineChart labels={months.map(monthShort)} format="brlc" height={230} series={[
              { name: "Receita líquida (competência)", color: "var(--series-1)", values: series.map((s) => s.net_revenue) },
              { name: "Recebido no caixa", color: "var(--series-2)", values: cashByM },
              { name: "Lucro líquido", color: "var(--series-3)", values: series.map((s) => s.profit) },
            ]} />
          ) : <Empty>Sem histórico.</Empty>}
        </Card>
      </div>

      <div className="mt-4 grid gap-4 xl:grid-cols-3">
        <Card title="Deduções da receita" aside="o que sai antes do líquido">
          {deds.length ? <HBars data={deds.map((d) => ({ label: dedLabel[d.kind] ?? d.kind, value: d.amount }))} format="brlc" color="var(--series-4)" /> : <Empty>Sem deduções.</Empty>}
        </Card>
        <Card title="Equipe por área" aside="custo mensal">
          {team.length ? <HBars data={team.map((t) => ({ label: t.department, value: t.amount, sub: `${t.people} ${t.people === 1 ? "pessoa" : "pessoas"}` }))} format="brlc" color="var(--series-3)" /> : <Empty>Sem equipe cadastrada.</Empty>}
        </Card>
        <Card title="Despesas do mês" aside="Conta Azul · por grupo">
          {costs.length ? <HBars data={costs.map((c) => ({ label: c.dre_group, value: c.amount, sub: c.kind }))} format="brlc" color="var(--series-1)" /> : <Empty>Sem lançamentos no mês.</Empty>}
        </Card>
      </div>

      <Card title="Margem por produto" aside="após mídia, pessoas e rateio" className="mt-4">
        <div className="overflow-x-auto">
          <table className="data">
            <thead><tr><th>Produto</th><th className="num">Bruto</th><th className="num">Líquido</th><th className="num">Mídia</th><th className="num">Pessoas</th><th className="num">Diretos</th><th className="num">Overhead</th><th className="num">Lucro</th><th className="num">Margem</th><th className="num">Meta</th><th className="num">Status</th></tr></thead>
            <tbody>
              {products.filter((p) => p.gross > 0 || p.people_cost > 0).map((p) => (
                <tr key={p.product_id}>
                  <td><ProductLink slug={p.slug}>{p.name}</ProductLink></td>
                  <td className="num">{fmtBRL(p.gross)}</td>
                  <td className="num">{fmtBRL(p.net_revenue)}</td>
                  <td className="num text-ink-2">{fmtBRL(p.ad_spend)}</td>
                  <td className="num text-ink-2">{fmtBRL(p.people_cost)}</td>
                  <td className="num text-ink-2">{fmtBRL(p.direct_costs)}</td>
                  <td className="num text-ink-2">{fmtBRL(p.overhead_alloc)}</td>
                  <td className={`num font-semibold ${p.profit < 0 ? "text-bad" : ""}`}>{fmtBRL(p.profit)}</td>
                  <td className="num font-semibold">{fmtPct(p.margin_pct)}</td>
                  <td className="num text-ink-3">{fmtPct(targetFor(p.product_id))}</td>
                  <td className="num"><StatusPill level={levelFor(p, targetFor(p.product_id))} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="eyebrow mt-3">Overhead rateado por regra cadastrada ou, na ausência, proporcional à receita bruta · {fmtInt(products.length)} produtos</div>
      </Card>
    </>
  );
}
