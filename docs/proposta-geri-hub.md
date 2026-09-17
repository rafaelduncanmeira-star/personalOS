# Geri Hub · proposta de arquitetura e plano

**Objetivo.** Um painel de gestão separado do GeriTools, só para a gestão da GeriClass, que responda todo dia sem alimentação manual: quanto vendemos, quanto entrou, quanto sobra depois de taxas, mídia, equipe e impostos, quantos alunos temos, como o comercial está convertendo e onde a mídia está rendendo.

**Quem usa.** Rafael e Daniel (admin), Chico (gestor, diariamente), comercial (funil), tráfego (mídia e ROAS), financeiro (DRE).

## 1. Arquitetura

```
 Guru ─webhook─┐                          ┌─ Next.js (Vercel) · hub.gericlass.com.br (DNS Cloudflare)
 Asaas ─API───┤                          │    Home · Vendas · Tráfego · Comercial · Financeiro · Produto
 Voomp ─webhook/extrato─┤  Supabase       │
 Curseduca ─API─┼──▶  schema `hub`  ◀────┤    login por magic link (Supabase Auth), papéis em hub.users
 GeriTools ─DB──┤     tabelas + views     │
 Clint ─API────┤     RLS por papel        └─ Edge Functions (sincronizações) agendadas por pg_cron
 Meta/Google ─API┤
 Conta Azul ─API┘
```

- **Banco**: schema `hub` dentro do projeto Supabase já existente da GeriClass (sem custo adicional). As regras de negócio (DRE, rateio, MRR, ROAS) vivem em views SQL, então qualquer ferramenta (o app, uma planilha, um agente) lê os mesmos números. A leitura pelo app passa por funções `public.hub_*` chamadas com a sessão do usuário, então a RLS por papel vale de ponta a ponta e a Vercel não guarda nenhum segredo.
- **Sincronizações**: Supabase Edge Functions em `supabase/functions/`, uma por fonte, chamadas pelo `pg_cron` (horária para vendas/mídia/CRM, diária para financeiro). Guru e Voomp chegam por webhook em tempo real. Cada execução registra em `hub.sync_runs` (status, linhas, erro) e aparece na página Integrações.
- **App**: Next.js 16 (App Router, server components) em `apps/hub`, lê o banco direto e aplica o papel do usuário. Sem estado no cliente além dos gráficos.
- **Hospedagem**: Vercel (projeto `geri-hub`, como os demais projetos da conta) com subdomínio no Cloudflare.
- **Segredos**: só em variáveis de ambiente da Vercel e das Edge Functions; nunca no banco (`hub.integrations.config` guarda apenas ids e cursores).

## 2. Modelo de dados (resumo)

| Bloco | Tabelas | Alimentado por |
|---|---|---|
| Catálogo | `products`, `product_source_refs` | manual (uma vez) |
| Pessoas | `customers`, `customer_source_refs` | Guru, Voomp, Curseduca, Clint |
| Vendas (competência) | `orders`, `order_deductions` | Guru, Voomp |
| Caixa | `payments` | Asaas, extrato Voomp |
| Assinaturas | `subscriptions` | Guru, GeriTools |
| Alunos | `enrollments` | Curseduca, GeriTools, Voomp |
| Mídia | `ad_accounts`, `campaign_product_rules`, `ad_spend_daily` | Meta, Google |
| Comercial | `pipelines`, `pipeline_stages`, `leads`, `deals`, `deal_stage_events`, `deal_activities` | Clint (ou registro nativo) |
| Custos | `team_members`, `team_allocations`, `cost_categories`, `cost_entries`, `overhead_allocation_rules`, `tax_params` | Conta Azul + cadastro |
| Operação | `integrations`, `sync_runs`, `daily_verdicts`, `briefing_items`, `targets`, `vump_statements` | hub |

Views: `v_revenue_accrual_monthly`, `v_revenue_cash_monthly`, `v_ad_spend_monthly`, `v_product_pnl_monthly`, `v_company_pnl_monthly`, `v_active_students`, `v_mrr_monthly`, `v_funnel_monthly`, `v_roas_daily`.

## 3. Regras da DRE gerencial (para validar com o contador)

Competência = mês da venda (`orders.sold_at`). Caixa = mês do recebimento (`payments.paid_at`). O painel mostra os dois; o **lucro líquido oficial é o de competência**.

```
Receita bruta                 soma de (valor − desconto) dos pedidos aprovados
(−) Deduções                  taxa Guru, taxa Asaas, juros de parcelamento,
                              repasse Voomp/Anhanguera, comissão comercial,
                              afiliados, reembolsos, chargebacks
(−) Impostos sobre a receita  Lucro Presumido, serviços:
                              PIS 0,65% + COFINS 3% + IRPJ 4,8% + CSLL 2,88% + ISS (municipal, 2–5%)
                              = ~16,3% com ISS de 5% (adicional de IRPJ calculado à parte, trimestral)
                              repasse Voomp tributado de novo no recebimento (bitributação)
= Receita líquida
(−) Mídia paga                Meta + Google, por produto (conta ou regra de campanha)
(−) Pessoas alocadas          custo mensal × % de alocação por pessoa e produto
(−) Custos diretos            despesas lançadas com produto (ex.: local do evento)
(−) Overhead rateado          pessoas sem produto (diretoria, gestão, design, tráfego) + custos fixos,
                              rateados por regra cadastrada ou proporcionalmente à receita bruta
= Lucro líquido               pró-labore e distribuição ficam fora (são destino do lucro, não custo)
```

Decisões já tomadas com você: deduções entram no produto; rateio de fixos é por alocação direta de pessoa; custo variável = deduções + mídia sobre receita bruta (meta atual 33%).

Pendências para o contador: alíquota de ISS do município, se há adicional de IRPJ recorrente, e como está sendo declarado o repasse da Voomp (base de cálculo).

## 4. Regras de status e alertas

- **Saudável**: margem ≥ meta do produto. **Atenção**: abaixo da meta. **Crítico**: margem < 10% (ou < ⅓ da meta) ou negativa.
- **Veredito do dia** (04h): texto gerado por regras a partir das views (receita vs. mesmo período, custo variável vs. meta, produto que mais pesa, produto que mais cresce). Na V2 o texto passa por um modelo Claude com os mesmos números, mantendo as regras como base.
- **Briefing de segunda**: itens gerados pelas regras + itens manuais; marcáveis como decididos.

## 5. Roadmap

**V1 (2–3 semanas) · visibilidade de receita, caixa, mídia e alunos** — *entregue como base neste repositório com dados de demonstração*
1. Projeto Supabase do hub + migration + usuários.
2. Webhook Guru (vendas e assinaturas) + backfill dos últimos 12 meses pela API.
3. Sincronização Asaas (caixa) e conciliação com pedidos.
4. Curseduca + GeriTools → alunos ativos, MRR, churn.
5. Meta + Google → mídia diária e ROAS por produto.
6. Voomp: webhook + importação do extrato.
7. Deploy Vercel + domínio + login.

**V2 (2 semanas) · comercial e inteligência**
1. Clint → funil, vendedores, motivos de perda (ou registro nativo se o plano não tiver API).
2. Pipeline consultivo da mentoria (aplicação → call → proposta → fechamento) dentro do hub.
3. Veredito diário com Claude, alertas por WhatsApp/e-mail quando um produto virar crítico.

**V3 (2 semanas) · DRE completa**
1. Conta Azul → despesas e folha; cadastro de equipe e alocação.
2. Impostos parametrizados e validados com o contador; DRE mensal fechada.
3. Metas mensais por produto e acompanhamento.

## 6. Ambiente local

Postgres fora do Supabase não tem `auth.uid()` nem os papéis `authenticated`/`service_role`. Antes da migration, rode:

```sql
create schema if not exists auth;
create or replace function auth.uid() returns uuid language sql stable as
  $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
do $$ begin
  if not exists (select 1 from pg_roles where rolname='authenticated') then create role authenticated nologin; end if;
  if not exists (select 1 from pg_roles where rolname='service_role') then create role service_role nologin; end if;
end $$;
```

## 7. Decisões em aberto (precisam de você)

1. Nome do subdomínio (`hub.gericlass.com.br`?).
2. No Supabase, *Authentication → URL Configuration*: Site URL com o endereço do hub na Vercel (único ajuste que a API não permite fazer por mim).
3. Credenciais e acessos listados em `docs/integracoes.md`.
4. Percentual da Anhanguera/Voomp e ISS para fechar a DRE.
