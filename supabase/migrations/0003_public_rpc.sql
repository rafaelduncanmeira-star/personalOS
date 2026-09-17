-- =============================================================================
-- Camada de leitura via PostgREST: funções em `public` (schema exposto por padrão)
-- que leem o schema `hub` como o usuário logado (security invoker → RLS por papel).
-- O app chama estas funções com a sessão do usuário; nenhum segredo fica no servidor web.
-- =============================================================================

-- Liga o usuário autenticado ao cadastro do hub pelo e-mail e devolve o registro.
create or replace function public.hub_me()
returns table (id uuid, email text, name text, role text)
language plpgsql security definer set search_path = hub, public as $$
begin
  update hub.users u set auth_user_id = auth.uid()
   where u.auth_user_id is null and u.active and lower(u.email) = lower(coalesce(auth.jwt()->>'email', ''));
  return query select u.id, u.email, u.name, u.role::text from hub.users u where u.auth_user_id = auth.uid() and u.active;
end $$;

create or replace function public.hub_products()
returns table (id uuid, slug text, name text, family text, billing text, delivery text, target_margin_pct numeric, list_price numeric, sort_order int)
language sql stable security invoker set search_path = hub, public as $$
  select id, slug, name, family::text, billing::text, delivery::text, target_margin_pct, list_price, sort_order
  from hub.products where active order by sort_order
$$;

create or replace function public.hub_company_pnl(p_month date)
returns table (month text, gross numeric, deductions numeric, taxes numeric, net_revenue numeric, ad_spend numeric,
  people_cost numeric, direct_costs numeric, overhead numeric, profit numeric, net_margin_pct numeric, variable_cost_pct numeric)
language sql stable security invoker set search_path = hub, public as $$
  select month::text, gross, deductions, taxes, net_revenue, ad_spend, people_cost, direct_costs, overhead, profit, net_margin_pct, variable_cost_pct
  from hub.v_company_pnl_monthly where month = p_month
$$;

create or replace function public.hub_company_pnl_series(p_months int default 6)
returns table (month text, gross numeric, deductions numeric, taxes numeric, net_revenue numeric, ad_spend numeric,
  people_cost numeric, direct_costs numeric, overhead numeric, profit numeric, net_margin_pct numeric, variable_cost_pct numeric)
language sql stable security invoker set search_path = hub, public as $$
  select * from (
    select month::text, gross, deductions, taxes, net_revenue, ad_spend, people_cost, direct_costs, overhead, profit, net_margin_pct, variable_cost_pct
    from hub.v_company_pnl_monthly order by month desc limit p_months) s order by month
$$;

create or replace function public.hub_product_pnl(p_month date)
returns table (product_id uuid, slug text, name text, family text, month text, gross numeric, deductions numeric, taxes numeric,
  net_revenue numeric, ad_spend numeric, people_cost numeric, direct_costs numeric, overhead_alloc numeric,
  contribution_after_ads numeric, profit numeric, margin_pct numeric, roas numeric)
language sql stable security invoker set search_path = hub, public as $$
  select v.product_id, v.slug, v.name, v.family::text, v.month::text, v.gross, v.deductions, v.taxes, v.net_revenue, v.ad_spend,
         v.people_cost, v.direct_costs, v.overhead_alloc, v.contribution_after_ads, v.profit, v.margin_pct, v.roas
  from hub.v_product_pnl_monthly v join hub.products p on p.id = v.product_id
  where v.month = p_month order by p.sort_order
$$;

create or replace function public.hub_product_pnl_series(p_slug text, p_months int default 6)
returns table (product_id uuid, slug text, name text, family text, month text, gross numeric, deductions numeric, taxes numeric,
  net_revenue numeric, ad_spend numeric, people_cost numeric, direct_costs numeric, overhead_alloc numeric,
  contribution_after_ads numeric, profit numeric, margin_pct numeric, roas numeric)
language sql stable security invoker set search_path = hub, public as $$
  select * from (
    select product_id, slug, name, family::text, month::text, gross, deductions, taxes, net_revenue, ad_spend, people_cost,
           direct_costs, overhead_alloc, contribution_after_ads, profit, margin_pct, roas
    from hub.v_product_pnl_monthly where slug = p_slug order by month desc limit p_months) s order by month
$$;

create or replace function public.hub_sales_mtd(p_month date, p_day int)
returns table (product_id uuid, orders_count int, gross numeric)
language sql stable security invoker set search_path = hub, public as $$
  select product_id, count(*)::int, coalesce(sum(gross_amount - discount_amount),0)
  from hub.orders
  where status in ('approved','partially_refunded') and hub.month_of(sold_at) = p_month
    and extract(day from sold_at at time zone 'America/Sao_Paulo') <= p_day
  group by product_id
$$;

create or replace function public.hub_cash_by_month(p_months int default 6)
returns table (month text, source text, net_received numeric, gross numeric, fees numeric, taxes numeric)
language sql stable security invoker set search_path = hub, public as $$
  select month::text, source::text, sum(net_received), sum(gross), sum(fees), sum(taxes)
  from hub.v_revenue_cash_monthly
  where month >= (date_trunc('month', now()) - ((p_months - 1) || ' month')::interval)::date
  group by 1,2 order by 1,2
$$;

create or replace function public.hub_accrual_by_product_month(p_months int default 6)
returns table (month text, slug text, name text, gross numeric, net numeric)
language sql stable security invoker set search_path = hub, public as $$
  select v.month::text, p.slug, p.name, sum(v.gross), sum(v.net)
  from hub.v_revenue_accrual_monthly v join hub.products p on p.id = v.product_id
  where v.month >= (date_trunc('month', now()) - ((p_months - 1) || ' month')::interval)::date
  group by 1,2,3, p.sort_order order by 1, p.sort_order
$$;

create or replace function public.hub_ad_spend_by_account(p_month date)
returns table (account_id uuid, account text, platform text, slug text, product text, spend numeric, leads int, clicks int,
  purchases int, gross numeric, cpl numeric, roas numeric)
language sql stable security invoker set search_path = hub, public as $$
  with s as (
    select a.id as account_id, a.name as account, a.platform::text as platform, p.slug, p.name as product, a.product_id,
           sum(d.spend) as spend, sum(d.leads)::int as leads, sum(d.clicks)::int as clicks, sum(d.purchases)::int as purchases
    from hub.ad_spend_daily d join hub.ad_accounts a on a.id = d.ad_account_id
    left join hub.products p on p.id = a.product_id
    where date_trunc('month', d.day)::date = p_month
    group by 1,2,3,4,5,6
  ), r as (
    select product_id, sum(gross) as gross from hub.v_revenue_accrual_monthly where month = p_month group by 1
  )
  select s.account_id, s.account, s.platform, s.slug, s.product, s.spend, s.leads, s.clicks, s.purchases,
         coalesce(r.gross,0),
         case when s.leads > 0 then round((s.spend / s.leads)::numeric, 2) end,
         case when s.spend > 0 then round((coalesce(r.gross,0) / s.spend)::numeric, 2) end
  from s left join r on r.product_id = s.product_id
  order by s.spend desc
$$;

create or replace function public.hub_roas_daily(p_month date, p_slug text default null)
returns table (day text, spend numeric, gross numeric, leads int, roas numeric, cpl numeric)
language sql stable security invoker set search_path = hub, public as $$
  select r.day::text, sum(r.spend), sum(r.gross), sum(r.leads)::int,
         case when sum(r.spend) > 0 then round((sum(r.gross)/sum(r.spend))::numeric, 2) end,
         case when sum(r.leads) > 0 then round((sum(r.spend)/sum(r.leads))::numeric, 2) end
  from hub.v_roas_daily r left join hub.products p on p.id = r.product_id
  where date_trunc('month', r.day)::date = p_month and (p_slug is null or p.slug = p_slug)
  group by r.day order by r.day
$$;

create or replace function public.hub_active_students()
returns table (product_id uuid, slug text, name text, active_students int)
language sql stable security invoker set search_path = hub, public as $$
  select product_id, slug, name, active_students::int from hub.v_active_students
$$;

create or replace function public.hub_mrr_series(p_months int default 6)
returns table (month text, slug text, name text, active_subs int, mrr numeric, new_subs int, churned_subs int,
  subs_start_of_month int, churn_pct numeric)
language sql stable security invoker set search_path = hub, public as $$
  select m.month::text, p.slug, p.name, m.active_subs::int, coalesce(m.mrr,0), m.new_subs::int, m.churned_subs::int,
         m.subs_start_of_month::int,
         case when m.subs_start_of_month > 0 then round(100.0 * m.churned_subs / m.subs_start_of_month, 2) end
  from hub.v_mrr_monthly m join hub.products p on p.id = m.product_id
  where m.month >= (date_trunc('month', now()) - ((p_months - 1) || ' month')::interval)::date
  order by p.sort_order, m.month
$$;

create or replace function public.hub_funnel(p_month date)
returns table (pipeline_id uuid, pipeline text, slug text, deals_created int, won int, lost int, won_value numeric,
  win_rate_pct numeric, avg_days_to_win numeric)
language sql stable security invoker set search_path = hub, public as $$
  select f.pipeline_id, f.pipeline, p.slug, sum(f.deals_created)::int, sum(f.won)::int, sum(f.lost)::int,
         coalesce(sum(f.won_value),0),
         case when sum(f.deals_created) > 0 then round(100.0 * sum(f.won) / sum(f.deals_created), 1) end,
         round(avg(f.avg_days_to_win)::numeric, 1)
  from hub.v_funnel_monthly f left join hub.products p on p.id = f.product_id
  where f.month = p_month
  group by 1,2,3 order by 4 desc
$$;

create or replace function public.hub_funnel_stages(p_month date)
returns table (pipeline text, stage text, "position" int, is_won boolean, is_lost boolean, deals int)
language sql stable security invoker set search_path = hub, public as $$
  select pl.name, s.name, s.position, s.is_won, s.is_lost, count(d.id)::int
  from hub.pipeline_stages s join hub.pipelines pl on pl.id = s.pipeline_id
  left join hub.deals d on d.stage_id = s.id and hub.month_of(d.created_at) = p_month
  group by 1,2,3,4,5 order by pl.name, s.position
$$;

create or replace function public.hub_sellers_performance(p_month date)
returns table (owner text, deals int, won int, lost int, won_value numeric, win_rate_pct numeric)
language sql stable security invoker set search_path = hub, public as $$
  select coalesce(u.name, 'Sem dono'), count(*)::int,
         count(*) filter (where d.won_at is not null)::int,
         count(*) filter (where d.lost_at is not null)::int,
         coalesce(sum(d.value) filter (where d.won_at is not null),0),
         round(100.0 * count(*) filter (where d.won_at is not null) / nullif(count(*),0), 1)
  from hub.deals d left join hub.users u on u.id = d.owner_user_id
  where hub.month_of(d.created_at) = p_month
  group by 1 order by 3 desc
$$;

create or replace function public.hub_lost_reasons(p_month date)
returns table (reason text, n int)
language sql stable security invoker set search_path = hub, public as $$
  select coalesce(lost_reason,'Não informado'), count(*)::int
  from hub.deals where lost_at is not null and hub.month_of(created_at) = p_month
  group by 1 order by 2 desc limit 6
$$;

create or replace function public.hub_top_leads(p_limit int default 5)
returns table (id uuid, name text, profession text, state text, product text, origin text, temperature text,
  utm_campaign text, score int, created_at text)
language sql stable security invoker set search_path = hub, public as $$
  select l.id, c.name, c.profession, c.state, p.name, l.origin, l.temperature, l.utm_campaign, l.score, l.created_at::text
  from hub.leads l left join hub.customers c on c.id = l.customer_id left join hub.products p on p.id = l.product_id
  where l.created_at >= now() - interval '7 days'
  order by l.score desc nulls last, l.created_at desc limit p_limit
$$;

create or replace function public.hub_integrations()
returns table (source text, display_name text, mode text, enabled boolean, last_success_at text, last_error text,
  last_status text, last_rows int)
language sql stable security invoker set search_path = hub, public as $$
  select i.source::text, i.display_name, i.mode, i.enabled, i.last_success_at::text, i.last_error, r.status, r.rows_upserted
  from hub.integrations i
  left join lateral (select status, rows_upserted from hub.sync_runs where source = i.source order by started_at desc limit 1) r on true
  order by i.enabled desc, i.display_name
$$;

create or replace function public.hub_latest_verdict()
returns table (day text, headline text, body text, generated_at text, generated_by text)
language sql stable security invoker set search_path = hub, public as $$
  select day::text, headline, body, generated_at::text, generated_by from hub.daily_verdicts order by day desc limit 1
$$;

create or replace function public.hub_briefing_items()
returns table (id uuid, "position" int, title text, detail text, product text, decided boolean)
language sql stable security invoker set search_path = hub, public as $$
  select b.id, b.position, b.title, b.detail, p.name, b.decided
  from hub.briefing_items b left join hub.products p on p.id = b.product_id
  where b.week_start = (select max(week_start) from hub.briefing_items)
  order by b.position
$$;

create or replace function public.hub_targets(p_month date)
returns table (product_id uuid, metric text, value numeric)
language sql stable security invoker set search_path = hub, public as $$
  select product_id, metric, value from hub.targets where month = p_month
$$;

create or replace function public.hub_cost_breakdown(p_month date)
returns table (dre_group text, kind text, amount numeric)
language sql stable security invoker set search_path = hub, public as $$
  select coalesce(c.dre_group, 'Outros'), coalesce(c.kind::text, 'other'), sum(e.amount)
  from hub.cost_entries e left join hub.cost_categories c on c.id = e.category_id
  where e.competence_month = p_month
  group by 1,2 order by 3 desc
$$;

create or replace function public.hub_team_cost_by_department(p_month date)
returns table (department text, people int, amount numeric)
language sql stable security invoker set search_path = hub, public as $$
  select department, count(*)::int, sum(monthly_cost)
  from hub.team_members
  where started_on <= (p_month + interval '1 month - 1 day')::date and (ended_on is null or ended_on >= p_month)
  group by 1 order by 3 desc
$$;

create or replace function public.hub_deductions_breakdown(p_month date)
returns table (kind text, amount numeric)
language sql stable security invoker set search_path = hub, public as $$
  select d.kind::text, sum(d.amount)
  from hub.order_deductions d join hub.orders o on o.id = d.order_id
  where hub.month_of(o.sold_at) = p_month
  group by 1 order by 2 desc
$$;

create or replace function public.hub_recent_orders(p_limit int default 12, p_slug text default null)
returns table (id uuid, sold_at text, product text, customer text, gross numeric, status text, method text,
  installments int, source text, utm_source text)
language sql stable security invoker set search_path = hub, public as $$
  select o.id, o.sold_at::text, p.name, c.name, (o.gross_amount - o.discount_amount), o.status::text, o.payment_method::text,
         o.installments, o.source::text, o.utm_source
  from hub.orders o join hub.products p on p.id = o.product_id left join hub.customers c on c.id = o.customer_id
  where (p_slug is null or p.slug = p_slug)
  order by o.sold_at desc limit p_limit
$$;

-- Só usuários logados podem chamar; anon não.
do $$
declare f record;
begin
  for f in select p.oid::regprocedure as sig from pg_proc p join pg_namespace n on n.oid = p.pronamespace
           where n.nspname = 'public' and p.proname like 'hub\_%' loop
    execute format('revoke all on function %s from public, anon', f.sig);
    execute format('grant execute on function %s to authenticated, service_role', f.sig);
  end loop;
end $$;
