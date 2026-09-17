# Sincronizações (Supabase Edge Functions)

| Função | Fonte → destino | Gatilho |
|---|---|---|
| `hub-guru-webhook` | Guru → `orders`, `order_deductions`, `subscriptions` | webhook da Guru (vendas + assinaturas) |
| `hub-voomp-webhook` | Voomp → `orders` (pós-graduação) | webhook por produto na Voomp |
| `hub-sync-asaas` | Asaas → `payments` | pg_cron, a cada hora |
| `hub-sync-curseduca` | Curseduca → `enrollments` | pg_cron, a cada 2h |
| `hub-sync-geritools` | GeriTools (Supabase) → `subscriptions`, `enrollments` | pg_cron, a cada 2h |
| `hub-sync-clint` | Clint → `pipelines`, `pipeline_stages`, `deals`, `deal_stage_events`, `leads` | pg_cron, a cada hora |
| `hub-sync-meta` | Meta Insights → `ad_spend_daily` | pg_cron, a cada hora |
| `hub-sync-google-ads` | Google Ads → `ad_spend_daily` | pg_cron, a cada hora |
| `hub-sync-contaazul` | Conta Azul → `cost_entries` | pg_cron, diário 06h UTC |

Todas aceitam `?from=YYYY-MM-DD&to=YYYY-MM-DD` para backfill e registram em `hub.sync_runs`.

## Deploy

```bash
supabase link --project-ref <ref>
supabase secrets set GURU_WEBHOOK_SECRET=... ASAAS_API_KEY=... CURSEDUCA_API_KEY=... CLINT_API_TOKEN=... \
  META_ACCESS_TOKEN=... GOOGLE_ADS_DEVELOPER_TOKEN=... GOOGLE_OAUTH_CLIENT_ID=... GOOGLE_OAUTH_CLIENT_SECRET=... \
  GOOGLE_ADS_REFRESH_TOKEN=... CONTAAZUL_CLIENT_ID=... CONTAAZUL_CLIENT_SECRET=... CONTAAZUL_REFRESH_TOKEN=... \
  GERITOOLS_SUPABASE_URL=... GERITOOLS_SERVICE_ROLE_KEY=... VOOMP_WEBHOOK_SECRET=...
supabase functions deploy
```

Depois: `insert into hub.cron_config (key, value) values ('functions_url', 'https://<ref>.supabase.co/functions/v1'), ('anon_key', '<anon>');` e aplicar `supabase/migrations/0002_cron_and_verdict.sql` com `pg_cron` e `pg_net` habilitados.

## Mapeamentos obrigatórios (uma vez)

- `hub.product_source_refs`: id do produto na Guru, uuid do grupo de acesso na Curseduca, id do produto na Voomp, `geritools` para o GeriTools.
- `hub.ad_accounts`: contas Meta (`act_…`) e Google (customer id) com o produto de cada uma; `hub.campaign_product_rules` quando uma conta serve vários produtos.
- `hub.users`: e-mails de quem pode entrar e o papel; vendedores do Clint são ligados por e-mail.

## Checagem de tipos sem Deno

`npx tsc -p supabase/functions/tsconfig.json` (a partir de `apps/hub`, para reaproveitar o `node_modules`). O `deno.d.ts` é só um shim para esse fim.
