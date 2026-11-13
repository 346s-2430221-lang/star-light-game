create table if not exists public.device_saves (
  device_id uuid primary key,
  payload jsonb not null,
  updated_at timestamptz not null default now()
);
alter table public.device_saves enable row level security;
-- The save service uses the Supabase service-role key on the server only.
-- Do not expose the service-role key in the game page or share it in chat.
