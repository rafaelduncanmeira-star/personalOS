import { rpc, rpcOne } from "./rpc";
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

const m = (month: string) => monthStart(month);

export const listProducts = () => rpc<Product>("hub_products");
export const companyPnl = (month: string) => rpcOne<CompanyPnl>("hub_company_pnl", { p_month: m(month) });
export const companyPnlSeries = (months = 6) => rpc<CompanyPnl>("hub_company_pnl_series", { p_months: months });
export const productPnl = (month: string) => rpc<ProductPnl>("hub_product_pnl", { p_month: m(month) });
export const productPnlSeries = (slug: string, months = 6) => rpc<ProductPnl>("hub_product_pnl_series", { p_slug: slug, p_months: months });

/** Receita e vendas por produto até o dia `day` do mês (para comparar "mesmo período") */
export const salesMonthToDate = (month: string, day: number) =>
  rpc<{ product_id: string; orders_count: number; gross: number }>("hub_sales_mtd", { p_month: m(month), p_day: day });

export const cashByMonth = (months = 6) =>
  rpc<{ month: string; source: string; net_received: number; gross: number; fees: number; taxes: number }>("hub_cash_by_month", { p_months: months });

export const accrualByProductMonth = (months = 6) =>
  rpc<{ month: string; slug: string; name: string; gross: number; net: number }>("hub_accrual_by_product_month", { p_months: months });

export const adSpendByAccount = (month: string) =>
  rpc<{ account_id: string; account: string; platform: string; slug: string | null; product: string | null; spend: number; leads: number;
    clicks: number; purchases: number; gross: number; cpl: number | null; roas: number | null }>("hub_ad_spend_by_account", { p_month: m(month) });

export const roasDaily = (month: string, slug?: string) =>
  rpc<{ day: string; spend: number; gross: number; leads: number; roas: number | null; cpl: number | null }>("hub_roas_daily", { p_month: m(month), p_slug: slug ?? null });

export const activeStudents = () => rpc<{ product_id: string; slug: string; name: string; active_students: number }>("hub_active_students");

export const mrrSeries = (months = 6) =>
  rpc<{ month: string; slug: string; name: string; active_subs: number; mrr: number; new_subs: number; churned_subs: number;
    subs_start_of_month: number; churn_pct: number | null }>("hub_mrr_series", { p_months: months });

export const funnel = (month: string) =>
  rpc<{ pipeline_id: string; pipeline: string; slug: string | null; deals_created: number; won: number; lost: number; won_value: number;
    win_rate_pct: number | null; avg_days_to_win: number | null }>("hub_funnel", { p_month: m(month) });

export const funnelStages = (month: string) =>
  rpc<{ pipeline: string; stage: string; position: number; is_won: boolean; is_lost: boolean; deals: number }>("hub_funnel_stages", { p_month: m(month) });

export const sellersPerformance = (month: string) =>
  rpc<{ owner: string; deals: number; won: number; lost: number; won_value: number; win_rate_pct: number | null }>("hub_sellers_performance", { p_month: m(month) });

export const lostReasons = (month: string) => rpc<{ reason: string; n: number }>("hub_lost_reasons", { p_month: m(month) });

export const topLeads = (limit = 5) =>
  rpc<{ id: string; name: string | null; profession: string | null; state: string | null; product: string | null; origin: string | null;
    temperature: string | null; utm_campaign: string | null; score: number | null; created_at: string }>("hub_top_leads", { p_limit: limit });

export const integrations = () =>
  rpc<{ source: string; display_name: string; mode: string; enabled: boolean; last_success_at: string | null; last_error: string | null;
    last_status: string | null; last_rows: number | null }>("hub_integrations");

export const latestVerdict = () =>
  rpcOne<{ day: string; headline: string; body: string; generated_at: string; generated_by: string }>("hub_latest_verdict");

export const briefingItems = () =>
  rpc<{ id: string; position: number; title: string; detail: string | null; product: string | null; decided: boolean }>("hub_briefing_items");

export const targets = (month: string) => rpc<{ product_id: string | null; metric: string; value: number }>("hub_targets", { p_month: m(month) });
export const costBreakdown = (month: string) => rpc<{ dre_group: string; kind: string; amount: number }>("hub_cost_breakdown", { p_month: m(month) });
export const teamCostByDepartment = (month: string) => rpc<{ department: string; people: number; amount: number }>("hub_team_cost_by_department", { p_month: m(month) });
export const deductionsBreakdown = (month: string) => rpc<{ kind: string; amount: number }>("hub_deductions_breakdown", { p_month: m(month) });

export const recentOrders = (limit = 12, slug?: string) =>
  rpc<{ id: string; sold_at: string; product: string; customer: string | null; gross: number; status: string; method: string | null;
    installments: number; source: string; utm_source: string | null }>("hub_recent_orders", { p_limit: limit, p_slug: slug ?? null });

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
