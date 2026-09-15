import { redirect } from "next/navigation";
import { PageHeader } from "@/components/page-header";
import { HBars } from "@/components/charts";
import { Card, Empty, Kpi, ProductLink } from "@/components/ui";
import { canSeeCommercial, getCurrentUser } from "@/lib/auth";
import { fmtBRL, fmtBRLCompact, fmtInt, fmtPct } from "@/lib/format";
import { parseMonth } from "@/lib/period";
import { briefingItems, funnel, funnelStages, lostReasons, sellersPerformance } from "@/lib/queries";

export default async function Comercial({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const user = (await getCurrentUser())!;
  if (!canSeeCommercial(user.role)) redirect("/");
  const sp = await searchParams;
  const month = parseMonth(sp.mes);
  const [pipes, stages, sellers, reasons, briefing] = await Promise.all([funnel(month), funnelStages(month), sellersPerformance(month), lostReasons(month), briefingItems()]);
  const created = pipes.reduce((a, p) => a + p.deals_created, 0);
  const won = pipes.reduce((a, p) => a + p.won, 0);
  const wonValue = pipes.reduce((a, p) => a + p.won_value, 0);
  const pipelines = Array.from(new Set(stages.map((s) => s.pipeline)));

  return (
    <>
      <PageHeader title="Comercial" subtitle="Clint CRM · funil, conversão por vendedor e motivos de perda" month={month} />
      <div className="grid grid-cols-2 gap-4 xl:grid-cols-4">
        <Kpi label="Negócios criados" value={fmtInt(created)} sub="no mês, todos os pipelines" />
        <Kpi label="Fechados" value={fmtInt(won)} tone="good" sub={`taxa de conversão ${created ? fmtPct((won / created) * 100, 1) : "—"}`} />
        <Kpi label="Valor fechado" value={fmtBRLCompact(wonValue)} sub={`ticket médio ${won ? fmtBRL(wonValue / won) : "—"}`} />
        <Kpi label="Ciclo médio" value={pipes.length ? `${Math.round(pipes.reduce((a, p) => a + (p.avg_days_to_win ?? 0), 0) / pipes.filter((p) => p.avg_days_to_win != null).length || 0)} d` : "—"} sub="dias da criação ao fechamento" />
      </div>

      <div className="mt-4 grid gap-4 xl:grid-cols-3">
        {pipelines.map((name) => {
          const st = stages.filter((s) => s.pipeline === name && !s.is_lost);
          const meta = pipes.find((p) => p.pipeline === name);
          return (
            <Card key={name} title={name} aside={meta ? `${fmtPct(meta.win_rate_pct, 1)} conversão` : ""}>
              <HBars data={st.map((s) => ({ label: s.stage, value: s.deals }))} format="int" color={name.startsWith("Mentoria") ? "var(--series-1)" : "var(--series-2)"} />
              <div className="eyebrow mt-3">Perdidos: {fmtInt(stages.find((s) => s.pipeline === name && s.is_lost)?.deals ?? 0)}{meta?.slug && <> · <ProductLink slug={meta.slug}>ver produto</ProductLink></>}</div>
            </Card>
          );
        })}
        {!pipelines.length && <Empty>Nenhum pipeline sincronizado do Clint ainda.</Empty>}
      </div>

      <div className="mt-4 grid gap-4 xl:grid-cols-[3fr_2fr]">
        <Card title="Por vendedor" aside="negócios do mês">
          {sellers.length ? (
            <table className="data">
              <thead><tr><th>Vendedor</th><th className="num">Negócios</th><th className="num">Fechados</th><th className="num">Perdidos</th><th className="num">Conversão</th><th className="num">Valor fechado</th></tr></thead>
              <tbody>
                {sellers.map((s) => (
                  <tr key={s.owner}>
                    <td><b>{s.owner}</b></td>
                    <td className="num">{fmtInt(s.deals)}</td>
                    <td className="num text-accent">{fmtInt(s.won)}</td>
                    <td className="num text-ink-2">{fmtInt(s.lost)}</td>
                    <td className="num font-semibold">{fmtPct(s.win_rate_pct, 1)}</td>
                    <td className="num">{fmtBRL(s.won_value)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : <Empty>Sem negócios no mês.</Empty>}
        </Card>
        <Card title="Motivos de perda" aside="top 6">
          {reasons.length ? <HBars data={reasons.map((r) => ({ label: r.reason, value: r.n }))} format="int" color="var(--series-4)" /> : <Empty>Nenhuma perda registrada.</Empty>}
        </Card>
      </div>

      <Card title="Briefing da semana" aside="decisões pendentes" className="mt-4">
        {briefing.length ? (
          <ol className="grid gap-3 md:grid-cols-2">
            {briefing.map((b) => (
              <li key={b.id} className="flex gap-3 rounded-lg border border-line p-4">
                <span className="eyebrow mt-1 text-brand">{String(b.position).padStart(2, "0")}</span>
                <div><b>{b.title}</b>{b.detail && <div className="mt-1 text-[13px] text-ink-2">{b.detail}</div>}{b.product && <div className="eyebrow mt-2">{b.product}</div>}</div>
              </li>
            ))}
          </ol>
        ) : <Empty>Sem itens.</Empty>}
      </Card>
    </>
  );
}
