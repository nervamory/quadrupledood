-- Leaderboard ranking support.
-- Run once in the Supabase SQL editor (as the postgres role), after schema.sql.
-- Ranking: wins DESC, losses ASC, most recent win DESC.

alter table public.profiles
  add column if not exists last_win_at timestamptz;

-- Replaces record_match so wins also stamp last_win_at.
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
      last_win_at = case when outcome = 'win' then now() else last_win_at end,
      updated_at = now()
    where id = uid
    returning * into row;
  end if;

  return json_build_object(
    'display_name', row.display_name,
    'wins', row.wins,
    'losses', row.losses,
    'draws', row.draws,
    'last_win_at', row.last_win_at,
    'applied', applied
  );
end;
$$;

revoke all on function public.record_match(text) from public;
grant execute on function public.record_match(text) to authenticated;

-- Ranked board for the lobby. Only players who have finished at least one match.
create or replace function public.leaderboard(limit_count integer default 50)
returns table (
  id uuid,
  display_name text,
  wins integer,
  losses integer,
  draws integer,
  last_win_at timestamptz,
  rank bigint
)
language sql
stable
security definer
set search_path = public
as $$
  select
    p.id,
    p.display_name,
    p.wins,
    p.losses,
    p.draws,
    p.last_win_at,
    rank() over (
      order by
        p.wins desc,
        p.losses asc,
        p.last_win_at desc nulls last
    ) as rank
  from public.profiles p
  where p.wins + p.losses + p.draws > 0
  order by
    p.wins desc,
    p.losses asc,
    p.last_win_at desc nulls last
  limit greatest(1, least(coalesce(limit_count, 50), 200));
$$;

revoke all on function public.leaderboard(integer) from public;
grant execute on function public.leaderboard(integer) to anon, authenticated;

-- One player's current rank (null if they have no matches yet).
create or replace function public.player_rank(player_id uuid)
returns bigint
language sql
stable
security definer
set search_path = public
as $$
  select r.rank
  from (
    select
      p.id,
      rank() over (
        order by
          p.wins desc,
          p.losses asc,
          p.last_win_at desc nulls last
      ) as rank
    from public.profiles p
    where p.wins + p.losses + p.draws > 0
  ) r
  where r.id = player_id;
$$;

revoke all on function public.player_rank(uuid) from public;
grant execute on function public.player_rank(uuid) to anon, authenticated;
