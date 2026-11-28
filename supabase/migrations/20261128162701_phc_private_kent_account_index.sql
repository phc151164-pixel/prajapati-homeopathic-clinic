-- Doctor-owned historical index files. Published only after all parts are verified.
create table public.phc_kent_account_indexes (
  doctor_id uuid primary key references public.phc_admin_accounts(user_id) on delete cascade,
  digest text not null check (digest ~ '^[a-f0-9]{64}$'),
  byte_count integer not null check (byte_count between 1 and 16777216),
  part_count integer not null check (part_count = (byte_count + 786431) / 786432)
);

create table public.phc_kent_index_parts (
  doctor_id uuid not null references public.phc_admin_accounts(user_id) on delete cascade,
  digest text not null check (digest ~ '^[a-f0-9]{64}$'),
  part integer not null check (part between 0 and 21),
  content bytea not null check (octet_length(content) between 1 and 786432),
  primary key (doctor_id, digest, part)
);

alter table public.phc_kent_account_indexes enable row level security;
alter table public.phc_kent_index_parts enable row level security;
revoke all on public.phc_kent_account_indexes, public.phc_kent_index_parts
  from public, anon, authenticated, service_role;
grant select on public.phc_kent_account_indexes, public.phc_kent_index_parts to service_role;
