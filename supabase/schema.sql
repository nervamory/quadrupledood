-- Quadruple Dood accounts.
-- Run once in the Supabase SQL editor (as the postgres role).
--
-- Authentication → URL configuration:
--   Site URL: https://rupledood.vercel.app
--   Redirect URLs:
--     https://rupledood.vercel.app/**
--     http://localhost:5173/**
--
-- Then set VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY
-- on the Vercel project, and in .env.local for `npm run dev`.

create table if not exists public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  display_name text not null default 'player',
  wins integer not null default 0,
  losses integer not null default 0,
  draws integer not null default 0,
  last_match_at timestamptz,
  updated_at timestamptz not null default now(),
  constraint display_name_len check (char_length(display_name) between 1 and 24),
  constraint profile_counts_nonnegative check (wins >= 0 and losses >= 0 and draws >= 0)
);

alter table public.profiles enable row level security;

drop policy if exists "profiles are readable" on public.profiles;
create policy "profiles are readable"
  on public.profiles
  for select
  to anon, authenticated
  using (true);

drop policy if exists "players update their own name" on public.profiles;
create policy "players update their own name"
  on public.profiles
  for update
  to authenticated
  using (id = auth.uid())
  with check (id = auth.uid());

revoke all on table public.profiles from anon, authenticated;
grant select on table public.profiles to anon, authenticated;
grant update (display_name) on table public.profiles to authenticated;

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  name text;
begin
  name := left(coalesce(nullif(split_part(coalesce(new.email, ''), '@', 1), ''), 'player'), 24);
  insert into public.profiles (id, display_name)
  values (new.id, name)
  on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- Increments only the caller's row. A second call within 20 seconds
-- returns the current record without counting again.
create or replace function public.record_match(outcome text)
returns json
language plpgsql
security definer
set search_path = public
as $$
declare
  uid uuid := auth.uid();
  row public.profiles;
  applied boolean := true;
begin
  if uid is null then
    raise exception 'not authenticated';
  end if;
  if outcome not in ('win', 'loss', 'draw') then
    raise exception 'bad result';
  end if;

  select * into row from public.profiles where id = uid;
  if not found then
    raise exception 'profile missing';
  end if;

  if row.last_match_at is not null and row.last_match_at > now() - interval '20 seconds' then
    applied := false;
  else
    update public.profiles
    set
      wins = wins + case when outcome = 'win' then 1 else 0 end,
      losses = losses + case when outcome = 'loss' then 1 else 0 end,
      draws = draws + case when outcome = 'draw' then 1 else 0 end,
      last_match_at = now(),
      updated_at = now()
    where id = uid
    returning * into row;
  end if;

  return json_build_object(
    'display_name', row.display_name,
    'wins', row.wins,
    'losses', row.losses,
    'draws', row.draws,
    'applied', applied
  );
end;
$$;

revoke all on function public.record_match(text) from public;
grant execute on function public.record_match(text) to authenticated;
