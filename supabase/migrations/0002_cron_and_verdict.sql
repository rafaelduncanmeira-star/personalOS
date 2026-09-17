-- =============================================================================
-- Agendamentos (pg_cron + pg_net) e veredito diário por regras
-- Requer: extensões pg_cron e pg_net habilitadas no projeto Supabase.
-- Antes de agendar, informe a URL do projeto e a chave anon:
--   insert into hub.cron_config (key, value) values ('functions_url', 'https://<ref>.supabase.co/functions/v1'), ('anon_key', '<anon>');
-- =============================================================================

create table if not exists hub.cron_config (key text primary key, value text not null);
alter table hub.cron_config enable row level security;
drop policy if exists admin_cron_config on hub.cron_config;
create policy admin_cron_config on hub.cron_config for all to authenticated using (hub.is_admin()) with check (hub.is_admin());

create or replace function hub.call_function(p_name text) returns bigint
language plpgsql security definer set search_path = hub, public, net as $$
declare v_url text; v_key text; v_id bigint;
begin
  select value into v_url from hub.cron_config where key = 'functions_url';
  select value into v_key from hub.cron_config where key = 'anon_key';
  if v_url is null or v_key is null then raise exception 'hub.cron_config sem functions_url/anon_key'; end if;
  select net.http_post(url := v_url || '/' || p_name, headers := jsonb_build_object('Authorization', 'Bearer ' || v_key, 'Content-Type', 'application/json'), body := '{}'::jsonb, timeout_milliseconds := 120000)
    into v_id;
  return v_id;
end $$;

-- -----------------------------------------------------------------------------
-- Veredito diário por regras (texto em português a partir das views)
-- -----------------------------------------------------------------------------
create or replace function hub.generate_daily_verdict(p_day date default (now() at time zone 'America/Sao_Paulo')::date)
returns void language plpgsql security definer set search_path = hub, public as $$
declare
  v_month date := date_trunc('month', p_day)::date;
  v_prev date := (date_trunc('month', p_day) - interval '1 month')::date;
  v_day int := extract(day from p_day);
  v_cur numeric; v_before numeric; v_var numeric; v_target numeric;
  v_heavy record; v_grow record; v_healthy record;
  v_head text; v_body text; v_status jsonb;
begin
  select coalesce(sum(gross_amount - discount_amount),0) into v_cur from hub.orders
   where status in ('approved','partially_refunded') and hub.month_of(sold_at) = v_month
     and extract(day from sold_at at time zone 'America/Sao_Paulo') <= v_day;
  select coalesce(sum(gross_amount - discount_amount),0) into v_before from hub.orders
   where status in ('approved','partially_refunded') and hub.month_of(sold_at) = v_prev
     and extract(day from sold_at at time zone 'America/Sao_Paulo') <= v_day;
  select variable_cost_pct into v_var from hub.v_company_pnl_monthly where month = v_month;
  select value into v_target from hub.targets where product_id is null and metric = 'variable_cost_pct' and month = v_month;

  -- produto que mais pesa no custo variável (mídia + deduções sobre receita) entre os relevantes
  select name, slug, gross, ad_spend, deductions into v_heavy from hub.v_product_pnl_monthly
   where month = v_month and gross > 0 order by (ad_spend + deductions) / gross desc limit 1;
  -- produto que mais cresce vs. mesmo período
  with cur as (select product_id, sum(gross_amount - discount_amount) g from hub.orders where status in ('approved','partially_refunded') and hub.month_of(sold_at) = v_month and extract(day from sold_at at time zone 'America/Sao_Paulo') <= v_day group by 1),
       bef as (select product_id, sum(gross_amount - discount_amount) g from hub.orders where status in ('approved','partially_refunded') and hub.month_of(sold_at) = v_prev and extract(day from sold_at at time zone 'America/Sao_Paulo') <= v_day group by 1)
  select p.name, cur.g as g, bef.g as b into v_grow from cur join bef using (product_id) join hub.products p on p.id = cur.product_id
   where bef.g > 0 and cur.g >= 5000 order by cur.g / bef.g desc limit 1;
  select name, margin_pct into v_healthy from hub.v_product_pnl_monthly where month = v_month and gross > 0 order by profit desc limit 1;

  v_head := case when v_before > 0 and v_cur >= v_before then format('Mês %s%% acima do mesmo período anterior', round(100*(v_cur-v_before)/v_before))
                 when v_before > 0 then format('Mês %s%% abaixo do mesmo período anterior', round(100*(v_before-v_cur)/v_before))
                 else 'Sem base de comparação com o mês anterior' end;
  v_body := '';
  if v_var is not null and v_target is not null then
    v_body := v_body || case when v_var > v_target
      then format('O custo variável está em %s%%, %s pontos acima da meta de %s%%. ', round(v_var), round(v_var - v_target), round(v_target))
      else format('O custo variável está em %s%%, dentro da meta de %s%%. ', round(v_var), round(v_target)) end;
  end if;
  if v_heavy.name is not null then v_body := v_body || format('O peso está em %s (mídia + deduções de %s%% da receita). ', v_heavy.name, round(100*(v_heavy.ad_spend + v_heavy.deductions)/v_heavy.gross)); end if;
  if v_grow.name is not null then v_body := v_body || format('%s cresce %s%% sobre o mesmo período. ', v_grow.name, round(100*(v_grow.g - v_grow.b)/v_grow.b)); end if;
  if v_healthy.name is not null then v_body := v_body || format('%s segue sustentando a casa (margem %s%%).', v_healthy.name, round(coalesce(v_healthy.margin_pct,0))); end if;

  select coalesce(jsonb_agg(jsonb_build_object('product_id', v.product_id, 'name', v.name, 'margin_pct', v.margin_pct,
           'level', case when v.margin_pct is null or v.margin_pct < least(10, coalesce(t.value, p.target_margin_pct, 30)/3) then 'critico'
                         when v.margin_pct < coalesce(t.value, p.target_margin_pct, 30) then 'atencao' else 'saudavel' end)), '[]'::jsonb)
    into v_status
  from hub.v_product_pnl_monthly v join hub.products p on p.id = v.product_id
  left join hub.targets t on t.product_id = v.product_id and t.metric = 'margin_pct' and t.month = v_month
  where v.month = v_month and v.gross > 0;

  insert into hub.daily_verdicts (day, headline, body, product_status, generated_by)
  values (p_day, v_head, coalesce(nullif(trim(v_body), ''), 'Sem observações automáticas hoje.'), v_status, 'rules')
  on conflict (day) do update set headline = excluded.headline, body = excluded.body, product_status = excluded.product_status, generated_at = now();
end $$;

-- -----------------------------------------------------------------------------
-- Agendamentos (horários em UTC; São Paulo = UTC−3)
-- -----------------------------------------------------------------------------
do $do$
begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    perform cron.schedule('hub-sync-asaas',      '15 * * * *',  $$select hub.call_function('hub-sync-asaas')$$);
    perform cron.schedule('hub-sync-meta',       '20 * * * *',  $$select hub.call_function('hub-sync-meta')$$);
    perform cron.schedule('hub-sync-google',     '25 * * * *',  $$select hub.call_function('hub-sync-google-ads')$$);
    perform cron.schedule('hub-sync-curseduca',  '30 */2 * * *',$$select hub.call_function('hub-sync-curseduca')$$);
    perform cron.schedule('hub-sync-geritools',  '35 */2 * * *',$$select hub.call_function('hub-sync-geritools')$$);
    perform cron.schedule('hub-sync-clint',      '40 * * * *',  $$select hub.call_function('hub-sync-clint')$$);
    perform cron.schedule('hub-sync-contaazul',  '0 6 * * *',   $$select hub.call_function('hub-sync-contaazul')$$);
    perform cron.schedule('hub-daily-verdict',   '0 7 * * *',   $$select hub.generate_daily_verdict()$$); -- 04h São Paulo
  end if;
end $do$;
