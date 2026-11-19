-- 摳摳手帳 第 4 階段：旅程資料表＋使用狀況
-- 用法：App「統計」→ 右上齒輪 →「使用狀況」→ 按「複製設定 SQL」→
--       Supabase 後台 → SQL Editor → New query → 貼上 → Run，看到 Success 就好。
-- 可以重複執行（不會刪掉資料）。要先執行過 schema.sql（第 2 階段）。

-- 旅程（格式跟其他表一樣）
create table if not exists public.trips (
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  id text not null,
  updated_at bigint not null default 0,
  deleted boolean not null default false,
  data jsonb,
  server_updated_at timestamptz not null default clock_timestamp(),
  primary key (user_id, id)
);
alter table public.trips enable row level security;
drop policy if exists "只能讀寫自己的資料" on public.trips;
create policy "只能讀寫自己的資料" on public.trips for all to authenticated
  using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
revoke all on public.trips from anon;
grant select, insert, update, delete on public.trips to authenticated;
create index if not exists trips_sync_idx on public.trips (user_id, server_updated_at);
drop trigger if exists ledger_before_write on public.trips;
create trigger ledger_before_write before insert or update on public.trips
  for each row execute function public.ledger_before_write();

-- 使用狀況：資料庫總大小（免費方案上限 500 MB 算的是這個）＋每張表的大小與自己的筆數
create or replace function public.usage_stats() returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  uid uuid := auth.uid();
  t text;
  n bigint;
  tables jsonb := '{}'::jsonb;
begin
  if uid is null then
    raise exception '請先登入';
  end if;
  foreach t in array array['entries', 'summaries', 'track_points', 'places', 'photos', 'daily_steps', 'trips'] loop
    if to_regclass('public.' || t) is null then
      continue;
    end if;
    execute format('select count(*) from public.%I where user_id = $1 and not deleted', t) into n using uid;
    tables := tables || jsonb_build_object(t, jsonb_build_object(
      'rows', n,
      'bytes', pg_total_relation_size(format('public.%I', t)::regclass)
    ));
  end loop;
  return jsonb_build_object('db_bytes', pg_database_size(current_database()), 'tables', tables);
end $$;
revoke all on function public.usage_stats() from public, anon;
grant execute on function public.usage_stats() to authenticated;
