-- Alerts per bidding zone: a device can have separate thresholds for BE and NL.
alter table alerts add column zone text not null default 'BE' check (zone in ('BE', 'NL'));
alter table alerts drop constraint alerts_pkey;
alter table alerts add primary key (token, zone);
