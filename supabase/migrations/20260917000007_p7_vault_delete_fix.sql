-- P7 · Vault delete wrappers that cannot silently orphan secrets
--
-- Root cause (verified on-device): the `vault.delete_secret()` API call
-- inside P4's wrapper was not deleting, so toggle-off/disconnect left orphan
-- secrets behind while deleting channel rows. The next toggle-on then died
-- on Vault's unique name constraint ("secrets_name_idx").
--
-- Fix: delete by direct row DELETE as owner (no dependency on Vault's
-- function API), plus a by-name variant so import can deterministically
-- clear canonical names before creating.

create or replace function vault_delete_secret(secret_id uuid)
returns void
language plpgsql security definer set search_path = public as $$
begin
  delete from vault.secrets where id = secret_id;
end $$;

create or replace function vault_delete_secret_by_name(secret_name text)
returns void
language plpgsql security definer set search_path = public as $$
begin
  delete from vault.secrets where name = secret_name;
end $$;

revoke all on function vault_delete_secret(uuid) from public, anon, authenticated;
revoke all on function vault_delete_secret_by_name(text) from public, anon, authenticated;

grant execute on function vault_delete_secret(uuid) to service_role;
grant execute on function vault_delete_secret_by_name(text) to service_role;
