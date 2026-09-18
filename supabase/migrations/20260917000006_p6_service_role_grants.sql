-- P6 · Service-role table grants (fixes 403-everywhere server-side)
--
-- Root cause (verified from function error payloads): tables created by db
-- push carry grants to `authenticated` only. service_role bypasses RLS but
-- still needs table privileges — without them every service-side read
-- (Edge Functions, Railway worker direct reads) fails with
-- "permission denied for table …", surfacing as phantom 403s.
-- SECURITY DEFINER functions (claim_job, vault_*, purge_expired_media) were
-- unaffected (they run as owner); only direct table access was broken.

grant all on all tables in schema public to service_role;
grant all on all sequences in schema public to service_role;

-- Future tables (later migrations) inherit the same grants automatically.
alter default privileges for role postgres in schema public
  grant all on tables to service_role;
alter default privileges for role postgres in schema public
  grant all on sequences to service_role;
