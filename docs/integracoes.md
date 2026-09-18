# Integrações · o que cada fonte oferece e como o hub consome

Levantamento feito em 15/09/2026 sobre a documentação pública. Itens marcados **[confirmar]** dependem de acesso ao painel da plataforma ou de resposta do suporte.

| Fonte | Papel no hub | Modo | Acesso | Situação |
|---|---|---|---|---|
| **Digital Manager Guru** | Vendas (competência), assinaturas, contatos, UTM | Webhook (tempo real) + API (backfill) | Token em *Meu Perfil → Tokens API* | Pronto para conectar |
| **Asaas** | Recebimentos (caixa), taxas reais, parcelas, estornos | API (sincronização horária) | `access_token` da conta | Pronto para conectar |
| **Voomp (Cogna/Anhanguera)** | Vendas e repasses das pós-graduações | Webhook por produto + importação do extrato | Painel do produtor | Webhook existe; extrato de repasse **[confirmar formato]** |
| **Curseduca** | Alunos ativos (acesso vigente), progresso | API (sincronização horária) | Header `api_key` gerado no painel | Pronto para conectar |
| **GeriTools** | Produto do painel; vendas e assinaturas chegam pela Guru | (via Guru) | — | Sem integração própria |
| **Clint CRM** | Funil, negócios, vendedores, motivos de perda | API (sincronização horária) | Header `api-token`, **só no plano Elite** | **[confirmar plano]** |
| **Meta Ads** | Investimento, cliques, leads e compras por campanha/dia | Marketing API (Insights) | Token de sistema + `act_id` | Pronto para conectar |
| **Google Ads** | Idem Meta | Google Ads API (GAQL) | Developer token + OAuth refresh token | Pedir developer token (aprovação Google) |
| **Conta Azul** | Despesas, folha, categorias da DRE | API v2 (OAuth 2.0) | `client_id/secret` do portal de desenvolvedores | Pedir credenciais de desenvolvedor |

## Digital Manager Guru (checkout)

- Documentação: <https://docs.digitalmanager.guru/developers/> (transações, assinaturas, status, webhooks).
- Autenticação por token de usuário; limite de **360 requisições/min por conta**; paginação por cursor (`next_cursor`, `has_more_pages`, `per_page`, `total_rows`).
- **Webhooks de vendas e de assinaturas**: configurados em *Configurações → Webhooks*, por produto ou marketplace, com escolha dos status. Re-tentativa automática exceto para 401/403/404/406/410/422.
- Payload da transação (campos que o hub usa):
  - `id`, `dates.ordered_at`, `dates.confirmed_at`, `dates.canceled_at`
  - `status` (aprovada, pendente, reembolsada, chargeback, cancelada, expirada…)
  - `product.id`, `product.name`, `product.marketplace_id`, `product.offer.id`, `product.qty`, `product.unit_value`, `product.total_value`
  - `contact.id`, `contact.name`, `contact.email`, `contact.doc`, `contact.phone_number`, endereço
  - `payment.method`, `payment.total`, `payment.gross`, `payment.net`, `payment.discount_value`, `payment.marketplace_id`, `installments.qty`, `installments.value`, `installments.interest`, `acquirer.tid`
  - `source.utm_source|utm_medium|utm_campaign|utm_content|utm_term`, `source.checkout_source`
  - `affiliations[]` (valor, taxa) e `invoice.*` (ciclo de assinatura)
  - Assinatura: `subscription_code`, `last_status`, `charged_every_days`, `charged_times`, `trial_days`, `cancel_reason`, `cancelled_by.*`, `next_cycle_value`, `last_transaction`
- Como o hub usa: cada transação vira uma linha em `hub.orders` (competência = `ordered_at`), `payment.gross − payment.net` vira dedução de taxas, `installments.interest` vira `fee_installment`, reembolso/chargeback viram deduções na data do evento. Assinaturas alimentam `hub.subscriptions` (MRR, churn).
- Guru já tem integração nativa com **Asaas** (meio de pagamento) e com **Curseduca** (libera acesso via webhook; cada código de produto da Guru vira "referência externa" de um grupo de acesso na Curseduca).
- **[confirmar]** a URL base da API v2 e o formato do header no painel; a documentação pública não expõe os endpoints de listagem sem login.

## Asaas (meio de pagamento)

- Documentação: <https://docs.asaas.com/>. Produção `https://api.asaas.com/v3`, sandbox `https://api-sandbox.asaas.com/v3`. Header `access_token`.
- `GET /v3/payments` com filtros `paymentDate[ge|le]`, `dateCreated[ge|le]`, `dueDate[ge|le]`, `status`, `billingType`, `customer`, `subscription`, `externalReference`; paginação `offset/limit` (máx. 100), resposta com `hasMore`, `totalCount`.
- Campos usados: `id`, `value`, `netValue` (líquido de taxas Asaas), `originalValue`, `status` (PENDING, RECEIVED, CONFIRMED, OVERDUE, REFUNDED…), `billingType`, `paymentDate`, `clientPaymentDate`, `dueDate`, `installmentNumber`, `externalReference`, `customer`.
- Como o hub usa: cada cobrança vira `hub.payments` (caixa = `paymentDate`; `fee_amount = value − netValue`). Ligação com o pedido da Guru por `externalReference` quando presente, senão por e-mail + valor + data. Extrato (`/v3/financialTransactions`) fica para conciliação bancária na V3.

## Voomp Creators (pós-graduação com Anhanguera)

- É a plataforma de creators do grupo Cogna; parceiros de conteúdo vendem pós-graduação, MBA e extensão com a marca Anhanguera.
- **Webhook por produto** (*Produtos → Editar → Entregas → Adicionar entrega → Webhook*), com eventos de **Venda**, **Assinatura** e **Checkout abandonado**; aceita um token de validação. Payload não documentado publicamente **[confirmar campos com um evento de teste]**.
- Taxas públicas da Voomp para o produtor: **7,99% + R$ 1,00** por venda aprovada, saque R$ 4,99, antecipação 3,14%. A **participação da Anhanguera na pós** não é pública e precisa vir do contrato **[confirmar percentual]**.
- Sem API pública de relatórios encontrada. Caminho do hub: (1) webhook para registrar cada matrícula em tempo real como `hub.orders` (source `vump`); (2) importação mensal do extrato de repasse (CSV/XLSX do painel) para `hub.vump_statements` → `hub.payments`, fechando a diferença entre o que foi vendido e o que efetivamente entrou.
- A bitributação (Voomp fatura no CNPJ deles; GeriClass declara o repasse) está modelada em `hub.tax_params` com `applies_to_source = 'vump'`.

## Curseduca (área de membros)

- Documentação: <https://help.curseduca.com/api/api> (redireciona para help.waid.io) → Swagger em `https://prof.curseduca.pro/docs` (membros) e `https://clas.curseduca.pro/docs` (conteúdos).
- Autenticação por header `api_key` (ou bearer `access-token`). Paginação `limit/offset`, resposta com `hasMore`, `totalCount`.
- Endpoints usados: `GET /members` (com `situation` ACTIVE/INACTIVE/BLOCKED, `lastLogin`, `groups`), `GET /groups`, `GET /groups/{groupId}/members`, filtros `enteredSince/enteredUntil`, `expiresSince/expiresUntil`, `customExpirationDate`; relatórios `GET /api/reports/enrollments` e `GET /reports/progress`.
- Como o hub usa: cada membro × grupo de acesso vira `hub.enrollments` (aluno ativo = `situation = ACTIVE` e data de expiração no futuro ou nula). Grupo de acesso ↔ produto via `hub.product_source_refs (source = curseduca)`.

## GeriTools

- É um produto do painel como os outros: vendas e assinaturas (MRR, churn) chegam pelo webhook da Guru. Não há integração com o software em si.

## Clint CRM

- Documentação: <https://clint-api.readme.io/>. Base `https://api.clint.digital`, header `api-token`. **A chave de API só existe no plano Elite.**
- Endpoints: `GET /v1/deals` (filtros por grupo/pipeline, etapa, datas, responsável), `GET /v2/deals/{id}/history` (linha do tempo de etapas), `GET /v1/groups` (pipelines e etapas), `GET /v1/lost-status`, `GET /v1/origins`, `GET /v1/users`, `GET /v1/contacts`, `GET /v2/activities`. Paginação `limit` (até 1000) / `page`, resposta com `totalCount`, `hasNext`.
- Webhooks públicos só para SMS/voz; os eventos de negócio o hub obtém por sincronização horária.
- Como o hub usa: `groups` → `hub.pipelines` + `hub.pipeline_stages`; `deals` → `hub.deals` (com `won_at`, `lost_at`, `lost_reason`, `owner`); `history` → `hub.deal_stage_events` (tempo por etapa e conversão etapa a etapa); `origins` → `hub.leads.origin`.
- Alternativa se o plano não for Elite: automação nativa do Clint enviando webhook a cada mudança de etapa (a Clint tem automações nativas com webhook de saída) **[confirmar]**, ou registrar o pipeline consultivo da mentoria diretamente no hub (as tabelas já existem).

## Meta Ads

- Marketing API (Insights): `GET /v20.0/act_{id}/insights?level=campaign&time_increment=1&fields=campaign_id,campaign_name,spend,impressions,clicks,actions,action_values&time_range={since,until}`.
- Precisa de um **token de usuário de sistema** (Business Manager) com permissão `ads_read` nas contas. Uma conta por produto (padrão atual) ou regra por nome de campanha (`hub.campaign_product_rules`).

## Google Ads

- Google Ads API via REST `searchStream` com GAQL: `SELECT campaign.id, campaign.name, segments.date, metrics.cost_micros, metrics.impressions, metrics.clicks, metrics.conversions FROM campaign WHERE segments.date BETWEEN ...`.
- Precisa de **developer token** (aprovação do Google, nível básico basta), OAuth `refresh_token` de um usuário com acesso à conta e `login-customer-id` da MCC se houver.

## Conta Azul

- Documentação: <https://developers.contaazul.com/>. Base `https://api-v2.contaazul.com`, OAuth 2.0 (autorização em `https://auth.contaazul.com/login`, token em `https://auth.contaazul.com/oauth2/token`, access token de 1h com refresh). Sem sandbox; conta de desenvolvedor de 30 dias para testes.
- Endpoints: `GET /v1/financeiro/eventos-financeiros/contas-a-pagar/buscar` e `.../contas-a-receber/buscar` (filtros por competência, vencimento, status), `GET /v1/financeiro/eventos-financeiros/{id}/parcelas`, `GET /v1/categorias`, `GET /v1/financeiro/categorias-dre`, `GET /v1/centro-de-custo`, `GET /v1/conta-financeira/{id}/saldo-atual`.
- Como o hub usa: contas a pagar → `hub.cost_entries` (competência, categoria, centro de custo → produto quando houver). Categorias do Conta Azul mapeadas para `hub.cost_categories` uma única vez.

## O que preciso de você para ligar cada fonte

1. **Guru**: token de API e liberação para eu cadastrar 2 webhooks (vendas e assinaturas, todos os status) apontando para o hub.
2. **Asaas**: chave de API de leitura da conta principal.
3. **Voomp**: um evento de webhook de teste (para ver o payload) e um extrato de repasse recente (para eu modelar a importação). Percentual da Anhanguera no contrato.
4. **Curseduca**: `api_key` do painel e a lista de grupos de acesso ↔ produto.
5. **Clint**: confirmar se o plano é Elite; se sim, a chave.
6. **Meta**: acesso de leitura às contas de anúncio no Business Manager (eu gero o token de sistema).
7. **Google Ads**: acesso à conta/MCC e pedido do developer token (eu conduzo).
8. **Conta Azul**: cadastro de aplicativo no portal de desenvolvedores (eu conduzo, você autoriza uma vez).
