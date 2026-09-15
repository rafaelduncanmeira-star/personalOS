import Link from "next/link";
import { PageHeader } from "@/components/page-header";
import { BarChart } from "@/components/charts";
import { Card, Delta, Empty, Kpi, ProductLink, StatusPill } from "@/components/ui";
import { getCurrentUser } from "@/lib/auth";
import { dateLong, delta, fmtBRL, fmtBRLCompact, fmtInt, fmtPct, fmtX, monthLabel, monthShort, timeShort } from "@/lib/format";
import { currentMonth, dayCut, parseMonth, shiftMonth, todaySP } from "@/lib/period";
import {
  accrualByProductMonth, activeStudents, adSpendByAccount, briefingItems, companyPnl, latestVerdict, levelFor,
  productPnl, salesMonthToDate, targets, topLeads, type Level,
} from "@/lib/queries";

const greeting = () => {
  const h = todaySP().getHours();
  return h < 12 ? "Bom dia" : h < 18 ? "Boa tarde" : "Boa noite";
};

export default async function Home({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const sp = await searchParams;
  const month = parseMonth(sp.mes);
  const prev = shiftMonth(month, -1);
  const day = dayCut(month);
  const user = (await getCurrentUser())!;

  const [pnl, pnlPrev, products, mtd, mtdPrev, verdict, briefing, accounts, leads, tgts, series, students] =
    await Promise.all([
      companyPnl(month), companyPnl(prev), productPnl(month), salesMonthToDate(month, day),
      salesMonthToDate(prev, day), latestVerdict(), briefingItems(), adSpendByAccount(month), topLeads(5), targets(month),
      accrualByProductMonth(4), activeStudents(),
    ]);

  const sumMtd = (rows: typeof mtd) => rows.reduce((a, r) => a + r.gross, 0);
  const grossMtd = sumMtd(mtd), grossMtdPrev = sumMtd(mtdPrev);
  const adSpend = pnl?.ad_spend ?? 0, adSpendPrev = pnlPrev?.ad_spend ?? 0;
  const roas = adSpend > 0 ? grossMtd / adSpend : null;
  const roasPrev = adSpendPrev > 0 ? grossMtdPrev / adSpendPrev : null;
  const varTarget = tgts.find((t) => !t.product_id && t.metric === "variable_cost_pct")?.value ?? null;
  const varPct = pnl?.variable_cost_pct ?? null;
  const activeAccounts = accounts.filter((a) => a.spend > 0).length;
  const totalLeads = accounts.reduce((a, r) => a + r.leads, 0);
  const cplAvg = totalLeads > 0 ? adSpend / totalLeads : null;
  const totalStudents = students.reduce((a, s) => a + s.active_students, 0);

  const targetFor = (id: string) => tgts.find((t) => t.product_id === id && t.metric === "margin_pct")?.value ?? null;
  const withLevel = products.map((p) => ({ ...p, level: levelFor(p, targetFor(p.product_id)) as Level }));
  const order: Level[] = ["critico", "atencao", "saudavel"];
  const statusCards = order.map((l) => withLevel.filter((p) => p.level === l && p.gross > 0).sort((a, b) => b.gross - a.gross)[0]).filter(Boolean);

  // Produto em destaque: maior crescimento de receita vs. mês anterior
  // comparação no mesmo período (até o dia `day`) para não confundir mês parcial com mês cheio
  const growth = products.map((p) => {
    const cur = mtd.find((r) => r.product_id === p.product_id)?.gross ?? 0;
    const before = mtdPrev.find((r) => r.product_id === p.product_id)?.gross ?? 0;
    return { ...p, gross: cur, before, growth: before > 0 && cur > 0 ? (cur - before) / before : null };
  }).filter((p) => p.growth != null && p.growth > 0 && p.gross >= 5000).sort((a, b) => (b.growth ?? 0) - (a.growth ?? 0))[0];
  const months = Array.from(new Set(series.map((s) => s.month))).sort();
  const daysInMonth = new Date(Number(month.slice(0, 4)), Number(month.slice(5, 7)), 0).getDate();
  const spotlightBars = growth ? months.map((m) => {
    const v = series.find((s) => s.month === m && s.slug === growth.slug)?.gross ?? 0;
    return { label: monthShort(m), value: v, highlight: m === month, note: `${monthLabel(m)}: ${fmtBRL(v)}` };
  }) : [];
  const projection = growth && month === currentMonth() ? (growth.gross / day) * daysInMonth : null;
  if (growth && projection && month === currentMonth()) {
    spotlightBars.push({ label: monthShort(shiftMonth(month, 1)), value: projection, highlight: false, note: `Projeção: ${fmtBRL(projection)}` });
  }

  const now = new Date();
  return (
    <>
      <PageHeader
        title={`${greeting()}, ${user.name.split(" ")[0]}.`}
        subtitle={`${dateLong(now)} · dados atualizados às ${timeShort(now)}`}
        month={month}
        extra={<span className="btn btn-ghost">Todos os produtos</span>}
      />

      <div className="grid grid-cols-2 gap-4 xl:grid-cols-4">
        <Kpi label="Receita do mês" value={fmtBRLCompact(grossMtd)} sub={<><Delta value={delta(grossMtd, grossMtdPrev)} /> vs. mesmo período de {monthLabel(prev).split(" ")[0]}</>} />
        <Kpi label="Investido em mídia" value={fmtBRLCompact(adSpend)} sub={`${activeAccounts} contas ativas · CPL médio ${cplAvg ? fmtBRL(cplAvg) : "—"}`} />
        <Kpi label="ROAS geral" value={fmtX(roas)} tone={roas != null && roas >= 3 ? "good" : "neutral"}
          sub={roas != null && roasPrev != null ? <><Delta value={((roas - roasPrev) / roasPrev) * 100} /> vs. {monthLabel(prev).split(" ")[0]}</> : "sem base de comparação"} />
        <Kpi label="Custo variável" value={fmtPct(varPct)} tone={varPct != null && varTarget != null && varPct > varTarget ? "bad" : "neutral"}
          sub={varTarget != null && varPct != null ? <><Delta value={varPct - varTarget} suffix=" p.p." invert digits={1} /> {varPct > varTarget ? "acima" : "abaixo"} da meta de {fmtPct(varTarget)}</> : "sem meta cadastrada"} />
      </div>

      <div className="mt-4 grid gap-4 xl:grid-cols-[3fr_2fr]">
        <Card title="Veredito do dia" aside={verdict ? `Gerado às ${timeShort(new Date(verdict.generated_at))} · ${verdict.generated_by === "rules" ? "regras" : verdict.generated_by}` : "sem veredito"}>
          {verdict ? (
            <div className="border-l-[3px] border-brand pl-4">
              <p className="text-[15px] leading-relaxed"><b>{verdict.headline}.</b> {verdict.body}</p>
              <div className="eyebrow mt-3">Veredito automático · atualizado todo dia às 04h</div>
            </div>
          ) : <Empty>O veredito diário aparece aqui quando a rotina das 04h rodar.</Empty>}
          <div className="mt-5 grid gap-3 sm:grid-cols-3">
            {statusCards.map((p) => (
              <Link key={p.product_id} href={`/produtos/${p.slug}`} className={`rounded-xl border p-4 hover:bg-surface-2 ${p.level === "critico" ? "border-bad/50" : p.level === "atencao" ? "border-warn/50" : "border-good/50"}`}>
                <StatusPill level={p.level} />
                <div className="mt-2 font-semibold">{p.name}</div>
                <div className="mt-0.5 text-[12px] text-ink-3">Margem {fmtPct(p.margin_pct)} · meta {fmtPct(targetFor(p.product_id))} · ROAS {fmtX(p.roas)}</div>
              </Link>
            ))}
          </div>
        </Card>

        <Card title="Briefing de segunda" aside={briefing.length ? "Semana atual" : ""}>
          {briefing.length ? (
            <ol className="space-y-3">
              {briefing.map((b) => (
                <li key={b.id} className="flex gap-3 text-[14px]">
                  <span className="eyebrow mt-1 w-5 shrink-0 text-brand">{String(b.position).padStart(2, "0")}</span>
                  <div className={b.decided ? "line-through text-ink-3" : ""}><b>{b.title}</b>{b.detail && <> — {b.detail}</>}</div>
                </li>
              ))}
            </ol>
          ) : <Empty>Sem itens para esta semana.</Empty>}
          <Link href="/comercial" className="btn btn-brand mt-5 w-full">Abrir briefing completo</Link>
        </Card>
      </div>

      {growth && (
        <Card highlight className="mt-4">
          <div className="grid gap-6 lg:grid-cols-[3fr_2fr] lg:items-center">
            <div>
              <h2 className="text-[19px] font-semibold tracking-tight">{growth.name} · o produto que mais cresce</h2>
              <p className="mt-2 text-[15px] leading-relaxed text-ink-2">
                De <b className="text-ink">{fmtBRL(growth.before)}</b> em {monthLabel(prev).split(" ")[0]} para <b className="text-ink">{fmtBRL(growth.gross)}</b> em {monthLabel(month).split(" ")[0]}
                {month === currentMonth() && <> nos primeiros {day} dias</>}. Crescimento de <b className="text-ink">{fmtPct((growth.growth ?? 0) * 100)}</b>.
              </p>
              {projection && <div className="eyebrow mt-3">Tendência para o mês · <span className="text-brand">{fmtBRL(projection)}</span> · projeção linear</div>}
            </div>
            <BarChart data={spotlightBars} format="brlc" height={150} projectedLast={!!projection} />
          </div>
        </Card>
      )}

      <Card title="Vendas por produto" aside="Guru · Asaas · VUMP — competência" className="mt-4">
        <div className="overflow-x-auto">
          <table className="data">
            <thead><tr><th>Produto</th><th className="num">Vendas</th><th className="num">Receita</th><th className="num">vs. mês ant.</th><th className="num">Mídia</th><th className="num">ROAS</th><th className="num">Margem</th><th className="num">Alunos ativos</th><th className="num">Status</th></tr></thead>
            <tbody>
              {withLevel.filter((p) => p.gross > 0 || p.ad_spend > 0).map((p) => {
                const cur = mtd.find((r) => r.product_id === p.product_id);
                const bef = mtdPrev.find((r) => r.product_id === p.product_id);
                const st = students.find((s) => s.product_id === p.product_id);
                return (
                  <tr key={p.product_id}>
                    <td><ProductLink slug={p.slug}>{p.name}</ProductLink><div className="eyebrow mt-0.5">{p.family.replace("_", " ")}</div></td>
                    <td className="num">{fmtInt(cur?.orders_count ?? 0)}</td>
                    <td className="num">{fmtBRL(p.gross)}</td>
                    <td className="num"><Delta value={delta(cur?.gross ?? 0, bef?.gross ?? 0)} /></td>
                    <td className="num">{fmtBRL(p.ad_spend)}</td>
                    <td className={`num ${p.roas != null && p.roas < 2 ? "text-bad" : p.roas != null ? "text-accent" : ""}`}>{fmtX(p.roas)}</td>
                    <td className="num">{fmtPct(p.margin_pct)}</td>
                    <td className="num">{st ? fmtInt(st.active_students) : "—"}</td>
                    <td className="num"><StatusPill level={p.level} /></td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <div className="eyebrow mt-3">{fmtInt(totalStudents)} alunos ativos no total · matriculados com acesso vigente</div>
      </Card>

      <div className="mt-4 grid gap-4 xl:grid-cols-[3fr_2fr]">
        <Card title="Tráfego por conta de anúncio" aside="Meta + Google · direto na API">
          {accounts.length ? (
            <div className="overflow-x-auto">
              <table className="data">
                <thead><tr><th>Conta</th><th className="num">Investido</th><th className="num">Leads</th><th className="num">CPL</th><th className="num">ROAS</th></tr></thead>
                <tbody>
                  {accounts.map((a) => (
                    <tr key={a.account_id}>
                      <td><b>{a.account}</b></td>
                      <td className="num">{fmtBRL(a.spend)}</td>
                      <td className="num">{fmtInt(a.leads)}</td>
                      <td className="num">{fmtBRL(a.cpl)}</td>
                      <td className={`num font-semibold ${a.roas != null && a.roas < 2 ? "text-bad" : "text-accent"}`}>{fmtX(a.roas)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : <Empty>Nenhuma conta de anúncio sincronizada neste mês.</Empty>}
        </Card>
        <Card title="Top leads da semana" aside="Score · origem · público">
          {leads.length ? (
            <ul className="divide-y divide-line">
              {leads.map((l) => (
                <li key={l.id} className="flex items-center gap-3 py-3">
                  <span className="grid h-9 w-9 shrink-0 place-items-center rounded-md border border-accent/50 text-[13px] font-bold text-accent tnum">{l.score ?? "—"}</span>
                  <div className="min-w-0">
                    <div className="truncate font-semibold">{[l.profession, l.product, l.state].filter(Boolean).join(" · ")}</div>
                    <div className="eyebrow mt-0.5 truncate">{[l.origin, l.temperature, l.utm_campaign].filter(Boolean).join(" · ")}</div>
                  </div>
                </li>
              ))}
            </ul>
          ) : <Empty>Sem leads novos nos últimos 7 dias.</Empty>}
        </Card>
      </div>

      <footer className="eyebrow mt-8 flex flex-wrap justify-between gap-2">
        <span>Geri Hub · painel de gestão GeriClass</span>
        <span className="text-brand">Identidade GeriClass</span>
      </footer>
    </>
  );
}
