# personalOS · Geri Hub

Painel de gestão da GeriClass: vendas, caixa, tráfego, alunos, comercial e DRE gerencial num só lugar, alimentado por integrações (sem planilha manual).

```
apps/hub/                 Next.js 16 (App Router) — o painel
supabase/migrations/      schema `hub` (tabelas, views, RLS), agendamentos e a camada de leitura em `public.hub_*`
supabase/seed_demo.sql    dados ilustrativos para desenvolvimento
supabase/functions/       sincronizações (Guru, Voomp, Asaas, Curseduca, GeriTools, Clint, Meta, Google, Conta Azul)
docs/                     proposta, integrações, mensagem para o gestor
```

## Como funciona em produção

- **Banco**: schema `hub` dentro do projeto Supabase da GeriClass (`ogwepzrwmywnubfgndpn`, sem custo extra).
- **Leitura**: o app chama funções `public.hub_*` via PostgREST com a sessão do usuário. RLS por papel (`hub.users.role`). Nenhum segredo fica na Vercel; URL e chave publicável são públicas e estão em `apps/hub/src/lib/supabase-config.ts`.
- **Login**: magic link do Supabase Auth. Só e-mails cadastrados em `hub.users` entram; os demais caem em `/sem-acesso`.
- **App**: Vercel, projeto `geri-hub`, raiz `apps/hub`, deploy a cada push na branch de produção.
- **Sincronizações**: Edge Functions agendadas por `pg_cron` (pausadas até as chaves existirem).

## Rodar local

Pré-requisitos: Node 22, pnpm, Postgres 16.

```bash
createdb hubtest
psql hubtest -f supabase/migrations/0001_init.sql
psql hubtest -f supabase/migrations/0002_cron_and_verdict.sql   # precisa de um stub de net.http_post fora do Supabase
psql hubtest -f supabase/migrations/0003_public_rpc.sql
psql hubtest -f supabase/seed_demo.sql

cd apps/hub && cp .env.example .env.local && pnpm install && pnpm dev
```

Fora do Supabase, crie antes os stubs de `auth.uid()`, `auth.jwt()` e os papéis `authenticated`, `anon`, `service_role` (ver `docs/proposta-geri-hub.md` → "Ambiente local").

## Dar acesso a alguém

```sql
insert into hub.users (email, name, role) values ('pessoa@gericlass.com.br', 'Nome', 'gestor');
-- papéis: admin, gestor, comercial, trafego, financeiro, leitura
```

Detalhes, decisões e roadmap: `docs/proposta-geri-hub.md`. Integrações: `docs/integracoes.md`.
