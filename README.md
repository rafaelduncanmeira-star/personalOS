# personalOS · Geri Hub

Painel de gestão da GeriClass: vendas, caixa, tráfego, alunos, comercial e DRE gerencial num só lugar, alimentado por integrações (sem planilha manual).

```
apps/hub/                 Next.js 16 (App Router) — o painel
supabase/migrations/      schema `hub` (tabelas, views analíticas, RLS)
supabase/seed_demo.sql    dados ilustrativos para desenvolvimento
supabase/functions/       sincronizações (Guru, Asaas, Meta, Google, Curseduca, Clint, Conta Azul)
docs/                     proposta, regras da DRE, integrações
```

## Rodar local

Pré-requisitos: Node 22, pnpm, Postgres 16 (ou um projeto Supabase).

```bash
# 1. banco local com o schema + dados demo
createdb hubtest
psql hubtest -f supabase/migrations/0001_init.sql
psql hubtest -f supabase/seed_demo.sql

# 2. app
cd apps/hub
cp .env.example .env.local     # ajuste DATABASE_URL; HUB_AUTH_MODE=dev dispensa login
pnpm install
pnpm dev
```

No Postgres local (fora do Supabase) crie antes um shim de `auth.uid()` e dos papéis `authenticated`/`service_role`; veja `docs/proposta-geri-hub.md` → "Ambiente local".

## Produção (resumo)

- Banco: projeto Supabase dedicado ao hub (separado do GeriTools). Aplicar `supabase/migrations`.
- App: Vercel, projeto `geri-hub`, apontando para `apps/hub`. Variáveis conforme `apps/hub/.env.example`.
- Domínio: subdomínio no Cloudflare (ex.: `hub.gericlass.com.br`) com CNAME para a Vercel.
- Login: Supabase Auth por magic link; só e-mails presentes em `hub.users` entram, com papel (admin, gestor, comercial, tráfego, financeiro).

Detalhes, decisões e roadmap: `docs/proposta-geri-hub.md`.
