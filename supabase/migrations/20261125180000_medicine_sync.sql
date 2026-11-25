create table public.phc_medicine_library (
  doctor_id uuid primary key,
  medicines jsonb not null check (jsonb_typeof(medicines) = 'array' and jsonb_array_length(medicines) between 1 and 1500)
);
alter table public.phc_medicine_library enable row level security;
revoke all on public.phc_medicine_library from public, anon, authenticated;
grant select, insert, update on public.phc_medicine_library to service_role;
