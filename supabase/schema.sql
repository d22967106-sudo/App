-- 摳摳手帳：Supabase 資料表與權限（RLS）
-- 用法：Supabase 後台 → SQL Editor → New query → 整份貼上 → Run。
-- 可以重複執行（不會刪掉資料）。
-- 第 3 階段的自動化（步數表、自動化金鑰、auto_* 函式）在 automation.sql，要另外執行。
--
-- 每張表的格式都一樣：
--   user_id            誰的資料（預設就是登入的人）
--   id                 紀錄 id（每日總結用日期當 id）
--   updated_at         App 裡的最後修改時間（毫秒）
--   deleted            已刪除（保留一筆標記，讓其他裝置知道要刪）
--   data               整筆資料（JSON，欄位名稱跟 App 一樣）
--   server_updated_at  伺服器收到的時間，App 用它判斷「上次同步之後有哪些改過」

create or replace function public.ledger_before_write() returns trigger
language plpgsql as $$
begin
  -- 比較舊的修改不要蓋掉比較新的（例如匯入舊備份）
  if tg_op = 'UPDATE' and new.updated_at < old.updated_at then
    return old;
  end if;
  new.server_updated_at := clock_timestamp();
  return new;
end $$;

do $$
declare t text;
begin
  foreach t in array array['entries', 'summaries', 'track_points', 'places', 'photos'] loop
    execute format($f$
      create table if not exists public.%I (
        user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
        id text not null,
        updated_at bigint not null default 0,
        deleted boolean not null default false,
        data jsonb,
        server_updated_at timestamptz not null default clock_timestamp(),
        primary key (user_id, id)
      )$f$, t);
    execute format('alter table public.%I enable row level security', t);
    execute format('drop policy if exists "只能讀寫自己的資料" on public.%I', t);
    execute format($f$
      create policy "只能讀寫自己的資料" on public.%I for all to authenticated
        using ((select auth.uid()) = user_id)
        with check ((select auth.uid()) = user_id)$f$, t);
    execute format('revoke all on public.%I from anon', t);
    execute format('grant select, insert, update, delete on public.%I to authenticated', t);
    execute format('create index if not exists %I on public.%I (user_id, server_updated_at)', t || '_sync_idx', t);
    execute format('drop trigger if exists ledger_before_write on public.%I', t);
    execute format('create trigger ledger_before_write before insert or update on public.%I
                    for each row execute function public.ledger_before_write()', t);
  end loop;
end $$;

-- 方便之後的小工具、捷徑依日期查詢
alter table public.entries add column if not exists date text generated always as (data ->> 'date') stored;
alter table public.track_points add column if not exists date text generated always as (data ->> 'date') stored;
create index if not exists entries_date_idx on public.entries (user_id, date);
create index if not exists track_points_date_idx on public.track_points (user_id, date);
