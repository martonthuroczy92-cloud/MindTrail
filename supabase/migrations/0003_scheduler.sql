-- MindTrail, phase 2: background scheduler.
-- Every 5 minutes Supabase calls /api/cron, which continues unfinished processing jobs.
-- Before running: replace the two placeholders below. The secret must be the same value as the
-- CRON_SECRET environment variable in Vercel (at least 32 characters). Safe to re-run.

create extension if not exists pg_cron;
create extension if not exists pg_net;

-- Store the secret in Supabase Vault (encrypted at rest) instead of in the job definition.
do $$
declare existing uuid;
begin
  select id into existing from vault.secrets where name = 'mindtrail_cron_secret';
  if existing is null then
    perform vault.create_secret('<<CRON_SECRET>>', 'mindtrail_cron_secret');
  else
    perform vault.update_secret(existing, '<<CRON_SECRET>>');
  end if;
end $$;

select cron.schedule(
  'mindtrail-tick',
  '*/5 * * * *',
  $job$
    select net.http_post(
      url := '<<APP_URL>>/api/cron',
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'Authorization', 'Bearer ' || (select decrypted_secret from vault.decrypted_secrets
                                       where name = 'mindtrail_cron_secret')
      ),
      body := '{}'::jsonb
    );
  $job$
);

-- To check it runs:   select * from cron.job_run_details order by start_time desc limit 5;
-- To stop it:         select cron.unschedule('mindtrail-tick');
