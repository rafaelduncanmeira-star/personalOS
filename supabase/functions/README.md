# Sincronizações (Supabase Edge Functions)

| Função | Fonte → destino | Gatilho |
|---|---|---|
| `hub-guru-webhook` | Guru → `orders`, `order_deductions`, `subscriptions` | webhook da Guru (vendas + assinaturas) |
| `hub-voomp-webhook` | Voomp → `orders` (pós-graduação) | webhook por produto na Voomp |
| `hub-sync-asaas` | Asaas → `payments` | pg_cron, a cada hora |
| `hub-sync-curseduca` | Curseduca → `enrollments` | pg_cron, a cada 2h |
| `hub-sync-clint` | Clint → `pipelines`, `pipeline_stages`, `deals`, `deal_stage_events`, `leads` | pg_cron, a cada hora |
| `hub-sync-meta` | Meta Insights → `ad_spend_daily` | pg_cron, a cada hora |
| `hub-sync-google-ads` | Google Ads → `ad_spend_daily` | pg_cron, a cada hora |
| `hub-sync-contaazul` | Conta Azul → `cost_entries` | pg_cron, diário 06h UTC |

Todas aceitam `?from=YYYY-MM-DD&to=YYYY-MM-DD` para backfill e registram em `hub.sync_runs`.

## Deploy

```bash
supabase link --project-ref <ref>
-- Segredos: cadastrar no Vault por SQL, sempre com prefixo HUB_ (o projeto é compartilhado com o GeriTools):
--   select vault.create_secret('<valor>', 'HUB_ASAAS_API_KEY');  -- idem HUB_CURSEDUCA_API_KEY, HUB_CLINT_API_TOKEN, HUB_META_ACCESS_TOKEN,
--   HUB_GOOGLE_ADS_DEVELOPER_TOKEN, HUB_GOOGLE_OAUTH_CLIENT_ID, HUB_GOOGLE_OAUTH_CLIENT_SECRET, HUB_GOOGLE_ADS_REFRESH_TOKEN,
--   HUB_CONTAAZUL_CLIENT_ID, HUB_CONTAAZUL_CLIENT_SECRET, HUB_CONTAAZUL_REFRESH_TOKEN, HUB_GURU_WEBHOOK_SECRET, HUB_VOOMP_WEBHOOK_SECRET
supabase functions deploy
```

Depois: `insert into hub.cron_config (key, value) values ('functions_url', 'https://<ref>.supabase.co/functions/v1'), ('anon_key', '<anon>');` e aplicar `supabase/migrations/0002_cron_and_verdict.sql` com `pg_cron` e `pg_net` habilitados.

## Mapeamentos obrigatórios (uma vez)

- `hub.product_source_refs`: id do produto na Guru, uuid do grupo de acesso na Curseduca, id do produto na Voomp (o GeriTools entra como produto da Guru, sem ref própria).
- `hub.ad_accounts`: contas Meta (`act_…`) e Google (customer id) com o produto de cada uma; `hub.campaign_product_rules` quando uma conta serve vários produtos.
- `hub.users`: e-mails de quem pode entrar e o papel; vendedores do Clint são ligados por e-mail.

## Checagem de tipos sem Deno

`npx tsc -p supabase/functions/tsconfig.json` (a partir de `apps/hub`, para reaproveitar o `node_modules`). O `deno.d.ts` é só um shim para esse fim.
