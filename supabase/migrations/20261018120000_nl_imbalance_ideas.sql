-- Live NL imbalance per quarter-hour, collected by check-alerts from TenneT Balance Delta.
-- up = highest upward regulation price, down = lowest downward price (null = none), mid = mid price.
create table imbalance_nl (
  t timestamptz primary key,
  up numeric,
  down numeric,
  mid numeric
);
alter table imbalance_nl enable row level security;

-- Ideas box submissions. Also emailed by the ideas function.
create table ideas (
  id bigint generated always as identity primary key,
  text text not null check (length(text) between 1 and 2000),
  created_at timestamptz not null default now()
);
alter table ideas enable row level security;
