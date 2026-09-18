-- P4 · Token Vault activation + service-role secret helpers
--
-- Scope: enables Supabase Vault and provides the stable secret API the worker
-- and Edge Functions program against. P2's channel_tokens / oauth_states rows
-- store secret ids; the ciphertext itself lives here and is NEVER readable by
-- authenticated clients (no grants below except to service_role).
--
-- Prerequisite: none beyond this push — the extension is created here so the
-- db push is self-contained (pg_cron still needs the dashboard step per P3).

create extension if not exists "supabase_vault" with schema "vault";

-- -------------------------------------------------------- helper wrappers ---
-- Thin SECURITY DEFINER wrappers so callers never touch vault.* directly.
-- Owner-only execution: revoked from anon/authenticated, granted to
-- service_role. The worker uses the service key; Edge Functions use their
-- service-role client.

create or replace function vault_create_secret(secret text, secret_name text, secret_description text default '')
returns uuid
language plpgsql security definer set search_path = public, vault as $$
declare
  sid uuid;
begin
  select vault.create_secret(secret, secret_name, secret_description) into sid;
  return sid;
end $$;

create or replace function vault_read_secret(secret_id uuid)
returns text
language plpgsql security definer set search_path = public, vault as $$
declare
  plain text;
begin
  select decrypted_secret into plain
    from vault.decrypted_secrets
   where id = secret_id;
  return plain;
end $$;

create or replace function vault_update_secret(secret_id uuid, secret text)
returns void
language plpgsql security definer set search_path = public, vault as $$
begin
  perform vault.update_secret(secret_id, secret);
end $$;

create or replace function vault_delete_secret(secret_id uuid)
returns void
language plpgsql security definer set search_path = public, vault as $$
begin
  perform vault.delete_secret(secret_id);
end $$;

-- ----------------------------------------------------------------- grants ---
revoke all on function vault_create_secret(text, text, text) from public, anon, authenticated;
revoke all on function vault_read_secret(uuid) from public, anon, authenticated;
revoke all on function vault_update_secret(uuid, text) from public, anon, authenticated;
revoke all on function vault_delete_secret(uuid) from public, anon, authenticated;

grant execute on function vault_create_secret(text, text, text) to service_role;
grant execute on function vault_read_secret(uuid) to service_role;
grant execute on function vault_update_secret(uuid, text) to service_role;
grant execute on function vault_delete_secret(uuid) to service_role;
