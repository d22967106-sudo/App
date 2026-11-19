import { afterEach, describe, expect, it, vi } from 'vitest'
import worker, { photoUsage } from './photos.js'

function fakeBucket(objects) {
  return {
    list: async ({ prefix, cursor, limit }) => {
      const mine = objects.filter((o) => o.key.startsWith(prefix))
      const from = cursor ? Number(cursor) : 0
      const page = mine.slice(from, from + limit)
      const truncated = from + limit < mine.length
      return { objects: page, truncated, cursor: truncated ? String(from + limit) : undefined }
    },
  }
}

describe('照片使用狀況', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('只算自己的照片，會翻頁', async () => {
    const objects = [
      ...Array.from({ length: 2500 }, (_, i) => ({ key: `u1/p${i}/thumb`, size: 10 })),
      { key: 'u2/x/thumb', size: 999 },
    ]
    const r = await photoUsage({ PHOTOS: fakeBucket(objects) }, 'u1')
    expect(r).toEqual({ bytes: 25000, objects: 2500, complete: true })
  })

  it('GET /usage 要登入', async () => {
    vi.stubGlobal('fetch', async () => new Response(JSON.stringify({ id: 'u1' })))
    const env = { PHOTOS: fakeBucket([{ key: 'u1/a/thumb', size: 7 }]), SUPABASE_URL: 'https://x.supabase.co', SUPABASE_KEY: 'k' }
    const noAuth = await worker.fetch(new Request('https://w/usage'), env)
    expect(noAuth.status).toBe(401)
    const ok = await worker.fetch(new Request('https://w/usage', { headers: { Authorization: 'Bearer tok-usage' } }), env)
    expect(ok.status).toBe(200)
    expect(await ok.json()).toEqual({ bytes: 7, objects: 1, complete: true })
  })
})
