-- =============================================================================
-- Geri Hub · dados de DEMONSTRAÇÃO (números ilustrativos, não são da operação)
-- Rode apenas em ambiente local / projeto de desenvolvimento.
-- =============================================================================
set search_path = hub, public;
set timezone = 'America/Sao_Paulo';
select setseed(0.42);

-- Usuários do hub
insert into hub.users (email, name, role) values
  ('rafaelduncanmeira@gmail.com', 'Rafael', 'admin'),
  ('daniel@gericlass.com.br', 'Daniel', 'admin'),
  ('chico@gericlass.com.br', 'Chico', 'gestor'),
  ('comercial1@gericlass.com.br', 'Ana (comercial)', 'comercial'),
  ('comercial2@gericlass.com.br', 'Bruno (comercial)', 'comercial'),
  ('trafego@gericlass.com.br', 'Carla (tráfego)', 'trafego')
on conflict (email) do nothing;

-- Produtos
insert into hub.products (slug, name, family, billing, delivery, target_margin_pct, list_price, sort_order) values
  ('pos-geriatria',      'Pós Geriatria',            'pos_graduacao', 'installment_plan', 'vump',      33, 18000, 10),
  ('pos-paliativa',      'Pós Cuidados Paliativos',  'pos_graduacao', 'installment_plan', 'vump',      33, 17000, 20),
  ('prep-titulo',        'Preparatório Título',      'preparatorio',  'one_time',         'curseduca', 40, 2497,  30),
  ('geriupdates',        'GeriUpdates',              'assinatura',    'subscription',     'curseduca', 45, 97,    40),
  ('geritools',          'GeriTools',                'software',      'subscription',     'geritools', 60, 59,    50),
  ('curso-demencia',     'Curso de Demência',        'curso',         'one_time',         'curseduca', 40, 1497,  60),
  ('curso-paliativos',   'Curso de Cuidados Paliativos','curso',      'one_time',         'curseduca', 40, 1297,  70),
  ('mentoria',           'Mentoria High Ticket',     'mentoria',      'one_time',         'manual',    50, 25000, 80),
  ('eventos',            'Eventos',                  'evento',        'one_time',         'manual',    25, 890,   90),
  ('ebook',              'E-books',                  'ebook',         'one_time',         'curseduca', 80, 97,    100),
  ('treinamentos',       'Treinamentos',             'treinamento',   'one_time',         'curseduca', 35, 697,   110)
on conflict (slug) do nothing;

-- Impostos: Presumido serviços (GeriClass) e repasse VUMP (tributado de novo no recebimento)
insert into hub.tax_params (label, applies_to_source, iss_pct, valid_from) values
  ('GeriClass · Lucro Presumido (serviços)', null, 5.00, '2025-01-01'),
  ('Repasse VUMP · tributado no recebimento', 'vump', 5.00, '2025-01-01');

-- Equipe e alocação direta por pessoa
insert into hub.team_members (name, department, role_title, monthly_cost, started_on) values
  ('Rafael',  'estrategia',  'Diretor',              8000,  '2024-01-01'),
  ('Daniel',  'estrategia',  'Diretor',              8000,  '2024-01-01'),
  ('Chico',   'gestao',      'Gestor de operações', 12000,  '2024-06-01'),
  ('Tec',     'tecnologia',  'Desenvolvedor',       11000,  '2025-01-01'),
  ('Design',  'design',      'Designer',             6500,  '2025-01-01'),
  ('Sup Pós', 'suporte',     'Suporte pós/MTEG',     4500,  '2024-06-01'),
  ('Sup Ment','suporte',     'Suporte mentoria',     4500,  '2025-06-01'),
  ('Ana',     'comercial',   'Closer',               5000,  '2025-03-01'),
  ('Bruno',   'comercial',   'SDR',                  3500,  '2025-03-01'),
  ('Carla',   'trafego',     'Gestora de tráfego',   7000,  '2025-01-01');

insert into hub.team_allocations (team_member_id, product_id, pct, valid_from)
select m.id, p.id, a.pct, '2025-01-01'
from (values
  ('Tec','geritools',70),('Tec',null,30),
  ('Design',null,100),
  ('Sup Pós','pos-geriatria',50),('Sup Pós','pos-paliativa',30),('Sup Pós','prep-titulo',20),
  ('Sup Ment','mentoria',100),
  ('Ana','mentoria',60),('Ana','pos-geriatria',40),
  ('Bruno','pos-geriatria',50),('Bruno','pos-paliativa',50),
  ('Carla',null,100),
  ('Chico',null,100),('Rafael',null,100),('Daniel',null,100)
) as a(member, slug, pct)
join hub.team_members m on m.name = a.member
left join hub.products p on p.slug = a.slug;

-- Categorias e despesas (Conta Azul simulado)
insert into hub.cost_categories (name, kind, dre_group) values
  ('Ferramentas e software', 'fixed', 'Custos fixos'),
  ('Contabilidade e jurídico', 'fixed', 'Custos fixos'),
  ('Produção de conteúdo', 'variable', 'Custos diretos'),
  ('Eventos · local e logística', 'variable', 'Custos diretos'),
  ('Pró-labore', 'pro_labore', 'Resultado'),
  ('Distribuição de lucros', 'distribution', 'Resultado');

insert into hub.cost_entries (source, external_id, category_id, description, amount, competence_month, product_id)
select 'manual', 'demo-'||c.name||'-'||to_char(m, 'YYYYMM'), c.id,
       c.name, case c.name when 'Ferramentas e software' then 6800 when 'Contabilidade e jurídico' then 2400 end, m::date, null
from generate_series('2026-03-01'::date, '2026-09-01', interval '1 month') m
cross join hub.cost_categories c where c.kind = 'fixed';

insert into hub.cost_entries (source, external_id, category_id, description, amount, competence_month, product_id)
select 'manual', 'demo-evento-'||to_char(m,'YYYYMM'), c.id, 'Local do evento', 9500, m::date, p.id
from generate_series('2026-05-01'::date, '2026-09-01', interval '2 month') m
cross join hub.cost_categories c join hub.products p on p.slug = 'eventos' where c.name like 'Eventos%';

-- Clientes (600)
insert into hub.customers (email, name, profession, state)
select 'aluno'||g||'@exemplo.com', 'Aluno '||g,
       (array['Médico','Médico','Médico','Enfermeiro','Fisioterapeuta'])[1+floor(random()*5)],
       (array['SP','RJ','MG','BA','PR','RS','PE','GO'])[1+floor(random()*8)]
from generate_series(1,600) g;

-- Helper volátil para sortear um cliente por linha (o argumento só força avaliação por linha)
create or replace function hub.demo_random_customer(seed anyelement) returns uuid
language sql volatile as $$ select id from hub.customers offset floor(random()*600)::int limit 1 $$;

-- Vendas (Guru) Mar–Set/2026, volume e ticket por produto
with cfg as (
  select * from (values
    ('prep-titulo',     2497, 10, 0.20),
    ('geriupdates',       97, 60, 0.30),
    ('geritools',         59, 40, 0.25),
    ('curso-demencia',  1497, 8, 0.10),
    ('curso-paliativos',1297, 6, 0.10),
    ('eventos',          890, 12, 0.15),
    ('ebook',             97, 40, 0.05),
    ('treinamentos',     697, 5, 0.05)
  ) as c(slug, price, per_month, growth)
),
months as (select generate_series('2026-03-01'::date, '2026-09-01', interval '1 month')::date as m),
gen as (
  select c.slug, c.price, mo.m,
         generate_series(1, greatest(1, round(c.per_month * power(1 + c.growth, extract(month from mo.m) - 3) * (case when mo.m = '2026-09-01' then 0.5 else 1 end))::int)) as n
  from cfg c cross join months mo
)
insert into hub.orders (source, external_id, product_id, customer_id, status, sold_at, approved_at, gross_amount, discount_amount, payment_method, installments, utm_source, utm_campaign)
select 'guru', 'demo-'||g.slug||'-'||to_char(g.m,'YYYYMM')||'-'||g.n, p.id,
       hub.demo_random_customer(g),
       case when random() < 0.04 then 'refunded' when random() < 0.01 then 'chargeback' else 'approved' end::hub.order_status,
       g.m + (floor(random() * least(30, case when g.m='2026-09-01' then 14 else 30 end))::int || ' days')::interval + (floor(random()*86400)::int || ' seconds')::interval,
       null, g.price, case when random() < 0.2 then round(g.price*0.1,2) else 0 end,
       (array['pix','credit_card','credit_card','boleto'])[1+floor(random()*4)]::hub.payment_method,
       case when g.price > 500 then (array[1,3,6,10,12])[1+floor(random()*5)] else 1 end,
       (array['meta','meta','google','organico','indicacao'])[1+floor(random()*5)],
       g.slug||'-'||(array['frio','quente','remarketing'])[1+floor(random()*3)]
from gen g join hub.products p on p.slug = g.slug;

-- Mentoria: poucas vendas, alto ticket
insert into hub.orders (source, external_id, product_id, customer_id, status, sold_at, gross_amount, payment_method, installments, seller_user_id)
select 'guru', 'demo-mentoria-'||g, p.id, hub.demo_random_customer(g), 'approved',
       '2026-03-01'::date + (g*17 || ' days')::interval, 25000, 'credit_card', 12,
       (select id from hub.users where email like 'comercial1%')
from generate_series(1,11) g join hub.products p on p.slug='mentoria';

-- Pós-graduação via VUMP: importação normalizada em pedidos (competência = matrícula)
insert into hub.orders (source, external_id, product_id, customer_id, status, sold_at, gross_amount, payment_method, installments)
select 'vump', 'demo-vump-'||p.slug||'-'||g, p.id, hub.demo_random_customer(g), 'approved',
       '2026-03-01'::date + (floor(random()*195)::int || ' days')::interval,
       p.list_price, 'boleto', 18
from hub.products p cross join generate_series(1, 40) g
where p.slug in ('pos-geriatria','pos-paliativa') and (p.slug='pos-geriatria' or g <= 22);

update hub.orders set approved_at = sold_at + interval '10 minutes' where status <> 'pending' and approved_at is null;

-- Deduções: taxa Guru 1,5%, Asaas 2,5% cartão / R$ 1,99 pix, taxa parceiro VUMP+Anhanguera 55% da pós,
-- comissão comercial 8% mentoria, reembolsos/chargebacks integrais
insert into hub.order_deductions (order_id, kind, amount, occurred_at, source)
select o.id, 'fee_platform', round((o.gross_amount - o.discount_amount) * 0.015, 2), o.sold_at, 'guru'
from hub.orders o where o.source = 'guru';

insert into hub.order_deductions (order_id, kind, amount, occurred_at, source)
select o.id, 'fee_gateway',
       case when o.payment_method = 'pix' then 1.99 else round((o.gross_amount - o.discount_amount) * 0.025, 2) end,
       o.sold_at, 'asaas'
from hub.orders o where o.source = 'guru';

insert into hub.order_deductions (order_id, kind, amount, occurred_at, source)
select o.id, 'fee_installment', round((o.gross_amount - o.discount_amount) * 0.012 * (o.installments - 1), 2), o.sold_at, 'asaas'
from hub.orders o where o.source = 'guru' and o.installments > 1;

insert into hub.order_deductions (order_id, kind, amount, occurred_at, source, note)
select o.id, 'fee_partner', round(o.gross_amount * 0.45, 2), o.sold_at, 'vump', 'Anhanguera + VUMP'
from hub.orders o where o.source = 'vump';

insert into hub.order_deductions (order_id, kind, amount, occurred_at, source)
select o.id, 'commission_sales', round(o.gross_amount * 0.08, 2), o.sold_at, 'manual'
from hub.orders o join hub.products p on p.id = o.product_id where p.slug = 'mentoria';

insert into hub.order_deductions (order_id, kind, amount, occurred_at, source)
select o.id, case when o.status='refunded' then 'refund' else 'chargeback' end::hub.deduction_kind,
       o.gross_amount - o.discount_amount, o.sold_at + interval '6 days', 'asaas'
from hub.orders o where o.status in ('refunded','chargeback');

-- Recebimentos (caixa): à vista = mesmo dia; parcelado = 1 parcela/mês; VUMP = repasse líquido 45 dias depois
insert into hub.payments (source, external_id, order_id, product_id, customer_id, status, due_date, paid_at, gross_amount, fee_amount, net_amount, installment_number, payment_method)
select 'asaas', 'demo-pay-'||o.external_id||'-'||i, o.id, o.product_id, o.customer_id,
       case when o.status in ('refunded','chargeback') then 'refunded'
            when o.sold_at + ((i-1) || ' month')::interval > now() then 'pending' else 'received' end::hub.payment_status,
       (o.sold_at + ((i-1) || ' month')::interval)::date,
       case when o.sold_at + ((i-1) || ' month')::interval > now() then null else o.sold_at + ((i-1) || ' month')::interval + interval '1 day' end,
       round((o.gross_amount - o.discount_amount) / o.installments, 2),
       round((o.gross_amount - o.discount_amount) / o.installments * 0.025, 2),
       round((o.gross_amount - o.discount_amount) / o.installments * 0.975, 2),
       i, o.payment_method
from hub.orders o cross join lateral generate_series(1, o.installments) i
where o.source = 'guru';

insert into hub.payments (source, external_id, order_id, product_id, customer_id, status, due_date, paid_at, gross_amount, fee_amount, net_amount, installment_number, payment_method)
select 'vump', 'demo-rep-'||o.external_id||'-'||i, o.id, o.product_id, o.customer_id,
       case when o.sold_at + ((i-1) || ' month')::interval + interval '45 days' > now() then 'pending' else 'received' end::hub.payment_status,
       (o.sold_at + ((i-1) || ' month')::interval + interval '45 days')::date,
       case when o.sold_at + ((i-1) || ' month')::interval + interval '45 days' > now() then null else o.sold_at + ((i-1) || ' month')::interval + interval '45 days' end,
       round(o.gross_amount / o.installments, 2), round(o.gross_amount / o.installments * 0.45, 2), round(o.gross_amount / o.installments * 0.55, 2),
       i, 'boleto'
from hub.orders o cross join lateral generate_series(1, o.installments) i
where o.source = 'vump';

-- Assinaturas: GeriUpdates e GeriTools (uma por pedido aprovado, churn ~6%/mês)
insert into hub.subscriptions (source, external_id, product_id, customer_id, status, interval, amount, started_at, canceled_at)
select 'guru', 'demo-sub-'||o.external_id, o.product_id, o.customer_id,
       case when random() < 0.06 * (extract(month from age(now(), o.sold_at))) then 'canceled' else 'active' end::hub.subscription_status,
       'monthly', o.gross_amount, o.sold_at, null
from hub.orders o join hub.products p on p.id = o.product_id
where p.slug in ('geriupdates','geritools') and o.status = 'approved';
update hub.subscriptions set canceled_at = started_at + (1 + floor(random()*3)::int || ' month')::interval, ended_at = started_at + (1 + floor(random()*3)::int || ' month')::interval
where status = 'canceled';
update hub.subscriptions set status = 'active', canceled_at = null, ended_at = null where status='canceled' and canceled_at > now();
update hub.orders o set subscription_id = s.id from hub.subscriptions s where s.external_id = 'demo-sub-'||o.external_id;

-- Matrículas (Curseduca / GeriTools / VUMP): acesso vigente conforme produto
insert into hub.enrollments (source, external_id, product_id, customer_id, status, access_start, access_end)
select case when o.source='vump' then 'vump' when p.slug='geritools' then 'geritools' else 'curseduca' end::hub.source,
       'demo-enr-'||o.external_id, o.product_id, o.customer_id,
       case when o.status in ('refunded','chargeback') then 'canceled'
            when s.status = 'canceled' then 'expired' else 'active' end::hub.enrollment_status,
       o.sold_at::date,
       case when p.family in ('assinatura','software') then coalesce(s.ended_at::date, null)
            when p.family = 'pos_graduacao' then o.sold_at::date + 540
            when p.family in ('ebook') then null
            else o.sold_at::date + 365 end
from hub.orders o join hub.products p on p.id = o.product_id
left join hub.subscriptions s on s.id = o.subscription_id
where p.slug not in ('mentoria','eventos');

-- Contas de anúncio e investimento diário (Meta + Google)
insert into hub.ad_accounts (platform, external_id, name, product_id)
select 'meta', 'act_demo_'||p.slug, 'Meta · '||p.name, p.id from hub.products p where p.slug in ('pos-geriatria','pos-paliativa','geriupdates','prep-titulo','curso-demencia','mentoria');
insert into hub.ad_accounts (platform, external_id, name, product_id)
select 'google', 'g_demo_'||p.slug, 'Google · '||p.name, p.id from hub.products p where p.slug in ('pos-geriatria','pos-paliativa','prep-titulo');

insert into hub.ad_spend_daily (platform, ad_account_id, campaign_external_id, campaign_name, product_id, day, spend, impressions, clicks, leads, purchases, purchase_value)
select a.platform, a.id, 'camp-'||a.external_id||'-'||c, p.slug||' · '||c, a.product_id, d::date,
       round(((case p.slug when 'pos-geriatria' then 260 when 'pos-paliativa' then 170 when 'geriupdates' then 110 when 'prep-titulo' then 80 when 'curso-demencia' then 40 when 'mentoria' then 60 end)
             * (case a.platform when 'google' then 0.6 else 1 end) * (0.7 + random()*0.6) * (case when c='quente' then 0.4 else 1 end))::numeric, 2),
       floor(20000 + random()*30000), floor(300 + random()*500), floor(4 + random()*12), floor(random()*3), 0
from hub.ad_accounts a join hub.products p on p.id = a.product_id
cross join unnest(array['frio','quente']) c
cross join generate_series('2026-03-01'::date, current_date, interval '1 day') d;

-- Comercial: pipelines (Clint) e negócios
insert into hub.pipelines (source, external_id, name, product_id)
select 'clint', 'demo-pl-'||p.slug, case p.slug when 'mentoria' then 'Mentoria · consultivo' else 'Pós · '||p.name end, p.id
from hub.products p where p.slug in ('mentoria','pos-geriatria','pos-paliativa');

insert into hub.pipeline_stages (pipeline_id, external_id, name, position, is_won, is_lost)
select pl.id, 'demo-st-'||pl.external_id||'-'||s.position, s.name, s.position, s.name = 'Fechado', s.name = 'Perdido'
from hub.pipelines pl cross join (values ('Novo lead',1),('Qualificado',2),('Aplicação',3),('Call',4),('Proposta',5),('Fechado',6),('Perdido',7)) s(name, position)
where (pl.name like 'Mentoria%') or s.name not in ('Aplicação');

insert into hub.leads (source, external_id, customer_id, product_id, origin, utm_source, score, temperature, created_at)
select 'clint', 'demo-lead-'||pl.external_id||'-'||g, hub.demo_random_customer(g), pl.product_id,
       (array['meta','meta','google','organico','indicacao'])[1+floor(random()*5)], 'meta',
       floor(40 + random()*60), (array['frio','morno','quente'])[1+floor(random()*3)],
       '2026-03-01'::timestamptz + (floor(random()*195)::int || ' days')::interval
from hub.pipelines pl cross join generate_series(1, case when pl.name like 'Mentoria%' then 140 else 260 end) g;

insert into hub.deals (source, external_id, pipeline_id, stage_id, lead_id, customer_id, product_id, owner_user_id, title, value, created_at, won_at, lost_at, lost_reason)
select 'clint', 'demo-deal-'||l.external_id, pl.id,
       st.id, l.id, l.customer_id, l.product_id,
       (select id from hub.users where role='comercial' order by random() limit 1),
       'Negócio '||l.external_id, coalesce(p.list_price, 0), l.created_at,
       case when st.is_won then l.created_at + (5 + floor(random()*25)::int || ' days')::interval end,
       case when st.is_lost then l.created_at + (3 + floor(random()*20)::int || ' days')::interval end,
       case when st.is_lost then (array['Preço','Sem resposta','Timing','Concorrente'])[1+floor(random()*4)] end
from hub.leads l
join hub.pipelines pl on pl.id = (select id from hub.pipelines where product_id = l.product_id limit 1)
join hub.products p on p.id = l.product_id
join lateral (
  select * from hub.pipeline_stages s where s.pipeline_id = pl.id
  order by case when random() < 0.12 then 0 else 1 end, random() limit 1
) st on true;

-- Veredito e briefing de exemplo
insert into hub.daily_verdicts (day, headline, body, product_status, generated_by) values
  (current_date, 'Mês acima de agosto, custo variável acima da meta',
   'A receita de competência está acima do mesmo período de agosto, mas o custo variável (taxas + mídia) passou da meta de 33%. O peso está no GeriUpdates, que escalou mídia mais rápido que a receita. Pós Geriatria segue sustentando a casa.',
   '[]'::jsonb, 'rules');

insert into hub.briefing_items (week_start, position, title, detail, product_id)
select date_trunc('week', current_date)::date, r.pos, r.title, r.detail, p.id
from (values
  (1, 'Decidir corte no CPG', 'Curso de Demência abaixo da margem há 12 dias', 'curso-demencia'),
  (2, 'GeriUpdates pode dobrar de novo', 'Aprovar teto de mídia da semana', 'geriupdates'),
  (3, 'Público quente respondendo melhor que o frio', 'Realocar 20% do orçamento para remarketing', 'pos-geriatria'),
  (4, 'Mentoria: 10 aplicações em call', 'Recorde da série; garantir agenda do closer', 'mentoria')
) r(pos, title, detail, slug) join hub.products p on p.slug = r.slug;

-- Metas do mês
insert into hub.targets (product_id, month, metric, value)
select null, date_trunc('month', current_date)::date, 'variable_cost_pct', 33;
insert into hub.targets (product_id, month, metric, value)
select id, date_trunc('month', current_date)::date, 'margin_pct', target_margin_pct from hub.products where target_margin_pct is not null;

-- Integrações: marcar como conectadas para a demo
update hub.integrations set enabled = true, last_success_at = now() - interval '3 hours' where source in ('guru','asaas','meta','google','curseduca','clint');
insert into hub.sync_runs (source, started_at, finished_at, status, rows_upserted)
select source, now() - interval '3 hours', now() - interval '3 hours' + interval '40 seconds', 'ok', floor(random()*400)
from hub.integrations where enabled and source <> 'manual';
