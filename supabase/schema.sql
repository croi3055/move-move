create table if not exists public.videos (
  id uuid primary key default gen_random_uuid(),
  url text not null unique,
  title text not null,
  category text not null default '未分类',
  thumbnail text not null,
  source text not null,
  embed_url text not null,
  kind text not null default 'iframe',
  created_at timestamptz not null default now()
);

alter table public.videos enable row level security;

-- The app reads and writes through Vercel/local server API with the service role key.
-- No public anon policies are needed unless you later decide to call Supabase directly from the browser.
