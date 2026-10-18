-- check-alerts takes longer than pg_net's default 5 s timeout (it calls TenneT, ENTSO-E, Elia and Expo).
-- Same job name, so this replaces the schedule.
select cron.schedule('check-alerts', '*/5 * * * *', $$
  select net.http_post(
    url := (select decrypted_secret from vault.decrypted_secrets where name = 'project_url') || '/functions/v1/check-alerts',
    headers := jsonb_build_object('x-cron-secret', (select decrypted_secret from vault.decrypted_secrets where name = 'cron_secret')),
    timeout_milliseconds := 30000
  )
$$);
