-- =============================================================================
-- Geri Hub · modelo de dados (V1)
-- Painel de gestão da GeriClass: vendas, caixa, tráfego, alunos, comercial e DRE.
-- Moeda: BRL. Valores em numeric(14,2). Datas de competência em `date`,
-- eventos em `timestamptz` (America/Sao_Paulo é aplicado na camada de leitura).
-- =============================================================================

create extension if not exists pgcrypto;
create extension if not exists pg_trgm;

create schema if not exists hub;

-- -----------------------------------------------------------------------------
-- 0. Usuários do hub e papéis (quem vê o quê)
-- -----------------------------------------------------------------------------
create type hub.role as enum ('admin', 'gestor', 'comercial', 'trafego', 'financeiro', 'leitura');

create table hub.users (
  id uuid primary key default gen_random_uuid(),
  auth_user_id uuid unique,                -- auth.users.id (preenchido no primeiro login)
  email text not null unique,
  name text not null,
  role hub.role not null default 'leitura',
  active boolean not null default true,
  created_at timestamptz not null default now()
);

-- -----------------------------------------------------------------------------
-- 1. Catálogo: produtos, famílias e mapeamento por fonte
-- -----------------------------------------------------------------------------
create type hub.product_family as enum (
  'pos_graduacao', 'preparatorio', 'curso', 'assinatura', 'software',
  'mentoria', 'evento', 'ebook', 'treinamento', 'outro'
);
create type hub.billing_model as enum ('one_time', 'subscription', 'installment_plan');
create type hub.source as enum (
  'guru', 'asaas', 'vump', 'curseduca', 'geritools', 'clint', 'meta', 'google',
  'contaazul', 'manual'
);

create table hub.products (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique,
  name text not null,
  family hub.product_family not null,
  billing hub.billing_model not null default 'one_time',
  delivery hub.source,                       -- onde o aluno é entregue (curseduca, geritools, ...)
  target_margin_pct numeric(5,2),            -- meta de margem (ex.: 33.00)
  list_price numeric(14,2),
  active boolean not null default true,
  sort_order int not null default 100,
  created_at timestamptz not null default now()
);

-- "Produto X na Guru tem id 123", "na VUMP é o curso PG-GER-01", "na Curseduca é o grupo 42"
create table hub.product_source_refs (
  id uuid primary key default gen_random_uuid(),
  product_id uuid not null references hub.products(id) on delete cascade,
  source hub.source not null,
  external_id text not null,
  external_name text,
  unique (source, external_id)
);

-- -----------------------------------------------------------------------------
-- 2. Clientes / alunos (pessoa única entre fontes, chave = e-mail normalizado)
-- -----------------------------------------------------------------------------
create table hub.customers (
  id uuid primary key default gen_random_uuid(),
  email text not null unique,
  name text,
  phone text,
  document text,                             -- CPF/CNPJ (apenas dígitos)
  profession text,                           -- médico, enfermeiro, etc.
  city text, state text,
  first_seen_at timestamptz not null default now(),
  attributes jsonb not null default '{}'::jsonb
);
create index on hub.customers using gin (name gin_trgm_ops);

create table hub.customer_source_refs (
  customer_id uuid not null references hub.customers(id) on delete cascade,
  source hub.source not null,
  external_id text not null,
  primary key (source, external_id)
);

-- -----------------------------------------------------------------------------
-- 3. Vendas (competência) e recebimentos (caixa)
-- -----------------------------------------------------------------------------
create type hub.order_status as enum (
  'pending', 'approved', 'canceled', 'refunded', 'chargeback', 'expired', 'partially_refunded'
);
create type hub.payment_method as enum ('pix', 'credit_card', 'boleto', 'transfer', 'other');

-- Um pedido = uma venda com data de competência. Fonte: Guru (99%), VUMP (importação), manual.
create table hub.orders (
  id uuid primary key default gen_random_uuid(),
  source hub.source not null,
  external_id text not null,
  product_id uuid references hub.products(id),
  customer_id uuid references hub.customers(id),
  subscription_id uuid,                      -- preenchido depois (ver hub.subscriptions)
  status hub.order_status not null,
  sold_at timestamptz not null,              -- competência
  approved_at timestamptz,
  gross_amount numeric(14,2) not null,       -- valor cheio cobrado do cliente
  discount_amount numeric(14,2) not null default 0,
  payment_method hub.payment_method,
  installments int not null default 1,
  seller_user_id uuid references hub.users(id),   -- vendedor (quando venda consultiva)
  utm_source text, utm_medium text, utm_campaign text, utm_content text, utm_term text,
  affiliate text,
  raw jsonb,                                 -- payload original (auditoria)
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (source, external_id)
);
create index on hub.orders (sold_at);
create index on hub.orders (product_id, sold_at);
create index on hub.orders (customer_id);

-- Deduções ligadas ao pedido. Competência = data do pedido; caixa = occurred_at.
create type hub.deduction_kind as enum (
  'fee_platform',        -- taxa Guru
  'fee_gateway',         -- taxa Asaas
  'fee_installment',     -- juros/antecipação de parcelamento
  'fee_partner',         -- taxa VUMP / Anhanguera (pós)
  'commission_sales',    -- comissão do comercial
  'commission_affiliate',
  'refund',
  'chargeback',
  'tax',                 -- imposto calculado sobre a receita (ver hub.tax_params)
  'other'
);

create table hub.order_deductions (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references hub.orders(id) on delete cascade,
  kind hub.deduction_kind not null,
  amount numeric(14,2) not null,             -- positivo = reduz a receita
  occurred_at timestamptz not null,
  source hub.source not null default 'manual',
  external_id text,
  note text
);
create index on hub.order_deductions (order_id);
create index on hub.order_deductions (occurred_at);

-- Recebimentos efetivos (caixa). Fonte: Asaas (parcelas), VUMP (repasses), manual.
create type hub.payment_status as enum ('pending', 'received', 'overdue', 'refunded', 'chargeback', 'canceled');

create table hub.payments (
  id uuid primary key default gen_random_uuid(),
  source hub.source not null,
  external_id text not null,
  order_id uuid references hub.orders(id),
  product_id uuid references hub.products(id),   -- redundante de propósito (repasses VUMP sem pedido)
  customer_id uuid references hub.customers(id),
  status hub.payment_status not null,
  due_date date,
  paid_at timestamptz,
  gross_amount numeric(14,2) not null,
  fee_amount numeric(14,2) not null default 0,   -- taxa do gateway nesta parcela
  net_amount numeric(14,2) not null,             -- o que entrou no banco
  installment_number int,
  payment_method hub.payment_method,
  raw jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (source, external_id)
);
create index on hub.payments (paid_at);
create index on hub.payments (product_id, paid_at);

-- -----------------------------------------------------------------------------
-- 4. Assinaturas (GeriUpdates, GeriTools) → MRR, churn, LTV
-- -----------------------------------------------------------------------------
create type hub.subscription_status as enum ('trial', 'active', 'past_due', 'canceled', 'expired', 'paused');
create type hub.billing_interval as enum ('monthly', 'quarterly', 'semiannual', 'annual');

create table hub.subscriptions (
  id uuid primary key default gen_random_uuid(),
  source hub.source not null,
  external_id text not null,
  product_id uuid not null references hub.products(id),
  customer_id uuid references hub.customers(id),
  status hub.subscription_status not null,
  interval hub.billing_interval not null default 'monthly',
  amount numeric(14,2) not null,               -- valor por ciclo
  started_at timestamptz not null,
  canceled_at timestamptz,
  ended_at timestamptz,
  cancel_reason text,
  raw jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (source, external_id)
);
create index on hub.subscriptions (product_id, status);

alter table hub.orders
  add constraint orders_subscription_fk foreign key (subscription_id) references hub.subscriptions(id);

-- -----------------------------------------------------------------------------
-- 5. Matrículas / acessos (aluno ativo = matriculado com acesso vigente)
-- -----------------------------------------------------------------------------
create type hub.enrollment_status as enum ('active', 'expired', 'canceled', 'blocked');

create table hub.enrollments (
  id uuid primary key default gen_random_uuid(),
  source hub.source not null,                  -- curseduca, geritools, vump
  external_id text not null,
  product_id uuid not null references hub.products(id),
  customer_id uuid references hub.customers(id),
  status hub.enrollment_status not null,
  access_start date not null,
  access_end date,                             -- null = vitalício
  last_access_at timestamptz,
  progress_pct numeric(5,2),
  raw jsonb,
  updated_at timestamptz not null default now(),
  unique (source, external_id)
);
create index on hub.enrollments (product_id, status);

-- -----------------------------------------------------------------------------
-- 6. Tráfego pago (Meta + Google) → ROAS por produto
-- -----------------------------------------------------------------------------
create table hub.ad_accounts (
  id uuid primary key default gen_random_uuid(),
  platform hub.source not null check (platform in ('meta','google')),
  external_id text not null,
  name text not null,
  product_id uuid references hub.products(id),  -- conta dedicada a um produto (padrão atual)
  active boolean not null default true,
  unique (platform, external_id)
);

-- Regras para atribuir campanha → produto quando a conta serve vários produtos.
create table hub.campaign_product_rules (
  id uuid primary key default gen_random_uuid(),
  platform hub.source not null check (platform in ('meta','google')),
  match_regex text not null,                    -- aplicado ao nome da campanha
  product_id uuid not null references hub.products(id),
  priority int not null default 100
);

create table hub.ad_spend_daily (
  id uuid primary key default gen_random_uuid(),
  platform hub.source not null check (platform in ('meta','google')),
  ad_account_id uuid not null references hub.ad_accounts(id),
  campaign_external_id text not null,
  campaign_name text,
  product_id uuid references hub.products(id),
  day date not null,
  spend numeric(14,2) not null default 0,
  impressions bigint not null default 0,
  clicks bigint not null default 0,
  leads int not null default 0,                 -- conversões de lead reportadas pela plataforma
  purchases int not null default 0,             -- conversões de compra reportadas pela plataforma
  purchase_value numeric(14,2) not null default 0,
  raw jsonb,
  unique (platform, ad_account_id, campaign_external_id, day)
);
create index on hub.ad_spend_daily (product_id, day);

-- -----------------------------------------------------------------------------
-- 7. Comercial: leads, pipelines, negócios (Clint + registro nativo da mentoria)
-- -----------------------------------------------------------------------------
create table hub.pipelines (
  id uuid primary key default gen_random_uuid(),
  source hub.source not null default 'clint',
  external_id text,
  name text not null,
  product_id uuid references hub.products(id),
  unique (source, external_id)
);

create table hub.pipeline_stages (
  id uuid primary key default gen_random_uuid(),
  pipeline_id uuid not null references hub.pipelines(id) on delete cascade,
  external_id text,
  name text not null,
  position int not null,
  is_won boolean not null default false,
  is_lost boolean not null default false,
  unique (pipeline_id, position)
);

create table hub.leads (
  id uuid primary key default gen_random_uuid(),
  source hub.source not null,
  external_id text,
  customer_id uuid references hub.customers(id),
  product_id uuid references hub.products(id),
  origin text,                                  -- meta, google, organico, indicacao...
  utm_source text, utm_medium text, utm_campaign text, utm_content text,
  score int,
  temperature text check (temperature in ('frio','morno','quente')),
  created_at timestamptz not null default now(),
  raw jsonb,
  unique (source, external_id)
);
create index on hub.leads (product_id, created_at);

create table hub.deals (
  id uuid primary key default gen_random_uuid(),
  source hub.source not null default 'clint',
  external_id text,
  pipeline_id uuid not null references hub.pipelines(id),
  stage_id uuid references hub.pipeline_stages(id),
  lead_id uuid references hub.leads(id),
  customer_id uuid references hub.customers(id),
  product_id uuid references hub.products(id),
  owner_user_id uuid references hub.users(id),   -- vendedor responsável
  title text,
  value numeric(14,2),
  created_at timestamptz not null default now(),
  won_at timestamptz,
  lost_at timestamptz,
  lost_reason text,
  order_id uuid references hub.orders(id),       -- venda gerada (quando fechou)
  next_action_at timestamptz,
  notes text,
  raw jsonb,
  updated_at timestamptz not null default now(),
  unique (source, external_id)
);
create index on hub.deals (pipeline_id, stage_id);
create index on hub.deals (owner_user_id, created_at);

create table hub.deal_stage_events (
  id uuid primary key default gen_random_uuid(),
  deal_id uuid not null references hub.deals(id) on delete cascade,
  from_stage_id uuid references hub.pipeline_stages(id),
  to_stage_id uuid not null references hub.pipeline_stages(id),
  moved_at timestamptz not null default now(),
  moved_by uuid references hub.users(id)
);
create index on hub.deal_stage_events (deal_id, moved_at);

-- Atividades (call de aplicação, follow-up, proposta enviada...). Registro nativo p/ mentoria.
create table hub.deal_activities (
  id uuid primary key default gen_random_uuid(),
  deal_id uuid not null references hub.deals(id) on delete cascade,
  kind text not null,                            -- call, whatsapp, email, proposta, reuniao
  happened_at timestamptz not null default now(),
  outcome text,
  notes text,
  created_by uuid references hub.users(id)
);

-- -----------------------------------------------------------------------------
-- 8. Custos: equipe, despesas (Conta Azul), rateio por produto, impostos
-- -----------------------------------------------------------------------------
create table hub.team_members (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  department text not null,                      -- estrategia, gestao, tecnologia, design, suporte, comercial, trafego...
  role_title text,
  hub_user_id uuid references hub.users(id),
  monthly_cost numeric(14,2) not null,           -- custo total (salário/PJ + encargos)
  cost_kind text not null default 'fixed' check (cost_kind in ('fixed','variable')),
  started_on date not null,
  ended_on date
);

-- Alocação direta por pessoa: % do custo de cada pessoa em cada produto, por período.
create table hub.team_allocations (
  id uuid primary key default gen_random_uuid(),
  team_member_id uuid not null references hub.team_members(id) on delete cascade,
  product_id uuid references hub.products(id),   -- null = overhead (não alocado a produto)
  pct numeric(5,2) not null check (pct > 0 and pct <= 100),
  valid_from date not null,
  valid_to date
);
create index on hub.team_allocations (team_member_id, valid_from);

create type hub.cost_kind as enum ('fixed', 'variable', 'payroll', 'tax', 'partner_fee', 'pro_labore', 'distribution', 'other');

create table hub.cost_categories (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  kind hub.cost_kind not null,
  dre_group text not null,                       -- "Custos fixos", "Ferramentas", "Impostos", ...
  default_product_id uuid references hub.products(id)
);

-- Lançamentos de despesa (Conta Azul via API, ou manual). Competência = competence_month.
create table hub.cost_entries (
  id uuid primary key default gen_random_uuid(),
  source hub.source not null default 'contaazul',
  external_id text,
  category_id uuid references hub.cost_categories(id),
  description text not null,
  amount numeric(14,2) not null,
  competence_month date not null,                -- sempre dia 1
  paid_at date,
  product_id uuid references hub.products(id),   -- custo direto de um produto
  vendor text,
  raw jsonb,
  unique (source, external_id)
);
create index on hub.cost_entries (competence_month);

-- Rateio de custos sem produto (overhead): % por produto por período. Se vazio, rateia por receita.
create table hub.overhead_allocation_rules (
  id uuid primary key default gen_random_uuid(),
  product_id uuid not null references hub.products(id),
  pct numeric(5,2) not null,
  valid_from date not null,
  valid_to date
);

-- Parâmetros tributários (Lucro Presumido). Aplicados sobre a receita reconhecida.
create table hub.tax_params (
  id uuid primary key default gen_random_uuid(),
  label text not null,                            -- "GeriClass · Presumido serviços" / "Repasse VUMP"
  applies_to_source hub.source,                   -- null = todas as fontes; 'vump' = só repasses VUMP
  pis_pct numeric(6,4) not null default 0.65,
  cofins_pct numeric(6,4) not null default 3.00,
  irpj_pct numeric(6,4) not null default 4.80,    -- 15% sobre base presumida de 32%
  csll_pct numeric(6,4) not null default 2.88,    -- 9% sobre base presumida de 32%
  iss_pct numeric(6,4) not null default 5.00,
  irpj_adicional_pct numeric(6,4) not null default 0, -- 10% sobre lucro presumido > 60k/trimestre (calculado à parte)
  valid_from date not null,
  valid_to date
);

-- -----------------------------------------------------------------------------
-- 9. Importação VUMP (staging) — enquanto não houver API
-- -----------------------------------------------------------------------------
create table hub.vump_statements (
  id uuid primary key default gen_random_uuid(),
  period_month date not null,
  file_name text,
  imported_by uuid references hub.users(id),
  imported_at timestamptz not null default now(),
  total_gross numeric(14,2),
  total_partner_fees numeric(14,2),
  total_net numeric(14,2),
  status text not null default 'imported' check (status in ('imported','normalized','error')),
  notes text
);

create table hub.vump_statement_lines (
  id uuid primary key default gen_random_uuid(),
  statement_id uuid not null references hub.vump_statements(id) on delete cascade,
  course_code text,
  course_name text,
  student_name text,
  student_email text,
  student_document text,
  enrolled_on date,
  installment_number int,
  gross_amount numeric(14,2) not null,
  anhanguera_fee numeric(14,2) not null default 0,
  vump_fee numeric(14,2) not null default 0,
  net_amount numeric(14,2) not null,
  received_on date,
  raw jsonb
);

-- -----------------------------------------------------------------------------
-- 10. Operação do hub: integrações, sincronizações, veredito e briefing
-- -----------------------------------------------------------------------------
create table hub.integrations (
  source hub.source primary key,
  display_name text not null,
  mode text not null check (mode in ('api','webhook','import','manual','none')),
  enabled boolean not null default false,
  last_success_at timestamptz,
  last_error text,
  config jsonb not null default '{}'::jsonb        -- ids de conta, cursor de paginação; NUNCA segredos
);

create table hub.sync_runs (
  id uuid primary key default gen_random_uuid(),
  source hub.source not null references hub.integrations(source),
  started_at timestamptz not null default now(),
  finished_at timestamptz,
  status text not null default 'running' check (status in ('running','ok','error')),
  rows_upserted int not null default 0,
  error text,
  window_from timestamptz,
  window_to timestamptz
);
create index on hub.sync_runs (source, started_at desc);

-- Veredito diário (texto gerado + status por produto) e itens de briefing semanal
create table hub.daily_verdicts (
  day date primary key,
  headline text not null,
  body text not null,
  product_status jsonb not null default '[]'::jsonb, -- [{product_id, level: critico|atencao|saudavel, reason}]
  generated_at timestamptz not null default now(),
  generated_by text not null default 'rules'         -- rules | llm | manual
);

create table hub.briefing_items (
  id uuid primary key default gen_random_uuid(),
  week_start date not null,
  position int not null,
  title text not null,
  detail text,
  product_id uuid references hub.products(id),
  decided boolean not null default false,
  decision_note text,
  created_at timestamptz not null default now()
);

-- Metas mensais (receita, ROAS, margem) por produto — usadas em alertas
create table hub.targets (
  id uuid primary key default gen_random_uuid(),
  product_id uuid references hub.products(id),     -- null = empresa
  month date not null,
  metric text not null,                            -- revenue_gross, roas, margin_pct, new_students, mrr
  value numeric(14,2) not null,
  unique (product_id, month, metric)
);

-- -----------------------------------------------------------------------------
-- 11. Funções utilitárias
-- -----------------------------------------------------------------------------
create or replace function hub.month_of(ts timestamptz) returns date
language sql immutable as $$
  select date_trunc('month', ts at time zone 'America/Sao_Paulo')::date
$$;

create or replace function hub.set_updated_at() returns trigger
language plpgsql as $$
begin new.updated_at = now(); return new; end $$;

create trigger orders_updated before update on hub.orders for each row execute function hub.set_updated_at();
create trigger payments_updated before update on hub.payments for each row execute function hub.set_updated_at();
create trigger subscriptions_updated before update on hub.subscriptions for each row execute function hub.set_updated_at();
create trigger deals_updated before update on hub.deals for each row execute function hub.set_updated_at();

-- Custo mensal de pessoas alocado por produto num mês (alocação direta por pessoa)
create or replace function hub.team_cost_by_product(p_month date)
returns table (product_id uuid, amount numeric)
language sql stable as $$
  select a.product_id,
         round(sum(m.monthly_cost * a.pct / 100.0), 2) as amount
  from hub.team_members m
  join hub.team_allocations a on a.team_member_id = m.id
  where m.started_on <= (p_month + interval '1 month - 1 day')::date
    and (m.ended_on is null or m.ended_on >= p_month)
    and a.valid_from <= (p_month + interval '1 month - 1 day')::date
    and (a.valid_to is null or a.valid_to >= p_month)
  group by a.product_id
$$;

-- Alíquota total vigente para uma fonte num mês (soma dos tributos do Presumido)
create or replace function hub.tax_rate_for(p_source hub.source, p_month date)
returns numeric
language sql stable as $$
  select coalesce((
    select (pis_pct + cofins_pct + irpj_pct + csll_pct + iss_pct) / 100.0
    from hub.tax_params t
    where (t.applies_to_source = p_source or t.applies_to_source is null)
      and t.valid_from <= p_month
      and (t.valid_to is null or t.valid_to >= p_month)
    order by (t.applies_to_source is not null) desc, t.valid_from desc
    limit 1
  ), 0)
$$;

-- -----------------------------------------------------------------------------
-- 12. Views analíticas (o app lê daqui; regras de negócio ficam no banco)
-- -----------------------------------------------------------------------------

-- Receita por competência (mês da venda), por produto
create or replace view hub.v_revenue_accrual_monthly as
with o as (
  select o.product_id, hub.month_of(o.sold_at) as month, o.source,
         count(*) filter (where o.status in ('approved','partially_refunded')) as orders_count,
         sum(o.gross_amount - o.discount_amount) filter (where o.status in ('approved','partially_refunded')) as gross
  from hub.orders o
  group by 1,2,3
),
d as (
  select o.product_id, hub.month_of(o.sold_at) as month, o.source,
         sum(d.amount) filter (where d.kind in ('fee_platform','fee_gateway','fee_installment','fee_partner')) as fees,
         sum(d.amount) filter (where d.kind in ('commission_sales','commission_affiliate')) as commissions,
         sum(d.amount) filter (where d.kind in ('refund','chargeback')) as refunds
  from hub.order_deductions d
  join hub.orders o on o.id = d.order_id
  group by 1,2,3
)
select o.product_id, o.month, o.source,
       o.orders_count,
       coalesce(o.gross,0) as gross,
       coalesce(d.fees,0) as fees,
       coalesce(d.commissions,0) as commissions,
       coalesce(d.refunds,0) as refunds,
       round(coalesce(o.gross,0) * hub.tax_rate_for(o.source, o.month), 2) as taxes,
       coalesce(o.gross,0) - coalesce(d.fees,0) - coalesce(d.commissions,0) - coalesce(d.refunds,0)
         - round(coalesce(o.gross,0) * hub.tax_rate_for(o.source, o.month), 2) as net
from o left join d on d.product_id is not distinct from o.product_id and d.month = o.month and d.source = o.source;

-- Receita por caixa (mês do recebimento), por produto
create or replace view hub.v_revenue_cash_monthly as
select p.product_id, hub.month_of(p.paid_at) as month, p.source,
       count(*) as payments_count,
       sum(p.gross_amount) as gross,
       sum(p.fee_amount) as fees,
       sum(p.net_amount) as net_received,
       round(sum(p.gross_amount) * hub.tax_rate_for(p.source, hub.month_of(p.paid_at)), 2) as taxes
from hub.payments p
where p.status = 'received' and p.paid_at is not null
group by 1,2,3;

-- Investimento em mídia por produto e mês
create or replace view hub.v_ad_spend_monthly as
select product_id, platform, date_trunc('month', day)::date as month,
       sum(spend) as spend, sum(impressions) as impressions, sum(clicks) as clicks,
       sum(leads) as leads, sum(purchases) as purchases, sum(purchase_value) as purchase_value
from hub.ad_spend_daily
group by 1,2,3;

-- Margem por produto e mês (competência): receita líquida − mídia − pessoas alocadas − custos diretos − overhead rateado
create or replace view hub.v_product_pnl_monthly as
with rev as (
  select product_id, month,
         sum(gross) as gross, sum(fees + commissions + refunds) as deductions, sum(taxes) as taxes, sum(net) as net_revenue
  from hub.v_revenue_accrual_monthly group by 1,2
),
ads as (
  select product_id, month, sum(spend) as ad_spend from hub.v_ad_spend_monthly group by 1,2
),
months as (
  select distinct month from rev union select distinct month from ads
),
people as (
  select m.month, t.product_id, t.amount
  from months m cross join lateral hub.team_cost_by_product(m.month) t
),
direct as (
  select product_id, competence_month as month, sum(amount) as direct_costs
  from hub.cost_entries where product_id is not null group by 1,2
),
overhead as (
  select competence_month as month, sum(amount) as overhead
  from hub.cost_entries ce
  left join hub.cost_categories cc on cc.id = ce.category_id
  where ce.product_id is null and coalesce(cc.kind, 'fixed') not in ('pro_labore','distribution','tax')
  group by 1
),
overhead_people as (
  select m.month, t.amount as overhead_people
  from months m cross join lateral hub.team_cost_by_product(m.month) t
  where t.product_id is null
),
rev_share as (
  select product_id, month, gross / nullif(sum(gross) over (partition by month), 0) as share from rev
),
alloc as (
  select rs.product_id, rs.month,
         coalesce((select r.pct/100.0 from hub.overhead_allocation_rules r
                   where r.product_id = rs.product_id and r.valid_from <= rs.month
                     and (r.valid_to is null or r.valid_to >= rs.month)
                   order by r.valid_from desc limit 1), rs.share) as pct
  from rev_share rs
)
select p.id as product_id, p.slug, p.name, p.family, m.month,
       coalesce(rev.gross,0) as gross,
       coalesce(rev.deductions,0) as deductions,
       coalesce(rev.taxes,0) as taxes,
       coalesce(rev.net_revenue,0) as net_revenue,
       coalesce(ads.ad_spend,0) as ad_spend,
       coalesce(pe.amount,0) as people_cost,
       coalesce(dc.direct_costs,0) as direct_costs,
       round(coalesce(al.pct,0) * (coalesce(oh.overhead,0) + coalesce(ohp.overhead_people,0)), 2) as overhead_alloc,
       coalesce(rev.net_revenue,0) - coalesce(ads.ad_spend,0) as contribution_after_ads,
       coalesce(rev.net_revenue,0) - coalesce(ads.ad_spend,0) - coalesce(pe.amount,0) - coalesce(dc.direct_costs,0)
         - round(coalesce(al.pct,0) * (coalesce(oh.overhead,0) + coalesce(ohp.overhead_people,0)), 2) as profit,
       case when coalesce(rev.gross,0) > 0 then
         round(100.0 * (coalesce(rev.net_revenue,0) - coalesce(ads.ad_spend,0) - coalesce(pe.amount,0) - coalesce(dc.direct_costs,0)
           - round(coalesce(al.pct,0) * (coalesce(oh.overhead,0) + coalesce(ohp.overhead_people,0)), 2)) / rev.gross, 2)
       end as margin_pct,
       case when coalesce(ads.ad_spend,0) > 0 then round(coalesce(rev.gross,0) / ads.ad_spend, 2) end as roas
from hub.products p
cross join months m
left join rev on rev.product_id = p.id and rev.month = m.month
left join ads on ads.product_id = p.id and ads.month = m.month
left join people pe on pe.product_id = p.id and pe.month = m.month
left join direct dc on dc.product_id = p.id and dc.month = m.month
left join overhead oh on oh.month = m.month
left join overhead_people ohp on ohp.month = m.month
left join alloc al on al.product_id = p.id and al.month = m.month
where p.active;

-- DRE da empresa (competência) por mês
create or replace view hub.v_company_pnl_monthly as
select month,
       sum(gross) as gross,
       sum(deductions) as deductions,
       sum(taxes) as taxes,
       sum(net_revenue) as net_revenue,
       sum(ad_spend) as ad_spend,
       sum(people_cost) as people_cost,
       sum(direct_costs) as direct_costs,
       sum(overhead_alloc) as overhead,
       sum(profit) as profit,
       case when sum(gross) > 0 then round(100.0 * sum(profit) / sum(gross), 2) end as net_margin_pct,
       case when sum(gross) > 0 then round(100.0 * (sum(deductions) + sum(ad_spend)) / sum(gross), 2) end as variable_cost_pct
from hub.v_product_pnl_monthly
group by month;

-- Alunos ativos por produto (matriculado com acesso vigente hoje)
create or replace view hub.v_active_students as
select e.product_id, p.slug, p.name,
       count(distinct e.customer_id) as active_students
from hub.enrollments e
join hub.products p on p.id = e.product_id
where e.status = 'active'
  and e.access_start <= current_date
  and (e.access_end is null or e.access_end >= current_date)
group by 1,2,3;

-- MRR e churn mensal por produto de assinatura
create or replace view hub.v_mrr_monthly as
with months as (
  select generate_series(date_trunc('month', (select min(started_at) from hub.subscriptions)),
                         date_trunc('month', now()), interval '1 month')::date as month
),
norm as (
  select s.*,
         case s.interval when 'monthly' then s.amount when 'quarterly' then s.amount/3
              when 'semiannual' then s.amount/6 when 'annual' then s.amount/12 end as mrr
  from hub.subscriptions s
)
select m.month, n.product_id,
       count(*) filter (where n.started_at < m.month + interval '1 month'
                          and (n.canceled_at is null or n.canceled_at >= m.month + interval '1 month')
                          and (n.ended_at is null or n.ended_at >= m.month + interval '1 month')) as active_subs,
       round(sum(n.mrr) filter (where n.started_at < m.month + interval '1 month'
                          and (n.canceled_at is null or n.canceled_at >= m.month + interval '1 month')
                          and (n.ended_at is null or n.ended_at >= m.month + interval '1 month')), 2) as mrr,
       count(*) filter (where hub.month_of(n.started_at) = m.month) as new_subs,
       count(*) filter (where hub.month_of(n.canceled_at) = m.month) as churned_subs,
       count(*) filter (where n.started_at < m.month
                          and (n.canceled_at is null or n.canceled_at >= m.month)) as subs_start_of_month
from months m cross join norm n
group by 1,2;

-- Funil comercial por pipeline e mês de criação do negócio
create or replace view hub.v_funnel_monthly as
select d.pipeline_id, pl.name as pipeline, pl.product_id, hub.month_of(d.created_at) as month,
       d.owner_user_id,
       count(*) as deals_created,
       count(*) filter (where d.won_at is not null) as won,
       count(*) filter (where d.lost_at is not null) as lost,
       sum(d.value) filter (where d.won_at is not null) as won_value,
       round(100.0 * count(*) filter (where d.won_at is not null) / nullif(count(*),0), 2) as win_rate_pct,
       avg(extract(epoch from (d.won_at - d.created_at))/86400.0) filter (where d.won_at is not null) as avg_days_to_win
from hub.deals d
join hub.pipelines pl on pl.id = d.pipeline_id
group by 1,2,3,4,5;

-- ROAS diário por produto (mídia vs. receita bruta de competência do dia)
create or replace view hub.v_roas_daily as
with s as (
  select product_id, day, sum(spend) as spend, sum(leads) as leads, sum(purchases) as purchases
  from hub.ad_spend_daily group by 1,2
),
r as (
  select product_id, (sold_at at time zone 'America/Sao_Paulo')::date as day,
         sum(gross_amount - discount_amount) as gross, count(*) as orders_count
  from hub.orders where status in ('approved','partially_refunded') group by 1,2
)
select coalesce(s.product_id, r.product_id) as product_id,
       coalesce(s.day, r.day) as day,
       coalesce(s.spend,0) as spend, coalesce(s.leads,0) as leads, coalesce(s.purchases,0) as purchases,
       coalesce(r.gross,0) as gross, coalesce(r.orders_count,0) as orders_count,
       case when coalesce(s.spend,0) > 0 then round(coalesce(r.gross,0)/s.spend, 2) end as roas,
       case when coalesce(s.leads,0) > 0 then round(s.spend/s.leads, 2) end as cpl
from s full outer join r on r.product_id is not distinct from s.product_id and r.day = s.day;

-- -----------------------------------------------------------------------------
-- 13. Segurança: RLS por papel. Leitura ampla para admin/gestor/financeiro;
--     comercial e tráfego enxergam só o que é da sua área.
-- -----------------------------------------------------------------------------
create or replace function hub.current_role_() returns hub.role
language sql stable security definer set search_path = hub, public as $$
  select coalesce((select role from hub.users where auth_user_id = auth.uid() and active), 'leitura'::hub.role)
$$;

create or replace function hub.current_user_id() returns uuid
language sql stable security definer set search_path = hub, public as $$
  select id from hub.users where auth_user_id = auth.uid() and active
$$;

create or replace function hub.is_admin() returns boolean
language sql stable as $$ select hub.current_role_() = 'admin' $$;

create or replace function hub.can_read_finance() returns boolean
language sql stable as $$ select hub.current_role_() in ('admin','gestor','financeiro') $$;

create or replace function hub.can_read_sales() returns boolean
language sql stable as $$ select hub.current_role_() in ('admin','gestor','financeiro','comercial','trafego') $$;

do $$
declare t text;
begin
  for t in select tablename from pg_tables where schemaname = 'hub' loop
    execute format('alter table hub.%I enable row level security', t);
  end loop;
end $$;

-- Catálogo e pessoas: todos autenticados leem
create policy read_products on hub.products for select to authenticated using (true);
create policy read_product_refs on hub.product_source_refs for select to authenticated using (true);
create policy read_users on hub.users for select to authenticated using (true);
create policy read_customers on hub.customers for select to authenticated using (hub.can_read_sales());
create policy read_customer_refs on hub.customer_source_refs for select to authenticated using (hub.can_read_sales());

-- Vendas/assinaturas/alunos: quem lê vendas
create policy read_orders on hub.orders for select to authenticated using (hub.can_read_sales());
create policy read_deductions on hub.order_deductions for select to authenticated using (hub.can_read_finance());
create policy read_payments on hub.payments for select to authenticated using (hub.can_read_finance());
create policy read_subscriptions on hub.subscriptions for select to authenticated using (hub.can_read_sales());
create policy read_enrollments on hub.enrollments for select to authenticated using (hub.can_read_sales());

-- Tráfego
create policy read_ad_accounts on hub.ad_accounts for select to authenticated using (hub.can_read_sales());
create policy read_campaign_rules on hub.campaign_product_rules for select to authenticated using (hub.can_read_sales());
create policy read_ad_spend on hub.ad_spend_daily for select to authenticated using (hub.can_read_sales());

-- Comercial: leitura para quem lê vendas; escrita para comercial/admin/gestor
create policy read_pipelines on hub.pipelines for select to authenticated using (hub.can_read_sales());
create policy read_stages on hub.pipeline_stages for select to authenticated using (hub.can_read_sales());
create policy read_leads on hub.leads for select to authenticated using (hub.can_read_sales());
create policy read_deals on hub.deals for select to authenticated using (hub.can_read_sales());
create policy write_deals on hub.deals for all to authenticated
  using (hub.current_role_() in ('admin','gestor','comercial'))
  with check (hub.current_role_() in ('admin','gestor','comercial'));
create policy read_deal_events on hub.deal_stage_events for select to authenticated using (hub.can_read_sales());
create policy write_deal_events on hub.deal_stage_events for insert to authenticated
  with check (hub.current_role_() in ('admin','gestor','comercial'));
create policy read_deal_activities on hub.deal_activities for select to authenticated using (hub.can_read_sales());
create policy write_deal_activities on hub.deal_activities for insert to authenticated
  with check (hub.current_role_() in ('admin','gestor','comercial'));

-- Financeiro/custos: só finance
create policy read_team on hub.team_members for select to authenticated using (hub.can_read_finance());
create policy read_team_alloc on hub.team_allocations for select to authenticated using (hub.can_read_finance());
create policy read_cost_categories on hub.cost_categories for select to authenticated using (hub.can_read_finance());
create policy read_costs on hub.cost_entries for select to authenticated using (hub.can_read_finance());
create policy read_overhead_rules on hub.overhead_allocation_rules for select to authenticated using (hub.can_read_finance());
create policy read_tax on hub.tax_params for select to authenticated using (hub.can_read_finance());
create policy read_vump on hub.vump_statements for select to authenticated using (hub.can_read_finance());
create policy read_vump_lines on hub.vump_statement_lines for select to authenticated using (hub.can_read_finance());

-- Operação
create policy read_integrations on hub.integrations for select to authenticated using (true);
create policy read_sync_runs on hub.sync_runs for select to authenticated using (true);
create policy read_verdicts on hub.daily_verdicts for select to authenticated using (true);
create policy read_briefing on hub.briefing_items for select to authenticated using (true);
create policy write_briefing on hub.briefing_items for update to authenticated
  using (hub.current_role_() in ('admin','gestor')) with check (hub.current_role_() in ('admin','gestor'));
create policy read_targets on hub.targets for select to authenticated using (true);

-- Admin escreve em tudo (configurações, mapeamentos, rateios)
do $$
declare t text;
begin
  for t in select tablename from pg_tables where schemaname = 'hub' loop
    execute format('create policy admin_all_%1$s on hub.%1$I for all to authenticated using (hub.is_admin()) with check (hub.is_admin())', t);
  end loop;
end $$;

grant usage on schema hub to authenticated, service_role;
grant select on all tables in schema hub to authenticated;
grant all on all tables in schema hub to service_role;
grant execute on all functions in schema hub to authenticated, service_role;
alter default privileges in schema hub grant select on tables to authenticated;
alter default privileges in schema hub grant all on tables to service_role;

-- Integrações conhecidas (semente estrutural, não é dado de demonstração)
insert into hub.integrations (source, display_name, mode, enabled) values
  ('guru',      'Digital Manager Guru (checkout)',      'webhook', false),
  ('asaas',     'Asaas (meio de pagamento)',            'api',     false),
  ('vump',      'Voomp / Anhanguera (pós-graduação)',   'import',  false),
  ('curseduca', 'Curseduca (área de membros)',          'api',     false),
  ('geritools', 'GeriTools (Supabase)',                 'api',     false),
  ('clint',     'Clint (CRM comercial)',                'api',     false),
  ('meta',      'Meta Ads',                             'api',     false),
  ('google',    'Google Ads',                           'api',     false),
  ('contaazul', 'Conta Azul (financeiro/contábil)',     'api',     false),
  ('manual',    'Lançamentos manuais',                  'manual',  true);
