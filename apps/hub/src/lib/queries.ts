import { sql } from "./db";
import { monthStart, shiftMonth } from "./period";

export type Product = {
  id: string; slug: string; name: string; family: string; billing: string;
  delivery: string | null; target_margin_pct: number | null; list_price: number | null; sort_order: number;
};

export type ProductPnl = {
  product_id: string; slug: string; name: string; family: string; month: string;
  gross: number; deductions: number; taxes: number; net_revenue: number; ad_spend: number;
  people_cost: number; direct_costs: number; overhead_alloc: number; contribution_after_ads: number;
  profit: number; margin_pct: number | null; roas: number | null;
};

export type CompanyPnl = {
  month: string; gross: number; deductions: number; taxes: number; net_revenue: number; ad_spend: number;
  people_cost: number; direct_costs: number; overhead: number; profit: number;
  net_margin_pct: number | null; variable_cost_pct: number | null;
};

export type Level = "critico" | "atencao" | "saudavel";

const monthCol = (m: string) => sql`${monthStart(m)}::date`;

export async function listProducts() {
  return sql<Product[]>`select id, slug, name, family, billing, delivery, target_margin_pct, list_price, sort_order
    from hub.products where active order by sort_order`;
}

export async function companyPnl(month: string) {
  const [r] = await sql<CompanyPnl[]>`select month::text, gross, deductions, taxes, net_revenue, ad_spend, people_cost,
    direct_costs, overhead, profit, net_margin_pct, variable_cost_pct
    from hub.v_company_pnl_monthly where month = ${monthCol(month)}`;
  return r ?? null;
}

export async function companyPnlSeries(months = 6) {
  return sql<CompanyPnl[]>`select month::text, gross, deductions, taxes, net_revenue, ad_spend, people_cost,
    direct_costs, overhead, profit, net_margin_pct, variable_cost_pct
    from hub.v_company_pnl_monthly order by month desc limit ${months}`.then((r) => r.reverse());
}

export async function productPnl(month: string) {
  return sql<ProductPnl[]>`select v.product_id, v.slug, v.name, v.family::text, v.month::text, v.gross, v.deductions, v.taxes,
    v.net_revenue, v.ad_spend, v.people_cost, v.direct_costs, v.overhead_alloc, v.contribution_after_ads, v.profit,
    v.margin_pct, v.roas
    from hub.v_product_pnl_monthly v join hub.products p on p.id = v.product_id
    where v.month = ${monthCol(month)} order by p.sort_order`;
}

export async function productPnlSeries(slug: string, months = 6) {
  return sql<ProductPnl[]>`select product_id, slug, name, family::text, month::text, gross, deductions, taxes, net_revenue,
    ad_spend, people_cost, direct_costs, overhead_alloc, contribution_after_ads, profit, margin_pct, roas
    from hub.v_product_pnl_monthly where slug = ${slug} order by month desc limit ${months}`.then((r) => r.reverse());
}

/** Receita e vendas por produto até o dia `day` do mês (para comparar "mesmo período") */
export async function salesMonthToDate(month: string, day: number) {
  return sql<{ product_id: string; orders_count: number; gross: number }[]>`
    select product_id, count(*)::int as orders_count, coalesce(sum(gross_amount - discount_amount),0) as gross
    from hub.orders
    where status in ('approved','partially_refunded')
      and hub.month_of(sold_at) = ${monthCol(month)}
      and extract(day from sold_at at time zone 'America/Sao_Paulo') <= ${day}
    group by product_id`;
}

export async function cashByMonth(months = 6) {
  return sql<{ month: string; source: string; net_received: number; gross: number; fees: number; taxes: number }[]>`
    select month::text, source::text, sum(net_received) as net_received, sum(gross) as gross, sum(fees) as fees, sum(taxes) as taxes
    from hub.v_revenue_cash_monthly
    where month >= (date_trunc('month', now()) - (${months - 1} || ' month')::interval)::date
    group by 1,2 order by 1,2`;
}

export async function accrualByProductMonth(months = 6) {
  return sql<{ month: string; slug: string; name: string; gross: number; net: number }[]>`
    select v.month::text, p.slug, p.name, sum(v.gross) as gross, sum(v.net) as net
    from hub.v_revenue_accrual_monthly v join hub.products p on p.id = v.product_id
    where v.month >= (date_trunc('month', now()) - (${months - 1} || ' month')::interval)::date
    group by 1,2,3, p.sort_order order by 1, p.sort_order`;
}

export async function adSpendByAccount(month: string) {
  return sql<{ account_id: string; account: string; platform: string; slug: string | null; product: string | null;
    spend: number; leads: number; clicks: number; purchases: number; gross: number; cpl: number | null; roas: number | null }[]>`
    with s as (
      select a.id as account_id, a.name as account, a.platform::text, p.slug, p.name as product, a.product_id,
             sum(d.spend) as spend, sum(d.leads)::int as leads, sum(d.clicks)::int as clicks, sum(d.purchases)::int as purchases
      from hub.ad_spend_daily d join hub.ad_accounts a on a.id = d.ad_account_id
      left join hub.products p on p.id = a.product_id
      where date_trunc('month', d.day)::date = ${monthCol(month)}
      group by 1,2,3,4,5,6
    ), r as (
      select product_id, sum(gross) as gross from hub.v_revenue_accrual_monthly where month = ${monthCol(month)} group by 1
    )
    select s.account_id, s.account, s.platform, s.slug, s.product, s.spend, s.leads, s.clicks, s.purchases,
           coalesce(r.gross,0) as gross,
           case when s.leads > 0 then round((s.spend / s.leads)::numeric, 2) end as cpl,
           case when s.spend > 0 then round((coalesce(r.gross,0) / s.spend)::numeric, 2) end as roas
    from s left join r on r.product_id = s.product_id
    order by s.spend desc`;
}

export async function roasDaily(month: string, slug?: string) {
  return sql<{ day: string; spend: number; gross: number; leads: number; roas: number | null; cpl: number | null }[]>`
    select r.day::text, sum(r.spend) as spend, sum(r.gross) as gross, sum(r.leads)::int as leads,
           case when sum(r.spend) > 0 then round((sum(r.gross)/sum(r.spend))::numeric, 2) end as roas,
           case when sum(r.leads) > 0 then round((sum(r.spend)/sum(r.leads))::numeric, 2) end as cpl
    from hub.v_roas_daily r left join hub.products p on p.id = r.product_id
    where date_trunc('month', r.day)::date = ${monthCol(month)}
      and (${slug ?? null}::text is null or p.slug = ${slug ?? null})
    group by r.day order by r.day`;
}

export async function activeStudents() {
  return sql<{ product_id: string; slug: string; name: string; active_students: number }[]>`
    select product_id, slug, name, active_students::int from hub.v_active_students`;
}

export async function mrrSeries(months = 6) {
  return sql<{ month: string; slug: string; name: string; active_subs: number; mrr: number; new_subs: number;
    churned_subs: number; subs_start_of_month: number; churn_pct: number | null }[]>`
    select m.month::text, p.slug, p.name, m.active_subs::int, coalesce(m.mrr,0) as mrr, m.new_subs::int, m.churned_subs::int,
           m.subs_start_of_month::int,
           case when m.subs_start_of_month > 0 then round(100.0 * m.churned_subs / m.subs_start_of_month, 2) end as churn_pct
    from hub.v_mrr_monthly m join hub.products p on p.id = m.product_id
    where m.month >= (date_trunc('month', now()) - (${months - 1} || ' month')::interval)::date
    order by p.sort_order, m.month`;
}

export async function funnel(month: string) {
  return sql<{ pipeline_id: string; pipeline: string; slug: string | null; deals_created: number; won: number; lost: number;
    won_value: number; win_rate_pct: number | null; avg_days_to_win: number | null }[]>`
    select f.pipeline_id, f.pipeline, p.slug, sum(f.deals_created)::int as deals_created, sum(f.won)::int as won,
           sum(f.lost)::int as lost, coalesce(sum(f.won_value),0) as won_value,
           case when sum(f.deals_created) > 0 then round(100.0 * sum(f.won) / sum(f.deals_created), 1) end as win_rate_pct,
           round(avg(f.avg_days_to_win)::numeric, 1) as avg_days_to_win
    from hub.v_funnel_monthly f left join hub.products p on p.id = f.product_id
    where f.month = ${monthCol(month)}
    group by 1,2,3 order by deals_created desc`;
}

export async function funnelStages(month: string) {
  return sql<{ pipeline: string; stage: string; position: number; is_won: boolean; is_lost: boolean; deals: number }[]>`
    select pl.name as pipeline, s.name as stage, s.position, s.is_won, s.is_lost, count(d.id)::int as deals
    from hub.pipeline_stages s join hub.pipelines pl on pl.id = s.pipeline_id
    left join hub.deals d on d.stage_id = s.id and hub.month_of(d.created_at) = ${monthCol(month)}
    group by 1,2,3,4,5 order by pl.name, s.position`;
}

export async function sellersPerformance(month: string) {
  return sql<{ owner: string; deals: number; won: number; lost: number; won_value: number; win_rate_pct: number | null }[]>`
    select coalesce(u.name, 'Sem dono') as owner, count(*)::int as deals,
           count(*) filter (where d.won_at is not null)::int as won,
           count(*) filter (where d.lost_at is not null)::int as lost,
           coalesce(sum(d.value) filter (where d.won_at is not null),0) as won_value,
           round(100.0 * count(*) filter (where d.won_at is not null) / nullif(count(*),0), 1) as win_rate_pct
    from hub.deals d left join hub.users u on u.id = d.owner_user_id
    where hub.month_of(d.created_at) = ${monthCol(month)}
    group by 1 order by won desc`;
}

export async function lostReasons(month: string) {
  return sql<{ reason: string; n: number }[]>`
    select coalesce(lost_reason,'Não informado') as reason, count(*)::int as n
    from hub.deals where lost_at is not null and hub.month_of(created_at) = ${monthCol(month)}
    group by 1 order by n desc limit 6`;
}

export async function topLeads(limit = 5) {
  return sql<{ id: string; name: string | null; profession: string | null; state: string | null; product: string | null;
    origin: string | null; temperature: string | null; utm_campaign: string | null; score: number | null; created_at: string }[]>`
    select l.id, c.name, c.profession, c.state, p.name as product, l.origin, l.temperature, l.utm_campaign, l.score, l.created_at::text
    from hub.leads l left join hub.customers c on c.id = l.customer_id left join hub.products p on p.id = l.product_id
    where l.created_at >= now() - interval '7 days'
    order by l.score desc nulls last, l.created_at desc limit ${limit}`;
}

export async function integrations() {
  return sql<{ source: string; display_name: string; mode: string; enabled: boolean; last_success_at: string | null;
    last_error: string | null; last_status: string | null; last_rows: number | null }[]>`
    select i.source::text, i.display_name, i.mode, i.enabled, i.last_success_at::text, i.last_error,
           r.status as last_status, r.rows_upserted as last_rows
    from hub.integrations i
    left join lateral (select status, rows_upserted from hub.sync_runs where source = i.source order by started_at desc limit 1) r on true
    order by i.enabled desc, i.display_name`;
}

export async function latestVerdict() {
  const [v] = await sql<{ day: string; headline: string; body: string; generated_at: string; generated_by: string }[]>`
    select day::text, headline, body, generated_at::text, generated_by from hub.daily_verdicts order by day desc limit 1`;
  return v ?? null;
}

export async function briefingItems() {
  return sql<{ id: string; position: number; title: string; detail: string | null; product: string | null; decided: boolean }[]>`
    select b.id, b.position, b.title, b.detail, p.name as product, b.decided
    from hub.briefing_items b left join hub.products p on p.id = b.product_id
    where b.week_start = (select max(week_start) from hub.briefing_items)
    order by b.position`;
}

export async function targets(month: string) {
  return sql<{ product_id: string | null; metric: string; value: number }[]>`
    select product_id, metric, value from hub.targets where month = ${monthCol(month)}`;
}

export async function costBreakdown(month: string) {
  return sql<{ dre_group: string; kind: string; amount: number }[]>`
    select coalesce(c.dre_group, 'Outros') as dre_group, coalesce(c.kind::text, 'other') as kind, sum(e.amount) as amount
    from hub.cost_entries e left join hub.cost_categories c on c.id = e.category_id
    where e.competence_month = ${monthCol(month)}
    group by 1,2 order by amount desc`;
}

export async function teamCostByDepartment(month: string) {
  return sql<{ department: string; people: number; amount: number }[]>`
    select department, count(*)::int as people, sum(monthly_cost) as amount
    from hub.team_members
    where started_on <= (${monthCol(month)} + interval '1 month - 1 day')::date and (ended_on is null or ended_on >= ${monthCol(month)})
    group by 1 order by amount desc`;
}

export async function deductionsBreakdown(month: string) {
  return sql<{ kind: string; amount: number }[]>`
    select d.kind::text, sum(d.amount) as amount
    from hub.order_deductions d join hub.orders o on o.id = d.order_id
    where hub.month_of(o.sold_at) = ${monthCol(month)}
    group by 1 order by amount desc`;
}

export async function recentOrders(limit = 12, slug?: string) {
  return sql<{ id: string; sold_at: string; product: string; customer: string | null; gross: number; status: string;
    method: string | null; installments: number; source: string; utm_source: string | null }[]>`
    select o.id, o.sold_at::text, p.name as product, c.name as customer, (o.gross_amount - o.discount_amount) as gross,
           o.status::text, o.payment_method::text as method, o.installments, o.source::text, o.utm_source
    from hub.orders o join hub.products p on p.id = o.product_id left join hub.customers c on c.id = o.customer_id
    where (${slug ?? null}::text is null or p.slug = ${slug ?? null})
    order by o.sold_at desc limit ${limit}`;
}

/** Classificação de saúde do produto a partir da margem vs. meta */
export function levelFor(p: { margin_pct: number | null; gross: number }, target: number | null): Level {
  if (p.gross <= 0) return "atencao";
  const t = target ?? 30;
  if (p.margin_pct == null) return "atencao";
  if (p.margin_pct < Math.min(10, t / 3)) return "critico";
  if (p.margin_pct < t) return "atencao";
  return "saudavel";
}

export const prevMonth = shiftMonth;
