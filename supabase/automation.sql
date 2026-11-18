-- 記帳日記 第 3 階段：自動化（背景定位、捷徑、Scriptable 小工具）
-- 用法：App「設定 → 自動化」按「複製設定 SQL」→ Supabase 後台 → SQL Editor → New query → 貼上 → Run。
-- 要先執行過 schema.sql。可以重複執行（不會刪掉資料）。
--
-- 背景定位 App、捷徑、小工具沒辦法用帳號密碼登入，所以改用一把「自動化金鑰」：
--   App 產生金鑰，只把它的雜湊（sha256）存在 api_keys，金鑰本身只在手機上。
--   照片伺服器（Worker）收到資料後，帶著金鑰呼叫下面的 auto_* 函式；
--   函式確認金鑰是誰的，才寫入或讀出「那個人」的資料，而且只能碰固定幾張表。

-- 每日步數（格式跟其他表一樣，id＝日期）
create table if not exists public.daily_steps (
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  id text not null,
  updated_at bigint not null default 0,
  deleted boolean not null default false,
  data jsonb,
  server_updated_at timestamptz not null default clock_timestamp(),
  primary key (user_id, id)
);
alter table public.daily_steps enable row level security;
drop policy if exists "只能讀寫自己的資料" on public.daily_steps;
create policy "只能讀寫自己的資料" on public.daily_steps for all to authenticated
  using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
revoke all on public.daily_steps from anon;
grant select, insert, update, delete on public.daily_steps to authenticated;
create index if not exists daily_steps_sync_idx on public.daily_steps (user_id, server_updated_at);
drop trigger if exists ledger_before_write on public.daily_steps;
create trigger ledger_before_write before insert or update on public.daily_steps
  for each row execute function public.ledger_before_write();

-- 自動化金鑰（每人一把；tz 是手機目前的時區，用來算「今天」是哪一天）
create table if not exists public.api_keys (
  user_id uuid primary key default auth.uid() references auth.users (id) on delete cascade,
  key_hash text not null unique,
  tz text not null default 'Asia/Taipei',
  created_at timestamptz not null default now()
);
alter table public.api_keys enable row level security;
drop policy if exists "只能讀寫自己的金鑰" on public.api_keys;
create policy "只能讀寫自己的金鑰" on public.api_keys for all to authenticated
  using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
revoke all on public.api_keys from anon;
grant select, insert, update, delete on public.api_keys to authenticated;

-- 金鑰 → 使用者（內部用，不對外開放）
create or replace function public.auto_user(p_key text) returns uuid
language sql stable security definer set search_path = '' as $$
  select user_id from public.api_keys
  where key_hash = encode(pg_catalog.sha256(convert_to(coalesce(p_key, ''), 'UTF8')), 'hex')
$$;

-- 金鑰的使用者 id 與時區（Worker 用來找照片、算日期）
create or replace function public.auto_key_info(p_key text) returns jsonb
language sql stable security definer set search_path = '' as $$
  select jsonb_build_object('user_id', user_id, 'tz', tz) from public.api_keys
  where key_hash = encode(pg_catalog.sha256(convert_to(coalesce(p_key, ''), 'UTF8')), 'hex')
$$;

-- 寫入：p_rows = [{id, updated_at, data}, …]
--   track_points、entries：同一個 id 已經有就不動（背景定位重送不會重複）
--   daily_steps：步數比原本多才更新（螢幕鎖定時讀不到健康資料，送 0 不會蓋掉）
create or replace function public.auto_write(p_key text, p_table text, p_rows jsonb) returns integer
language plpgsql security definer set search_path = '' as $$
declare
  uid uuid := public.auto_user(p_key);
  n integer;
  on_conflict text;
begin
  if uid is null then raise exception '自動化金鑰不對或已重新產生' using errcode = '28000'; end if;
  if p_table = 'daily_steps' then
    on_conflict := 'update set updated_at = excluded.updated_at, deleted = false, data = excluded.data
      where public.daily_steps.deleted
         or coalesce((excluded.data ->> ''steps'')::numeric, 0) >= coalesce((public.daily_steps.data ->> ''steps'')::numeric, 0)';
  elsif p_table in ('track_points', 'entries') then
    on_conflict := 'nothing';
  else
    raise exception '不支援的資料表 %', p_table;
  end if;
  execute format(
    'insert into public.%I (user_id, id, updated_at, deleted, data)
     select $1, r ->> ''id'', (r ->> ''updated_at'')::bigint, false, r -> ''data''
     from jsonb_array_elements($2) r
     where r ->> ''id'' is not null and r -> ''data'' is not null
     on conflict (user_id, id) do ' || on_conflict, p_table)
  using uid, p_rows;
  get diagnostics n = row_count;
  return n;
end $$;

-- 讀取（小工具用）：entries、track_points 依日期；summaries、daily_steps 依 id（＝日期）
create or replace function public.auto_read(p_key text, p_table text, p_from text, p_to text) returns setof jsonb
language plpgsql stable security definer set search_path = '' as $$
declare uid uuid := public.auto_user(p_key);
begin
  if uid is null then raise exception '自動化金鑰不對或已重新產生' using errcode = '28000'; end if;
  if p_table in ('entries', 'track_points') then
    return query execute format(
      'select data from public.%I where user_id = $1 and not deleted and date between $2 and $3', p_table)
      using uid, p_from, p_to;
  elsif p_table in ('summaries', 'daily_steps') then
    return query execute format(
      'select data from public.%I where user_id = $1 and not deleted and id between $2 and $3', p_table)
      using uid, p_from, p_to;
  else
    raise exception '不支援的資料表 %', p_table;
  end if;
end $$;

revoke execute on function public.auto_user(text) from public, anon, authenticated;
revoke execute on function public.auto_key_info(text) from public;
revoke execute on function public.auto_write(text, text, jsonb) from public;
revoke execute on function public.auto_read(text, text, text, text) from public;
grant execute on function public.auto_key_info(text) to anon, authenticated;
grant execute on function public.auto_write(text, text, jsonb) to anon, authenticated;
grant execute on function public.auto_read(text, text, text, text) to anon, authenticated;

-- 讓 API 馬上看到新的表和函式
notify pgrst, 'reload schema';
