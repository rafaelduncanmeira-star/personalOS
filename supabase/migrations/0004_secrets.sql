-- =============================================================================
-- Segredos das integrações no Supabase Vault, lidos pelas Edge Functions via service role.
-- Cadastro por SQL:  select vault.create_secret('<valor>', 'GURU_WEBHOOK_SECRET');
-- Rotação:           select vault.update_secret((select id from vault.secrets where name='X'), '<novo>');
-- =============================================================================

create or replace function public.hub_secret(p_name text) returns text
language sql stable security definer set search_path = vault, public as $$
  select decrypted_secret from vault.decrypted_secrets where name = p_name order by created_at desc limit 1
$$;
revoke all on function public.hub_secret(text) from public, anon, authenticated;
grant execute on function public.hub_secret(text) to service_role;
