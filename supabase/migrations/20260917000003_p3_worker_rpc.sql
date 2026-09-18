-- P3b · Worker queue RPC (PostgREST-callable, service_role only)
--
-- The Railway worker has no pg driver — it claims/completes jobs over HTTPS
-- via these RPCs using the service_role key. SKIP LOCKED lives here so
-- multiple worker replicas never double-claim. No RLS policies on job_queue
-- means these SECURITY DEFINER functions are the only access path.

-- Claim the oldest due queued job and mark it running. Returns null when empty.
create or replace function claim_job(worker_id text)
returns job_queue
language plpgsql security definer set search_path = public as $$
declare
  rec job_queue%rowtype;
begin
  select * into rec from job_queue
  where status = 'queued' and run_at <= now()
  order by run_at, id
  for update skip locked
  limit 1;
  if rec.id is null then
    return null;
  end if;
  update job_queue
  set status = 'running', locked_at = now(), locked_by = worker_id,
      attempts = rec.attempts + 1, updated_at = now()
  where id = rec.id;
  rec.status := 'running';
  rec.attempts := rec.attempts + 1;
  rec.locked_at := now();
  rec.locked_by := worker_id;
  return rec;
end $$;

-- Finish a job: ok=true → done; attempts exhausted → dead; else requeue with
-- exponential backoff (2^attempts minutes, capped at 2^6).
create or replace function complete_job(job_id bigint, ok boolean, err text default null)
returns void
language plpgsql security definer set search_path = public as $$
declare
  a integer;
  m integer;
begin
  select attempts, max_attempts into a, m from job_queue where id = job_id;
  if not found then
    return;
  end if;
  if ok then
    update job_queue
    set status = 'done', last_error = null,
        locked_at = null, locked_by = null, updated_at = now()
    where id = job_id;
  elsif a >= m then
    update job_queue
    set status = 'dead', last_error = err,
        locked_at = null, locked_by = null, updated_at = now()
    where id = job_id;
  else
    update job_queue
    set status = 'queued', last_error = err,
        locked_at = null, locked_by = null,
        run_at = now() + (power(2, least(a, 6))::text || ' minutes')::interval,
        updated_at = now()
    where id = job_id;
  end if;
end $$;
