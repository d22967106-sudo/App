import 'fake-indexeddb/auto'
import { openDB } from 'idb'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { getSession, saveConfig, saveSettings, signInWithPassword, signUpWithPassword } from './cloud'
import * as db from './db'
import { getDisplayBlob, getSyncStatus, syncNow } from './sync'
import type { Entry, Photo } from './types'

/** 假的 Supabase（auth + PostgREST）與照片伺服器，行為照 supabase/schema.sql 與 worker/photos.js */
class FakeCloud {
  rows = new Map<string, Record<string, unknown>>() // `${table}|${user}|${id}`
  blobs = new Map<string, Blob>() // `${user}/${id}/${size}`
  clock = 0
  accessTokens = new Map<string, string>() // token → user
  refreshTokens = new Map<string, string>()
  expiresIn = 3600
  calls: string[] = []
  seq = 0
  users = new Map<string, string>([['me@x.tw', 'secret123']])
  /** 模擬還沒執行 automation.sql */
  missing = new Set<string>()

  issue(user: string) {
    const a = `at${++this.seq}`
    const r = `rt${this.seq}`
    this.accessTokens.set(a, user)
    this.refreshTokens.set(r, user)
    return { access_token: a, refresh_token: r, expires_in: this.expiresIn, user: { id: user, email: `${user}@x.tw` } }
  }

  table(t: string) {
    return [...this.rows.entries()].filter(([k]) => k.startsWith(t + '|')).map(([, v]) => v)
  }

  fetch = async (input: string, init: RequestInit = {}): Promise<Response> => {
    const url = new URL(input)
    const method = init.method ?? 'GET'
    const headers = (init.headers ?? {}) as Record<string, string>
    const json = (b: unknown, status = 200) => new Response(JSON.stringify(b), { status })
    this.calls.push(`${method} ${url.host}${url.pathname}`)
    const user = this.accessTokens.get((headers.Authorization ?? '').replace('Bearer ', ''))

    if (url.host === 'proj.supabase.co' && url.pathname.startsWith('/auth/v1/')) {
      const body = init.body ? JSON.parse(String(init.body)) : {}
      const path = url.pathname.slice(9)
      if (path === 'signup') {
        if (this.users.has(body.email)) return json({ msg: 'User already registered' }, 422)
        this.users.set(body.email, body.password)
        return json(this.issue(body.email.split('@')[0]))
      }
      if (path === 'token' && url.searchParams.get('grant_type') === 'password') {
        if (this.users.get(body.email) !== body.password) return json({ error_description: 'Invalid login credentials' }, 400)
        return json(this.issue(body.email.split('@')[0]))
      }
      if (path === 'token') {
        const u = this.refreshTokens.get(body.refresh_token)
        if (!u) return json({ msg: 'Invalid Refresh Token' }, 400)
        this.refreshTokens.delete(body.refresh_token)
        return json(this.issue(u))
      }
      if (path === 'logout') return new Response(null, { status: 204 })
    }

    if (url.host === 'proj.supabase.co' && url.pathname.startsWith('/rest/v1/')) {
      if (!user) return json({ message: 'JWT expired' }, 401)
      const table = url.pathname.slice(9)
      if (this.missing.has(table)) return json({ message: `relation "public.${table}" does not exist` }, 404)
      if (method === 'POST') {
        for (const r of JSON.parse(String(init.body)) as Record<string, unknown>[]) {
          const key = `${table}|${r.user_id}|${r.id}`
          const old = this.rows.get(key)
          if (r.user_id !== user) return json({ message: 'RLS' }, 403)
          if (old && (r.updated_at as number) < (old.updated_at as number)) continue
          this.rows.set(key, { ...old, ...r, server_updated_at: `2026-01-01T00:00:00.${String(++this.clock).padStart(6, '0')}+00:00` })
        }
        return new Response(null, { status: 201 })
      }
      const gt = url.searchParams.get('server_updated_at')?.replace('gt.', '')
      const limit = Number(url.searchParams.get('limit'))
      const list = this.table(table)
        .filter((r) => r.user_id === user && (!gt || (r.server_updated_at as string) > gt))
        .sort((a, b) => ((a.server_updated_at as string) < (b.server_updated_at as string) ? -1 : 1))
        .slice(0, limit)
      return json(list)
    }

    if (url.host === 'photos.example.dev') {
      if (url.pathname === '/health') return new Response('ok')
      if (!user) return new Response('請先登入', { status: 401 })
      const [, , id, size] = url.pathname.split('/')
      if (method === 'DELETE') {
        this.blobs.delete(`${user}/${id}/thumb`)
        this.blobs.delete(`${user}/${id}/display`)
        return new Response('ok')
      }
      const key = `${user}/${id}/${size}`
      if (method === 'PUT') {
        this.blobs.set(key, init.body as Blob)
        return new Response('ok')
      }
      const b = this.blobs.get(key)
      return b ? new Response(b) : new Response('找不到', { status: 404 })
    }
    return new Response('unexpected', { status: 500 })
  }
}

let cloud: FakeCloud

async function freshDevice() {
  await db.resetDBForTests()
  await new Promise<void>((res) => {
    const r = indexedDB.deleteDatabase('ledger-diary')
    r.onsuccess = r.onerror = () => res()
  })
}

async function login(user = 'me') {
  await saveConfig({ url: 'https://proj.supabase.co', key: 'sb_publishable_0123456789abcdef', photoUrl: 'https://photos.example.dev' })
  await signInWithPassword(`${user}@x.tw`, 'secret123')
}

function entry(id: string, p: Partial<Entry> = {}): Entry {
  return {
    id, kind: 'expense', title: '拉麵', amount: 280, currency: 'TWD', rate: 1, amountTwd: 280, categoryId: 'food',
    note: '', time: 1_763_000_000_000, date: '2025-11-13', location: null, photoIds: [], placeId: null,
    createdAt: 1, updatedAt: 1, ...p,
  }
}

function photo(id: string, entryId: string): Photo {
  return {
    id, entryId, thumb: new Blob(['T'], { type: 'image/jpeg' }), display: new Blob(['DISPLAY'], { type: 'image/jpeg' }),
    width: 10, height: 10, takenAt: null, createdAt: 5,
  }
}

describe('雲端同步', () => {
  beforeEach(async () => {
    cloud = new FakeCloud()
    vi.stubGlobal('fetch', cloud.fetch)
    await freshDevice()
  })
  afterEach(() => vi.unstubAllGlobals())

  it('第 1 階段的舊資料升級後會排進待上傳佇列', async () => {
    await db.resetDBForTests()
    const v1 = await openDB('ledger-diary', 1, {
      upgrade(d) {
        d.createObjectStore('entries', { keyPath: 'id' }).createIndex('date', 'date')
        d.createObjectStore('summaries', { keyPath: 'date' })
        d.createObjectStore('track', { keyPath: 'id' }).createIndex('date', 'date')
        d.createObjectStore('photos', { keyPath: 'id' }).createIndex('entryId', 'entryId')
        d.createObjectStore('places', { keyPath: 'id' })
        d.createObjectStore('meta')
      },
    })
    await v1.put('entries', entry('old1'))
    await v1.put('summaries', { date: '2025-11-13', text: '好累', mood: 'tired', updatedAt: 1 })
    v1.close()
    const keys = (await db.getOutbox()).map((o) => o.key).sort()
    expect(keys).toEqual(['entries:old1', 'summaries:2025-11-13'])
  })

  it('登入／建立帳號失敗會顯示中文訊息', async () => {
    await saveConfig({ url: 'https://proj.supabase.co', key: 'sb_publishable_0123456789abcdef', photoUrl: '' })
    await expect(signInWithPassword('me@x.tw', 'wrong')).rejects.toThrow('電子郵件或密碼不對')
    expect(await getSession()).toBeNull()
    await expect(signUpWithPassword('me@x.tw', 'secret123')).rejects.toThrow('已經有帳號')
    await expect(signUpWithPassword('new@x.tw', 'short')).rejects.toThrow('至少要 8 個字')
    expect(await signUpWithPassword('new@x.tw', 'longenough')).toMatchObject({ userId: 'new' })
  })

  it('上傳紀錄與照片，大圖移到暫存；另一台裝置拉得下來', async () => {
    await login()
    await db.saveEntry(entry('e1', { photoIds: ['p1'] }), [photo('p1', 'e1')])
    await db.saveSummary({ date: '2025-11-13', text: '吃拉麵', mood: 'good', updatedAt: 2 })
    await syncNow()

    expect(getSyncStatus().lastError).toBeNull()
    expect(await db.countOutbox()).toBe(0)
    const [row] = cloud.table('entries')
    expect(row).toMatchObject({ id: 'e1', user_id: 'me', deleted: false, updated_at: 1 })
    expect((row.data as Entry).title).toBe('拉麵')
    const [prow] = cloud.table('photos')
    expect(prow.data).not.toHaveProperty('thumb')
    expect(cloud.blobs.has('me/p1/thumb') && cloud.blobs.has('me/p1/display')).toBe(true)
    const local = (await db.getPhoto('p1'))!
    expect(local.uploaded).toBe(true)
    expect(local.display).toBeNull()
    expect(local.thumb).not.toBeNull()
    expect(await db.cacheUsage()).toMatchObject({ count: 1 })

    // 第二台裝置
    await freshDevice()
    await login()
    await syncNow()
    expect((await db.getEntry('e1'))?.title).toBe('拉麵')
    expect((await db.getSummary('2025-11-13'))?.text).toBe('吃拉麵')
    const p = (await db.getPhoto('p1'))!
    expect(p.uploaded).toBe(true)
    expect(await p.thumb?.text()).toBe('T')
    expect(await db.countOutbox()).toBe(0) // 拉下來的不會再傳回去
    const big = await getDisplayBlob(p)
    expect(await big?.text()).toBe('DISPLAY')
    expect(await db.cacheUsage()).toMatchObject({ count: 1 })
  })

  it('刪除會同步到雲端與其他裝置，照片檔也會刪', async () => {
    await login()
    await db.saveEntry(entry('e1', { photoIds: ['p1'] }), [photo('p1', 'e1')])
    await syncNow()
    await db.deleteEntry('e1')
    await syncNow()
    expect(cloud.table('entries')[0]).toMatchObject({ deleted: true, data: null })
    expect(cloud.table('photos')[0]).toMatchObject({ deleted: true })
    expect(cloud.blobs.size).toBe(0)

    await freshDevice()
    await login()
    await syncNow()
    expect(await db.getEntry('e1')).toBeUndefined()
    expect(await db.getPhoto('p1')).toBeUndefined()
  })

  it('本地還沒上傳的修改不會被雲端蓋掉；比較新的雲端資料會套用', async () => {
    await login()
    await db.saveEntry(entry('e1', { title: '舊', updatedAt: 10 }))
    await syncNow()
    // 雲端被別台改成比較新的版本
    const key = 'entries|me|e1'
    cloud.rows.set(key, { ...cloud.rows.get(key), updated_at: 20, data: entry('e1', { title: '雲端新', updatedAt: 20 }), server_updated_at: '2026-01-01T00:00:01.000000+00:00' })
    // 同時本地也改了但還沒傳（outbox 裡有）
    vi.stubGlobal('fetch', async () => new Response('offline', { status: 503 }))
    await db.saveEntry(entry('e1', { title: '本地改', updatedAt: 30 }))
    vi.stubGlobal('fetch', cloud.fetch)
    await syncNow()
    expect((await db.getEntry('e1'))?.title).toBe('本地改')
    expect((cloud.rows.get(key)!.data as Entry).title).toBe('本地改')

    // 雲端再改得更新 → 本地沒有待上傳 → 套用
    cloud.rows.set(key, { ...cloud.rows.get(key), updated_at: 40, data: entry('e1', { title: '最新', updatedAt: 40 }), server_updated_at: '2026-01-01T00:00:02.000000+00:00' })
    await syncNow()
    expect((await db.getEntry('e1'))?.title).toBe('最新')
  })

  it('暫停照片上傳時照片留在手機，其他資料照傳', async () => {
    await login()
    await saveSettings({ pausePhotoUpload: true })
    await db.saveEntry(entry('e1', { photoIds: ['p1'] }), [photo('p1', 'e1')])
    await syncNow()
    expect(cloud.table('entries')).toHaveLength(1)
    expect(cloud.table('photos')).toHaveLength(0)
    expect(getSyncStatus()).toMatchObject({ pending: 1, photosPaused: 1 })
    expect((await db.getPhoto('p1'))?.display).not.toBeNull()

    await saveSettings({ pausePhotoUpload: false })
    await syncNow()
    expect(cloud.table('photos')).toHaveLength(1)
    expect(getSyncStatus().pending).toBe(0)
  })

  it('token 過期會自動換新；換不了就要求重新登入', async () => {
    cloud.expiresIn = 0
    await login()
    await db.saveEntry(entry('e1'))
    await syncNow()
    expect(cloud.calls).toContain('POST proj.supabase.co/auth/v1/token')
    expect(cloud.table('entries')).toHaveLength(1)

    cloud.refreshTokens.clear()
    await db.saveEntry(entry('e2'))
    await syncNow()
    expect(getSyncStatus().needLogin).toBe(true)
    expect(await getSession()).toBeNull()
    expect(await db.countOutbox()).toBe(1)
  })

  it('大圖暫存超過上限時刪最久沒看的', async () => {
    await db.cachePut('a', new Blob(['x'.repeat(600)]), 10_000)
    await new Promise((r) => setTimeout(r, 5))
    await db.cachePut('b', new Blob(['x'.repeat(600)]), 10_000)
    await new Promise((r) => setTimeout(r, 5))
    await db.cacheGet('a') // a 剛看過
    await new Promise((r) => setTimeout(r, 5))
    await db.cachePut('c', new Blob(['x'.repeat(600)]), 1300)
    expect(await db.cacheGet('b')).toBeUndefined()
    expect(await db.cacheGet('a')).toBeDefined()
    expect(await db.cacheGet('c')).toBeDefined()
  })

  it('背景定位、捷徑、步數從雲端同步下來；日期用手機的時區重新算', async () => {
    await login()
    const t = new Date(2026, 10, 18, 0, 30).getTime() // 手機時區的 11/18 00:30
    const put = (table: string, id: string, data: Record<string, unknown>) =>
      cloud.rows.set(`${table}|me|${id}`, { user_id: 'me', id, updated_at: 1, deleted: false, data, server_updated_at: `2026-01-01T00:00:01.${String(++cloud.clock).padStart(6, '0')}+00:00` })
    put('track_points', `auto-${t}`, { id: `auto-${t}`, time: t, date: '1999-01-01', lat: 23.4, lng: 120.4, source: 'auto' })
    put('entries', 'sc-1', { ...entry('sc-1', { time: t, date: '1999-01-01' }), source: 'shortcut' })
    put('entries', 'e-own', { ...entry('e-own', { time: t, date: '2026-11-17' }) })
    put('daily_steps', '2026-11-18', { date: '2026-11-18', steps: 8231, updatedAt: 1 })
    await syncNow()
    expect(getSyncStatus().lastError).toBeNull()
    expect((await db.getTrackByDate('2026-11-18')).map((p) => p.id)).toEqual([`auto-${t}`])
    expect((await db.getEntriesByDate('2026-11-18')).map((e) => e.id)).toEqual(['sc-1'])
    expect((await db.getEntry('e-own'))?.date).toBe('2026-11-17') // App 自己記的不動
    expect(await db.getSteps('2026-11-18')).toMatchObject({ steps: 8231 })
  })

  it('雲端還沒建立步數表時，其他資料照常同步', async () => {
    cloud.missing.add('daily_steps')
    await login()
    await db.saveEntry(entry('e1'))
    await syncNow()
    expect(getSyncStatus().lastError).toBeNull()
    expect(cloud.table('entries')).toHaveLength(1)
  })
})
