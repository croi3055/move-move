create table if not exists public.videos (
  id uuid primary key default gen_random_uuid(),
  library_key text not null default 'default',
  url text not null,
  title text not null,
  category text not null default '未分类',
  thumbnail text not null,
  source text not null,
  embed_url text not null,
  kind text not null default 'iframe',
  created_at timestamptz not null default now(),
  constraint videos_library_url_key unique (library_key, url)
);

alter table public.videos
  add column if not exists library_key text not null default 'default';

alter table public.videos
  alter column library_key set default 'default';

do $$
begin
  if exists (
    select 1
    from pg_constraint
    where conname = 'videos_url_key'
      and conrelid = 'public.videos'::regclass
  ) then
    alter table public.videos drop constraint videos_url_key;
  end if;
end $$;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'videos_library_url_key'
      and conrelid = 'public.videos'::regclass
  ) then
    alter table public.videos add constraint videos_library_url_key unique (library_key, url);
  end if;
end $$;

create index if not exists videos_library_created_at_idx
  on public.videos (library_key, created_at desc);

alter table public.videos enable row level security;

-- The app reads and writes through Vercel/local server API with the service role key.
-- No public anon policies are needed unless you later decide to call Supabase directly from the browser.
