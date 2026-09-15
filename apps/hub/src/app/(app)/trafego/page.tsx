import { redirect } from "next/navigation";
import { PageHeader } from "@/components/page-header";
import { LineChart } from "@/components/charts";
import { Card, Delta, Empty, Kpi, ProductLink } from "@/components/ui";
import { canSeeTraffic, getCurrentUser } from "@/lib/auth";
import { delta, fmtBRL, fmtBRLCompact, fmtInt, fmtX } from "@/lib/format";
import { parseMonth, shiftMonth } from "@/lib/period";
import { adSpendByAccount, companyPnl, productPnl, roasDaily } from "@/lib/queries";

export default async function Trafego({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const user = (await getCurrentUser())!;
  if (!canSeeTraffic(user.role)) redirect("/");
  const sp = await searchParams;
  const month = parseMonth(sp.mes);
  const prev = shiftMonth(month, -1);
  const [accounts, daily, pnl, pnlPrev, products] = await Promise.all([adSpendByAccount(month), roasDaily(month), companyPnl(month), companyPnl(prev), productPnl(month)]);
  const spend = accounts.reduce((a, r) => a + r.spend, 0);
  const leads = accounts.reduce((a, r) => a + r.leads, 0);
  const gross = pnl?.gross ?? 0;
  const roas = spend > 0 ? gross / spend : null;
  const roasPrev = pnlPrev && pnlPrev.ad_spend > 0 ? pnlPrev.gross / pnlPrev.ad_spend : null;
  const byPlatform = ["meta", "google"].map((pl) => ({ platform: pl, spend: accounts.filter((a) => a.platform === pl).reduce((x, a) => x + a.spend, 0), leads: accounts.filter((a) => a.platform === pl).reduce((x, a) => x + a.leads, 0) }));
  const labels = daily.map((d) => d.day.slice(8));

  return (
    <>
      <PageHeader title="Tráfego & ROAS" subtitle="Meta Ads + Google Ads · investimento por conta e retorno por produto" month={month} />
      <div className="grid grid-cols-2 gap-4 xl:grid-cols-4">
        <Kpi label="Investido" value={fmtBRLCompact(spend)} sub={byPlatform.map((p) => `${p.platform === "meta" ? "Meta" : "Google"} ${fmtBRLCompact(p.spend)}`).join(" · ")} />
        <Kpi label="Leads" value={fmtInt(leads)} sub={`CPL médio ${leads ? fmtBRL(spend / leads) : "—"}`} />
        <Kpi label="ROAS geral" value={fmtX(roas)} tone={roas != null && roas >= 3 ? "good" : roas != null && roas < 2 ? "bad" : "neutral"} sub={roas != null && roasPrev != null ? <><Delta value={((roas - roasPrev) / roasPrev) * 100} /> vs. mês anterior</> : "receita bruta ÷ investimento"} />
        <Kpi label="Mídia sobre receita" value={gross ? `${((spend / gross) * 100).toLocaleString("pt-BR", { maximumFractionDigits: 1 })}%` : "—"} sub={<><Delta value={pnlPrev && pnlPrev.gross ? delta(spend / gross, pnlPrev.ad_spend / pnlPrev.gross) : null} invert /> vs. mês anterior</>} />
      </div>

      <div className="mt-4 grid gap-4 xl:grid-cols-2">
        <Card title="Investimento diário" aside="todas as contas">
          {daily.length ? <LineChart labels={labels} series={[{ name: "Investido", color: "var(--series-1)", values: daily.map((d) => d.spend) }]} format="brlc" height={200} /> : <Empty>Sem dados diários.</Empty>}
        </Card>
        <Card title="ROAS diário" aside="receita do dia ÷ mídia do dia">
          {daily.length ? <LineChart labels={labels} series={[{ name: "ROAS", color: "var(--series-2)", values: daily.map((d) => d.roas) }]} format="x" height={200} /> : <Empty>Sem dados diários.</Empty>}
          <div className="eyebrow mt-2">Oscila com o dia da venda; leia a tendência, não o ponto.</div>
        </Card>
      </div>

      <Card title="Por conta de anúncio" aside="Meta + Google" className="mt-4">
        <div className="overflow-x-auto">
          <table className="data">
            <thead><tr><th>Conta</th><th>Plataforma</th><th>Produto</th><th className="num">Investido</th><th className="num">Cliques</th><th className="num">Leads</th><th className="num">CPL</th><th className="num">Compras (plataforma)</th><th className="num">ROAS</th></tr></thead>
            <tbody>
              {accounts.map((a) => (
                <tr key={a.account_id}>
                  <td><b>{a.account}</b></td>
                  <td className="text-ink-2">{a.platform === "meta" ? "Meta" : "Google"}</td>
                  <td>{a.slug ? <ProductLink slug={a.slug}>{a.product}</ProductLink> : <span className="text-warn">sem mapeamento</span>}</td>
                  <td className="num">{fmtBRL(a.spend)}</td>
                  <td className="num">{fmtInt(a.clicks)}</td>
                  <td className="num">{fmtInt(a.leads)}</td>
                  <td className="num">{fmtBRL(a.cpl)}</td>
                  <td className="num">{fmtInt(a.purchases)}</td>
                  <td className={`num font-semibold ${a.roas != null && a.roas < 2 ? "text-bad" : "text-accent"}`}>{fmtX(a.roas)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="eyebrow mt-3">ROAS usa a receita real de competência do produto (Guru/VUMP), não a atribuição da plataforma.</div>
      </Card>

      <Card title="Retorno por produto" aside="mídia vs. receita real" className="mt-4">
        <table className="data">
          <thead><tr><th>Produto</th><th className="num">Mídia</th><th className="num">Receita bruta</th><th className="num">ROAS</th><th className="num">Contribuição após mídia</th></tr></thead>
          <tbody>
            {products.filter((p) => p.ad_spend > 0).sort((a, b) => b.ad_spend - a.ad_spend).map((p) => (
              <tr key={p.product_id}>
                <td><ProductLink slug={p.slug}>{p.name}</ProductLink></td>
                <td className="num">{fmtBRL(p.ad_spend)}</td>
                <td className="num">{fmtBRL(p.gross)}</td>
                <td className={`num font-semibold ${p.roas != null && p.roas < 2 ? "text-bad" : "text-accent"}`}>{fmtX(p.roas)}</td>
                <td className={`num ${p.contribution_after_ads < 0 ? "text-bad" : ""}`}>{fmtBRL(p.contribution_after_ads)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </Card>
    </>
  );
}
