-- One row per device that has alerts set. No accounts: the Expo push token is the key.
create table alerts (
  token text primary key,
  da_above numeric,
  da_below numeric,
  imb_above numeric,
  imb_below numeric,
  imb_state text check (imb_state in ('above', 'below')), -- last notified imbalance side, null = inside band
  da_notified_for date,                                    -- day-ahead delivery date already handled
  created_at timestamptz not null default now()
);

-- No policies: only the edge functions (service role) read or write this table.
alter table alerts enable row level security;

-- Every 5 minutes, call check-alerts. Before this runs, create the two Vault secrets once in the SQL Editor:
--   select vault.create_secret('https://<project-ref>.supabase.co', 'project_url');
--   select vault.create_secret('<same value as the CRON_SECRET function secret>', 'cron_secret');
create extension if not exists pg_cron;
create extension if not exists pg_net;

select cron.schedule('check-alerts', '*/5 * * * *', $$
  select net.http_post(
    url := (select decrypted_secret from vault.decrypted_secrets where name = 'project_url') || '/functions/v1/check-alerts',
    headers := jsonb_build_object('x-cron-secret', (select decrypted_secret from vault.decrypted_secrets where name = 'cron_secret'))
  )
$$);
