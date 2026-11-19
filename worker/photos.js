/**
 * 記帳日記：照片伺服器（Cloudflare Worker + R2）
 *
 * 用法見 docs/setup-cloud.md。需要設定：
 *   R2 bucket 綁定      PHOTOS
 *   變數 SUPABASE_URL   https://xxxx.supabase.co
 *   變數 SUPABASE_KEY   Supabase 的 anon / publishable key（公開的那把）
 *
 * Worker 直接用 R2 綁定讀寫，不需要 R2 金鑰，也不會有金鑰出現在 App 裡。
 * 每個請求都要帶 Supabase 登入 token，Worker 向 Supabase 確認是誰，
 * 照片存在 <使用者 id>/<照片 id>/<thumb|display>，只能讀寫自己的。
 *
 *   PUT    /photos/<id>/thumb|display   上傳
 *   GET    /photos/<id>/thumb|display   下載
 *   DELETE /photos/<id>                 刪除兩種尺寸
 *   GET    /usage                       使用狀況：自己的照片佔多少空間（第 4 階段）
 *   GET    /health                      測試連線（不用登入）
 *   /auto/…                             自動化接收端（背景定位、捷徑、小工具），見 auto.js
 */

import { CORS, handleAuto } from './auto.js'

const MAX_BYTES = 8 * 1024 * 1024

const reply = (body, status = 200, headers = {}) =>
  new Response(body, { status, headers: { ...CORS, 'Content-Type': 'text/plain; charset=utf-8', ...headers } })

// 同一個 token 幾分鐘內不用重複問 Supabase
const tokenCache = new Map()

async function userIdFrom(request, env) {
  const auth = request.headers.get('Authorization') || ''
  const token = auth.startsWith('Bearer ') ? auth.slice(7) : ''
  if (!token) return null
  const hit = tokenCache.get(token)
  if (hit && hit.until > Date.now()) return hit.id
  const res = await fetch(`${env.SUPABASE_URL}/auth/v1/user`, {
    headers: { apikey: env.SUPABASE_KEY, Authorization: `Bearer ${token}` },
  })
  if (!res.ok) return null
  const user = await res.json()
  if (!user?.id) return null
  if (tokenCache.size > 100) tokenCache.clear()
  tokenCache.set(token, { id: user.id, until: Date.now() + 5 * 60 * 1000 })
  return user.id
}

/** 算出這個人的照片總共佔多少空間（R2 一次最多列 1000 個，最多翻 100 頁） */
export async function photoUsage(env, userId) {
  let bytes = 0
  let objects = 0
  let cursor
  let complete = true
  for (let page = 0; ; page++) {
    if (page >= 100) {
      complete = false
      break
    }
    const list = await env.PHOTOS.list({ prefix: `${userId}/`, cursor, limit: 1000 })
    for (const o of list.objects) {
      bytes += o.size
      objects++
    }
    if (!list.truncated) break
    cursor = list.cursor
  }
  return { bytes, objects, complete }
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url)
    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS })
    if (url.pathname === '/health') {
      const missing = []
      if (!env.PHOTOS) missing.push('PHOTOS（R2 綁定）')
      if (!env.SUPABASE_URL) missing.push('SUPABASE_URL（變數）')
      if (!env.SUPABASE_KEY) missing.push('SUPABASE_KEY（變數）')
      if (env.SUPABASE_URL && !/^https:\/\/[^/]+$/.test(env.SUPABASE_URL.trim())) missing.push('SUPABASE_URL 格式不對（要像 https://xxxx.supabase.co，結尾不要 /）')
      const have = Object.keys(env).join(', ') || '（沒有）'
      return missing.length
        ? reply(`設定不完整，缺少：${missing.join('、')}\n目前這個 Worker 看得到的名稱：${have}`, 500)
        : reply('ok')
    }
    if (url.pathname === '/auto' || url.pathname.startsWith('/auto/')) return handleAuto(request, env, url)

    if (url.pathname === '/usage') {
      if (request.method !== 'GET') return reply('不支援', 405)
      const userId = await userIdFrom(request, env)
      if (!userId) return reply('請先登入', 401)
      return Response.json(await photoUsage(env, userId), { headers: CORS })
    }

    const m = /^\/photos\/([A-Za-z0-9-]{1,64})(?:\/(thumb|display))?$/.exec(url.pathname)
    if (!m) return reply('找不到', 404)
    const [, id, size] = m

    const userId = await userIdFrom(request, env)
    if (!userId) return reply('請先登入', 401)
    const base = `${userId}/${id}/`

    if (request.method === 'DELETE' && !size) {
      await env.PHOTOS.delete([base + 'thumb', base + 'display'])
      return reply('ok')
    }
    if (!size) return reply('找不到', 404)
    const key = base + size

    if (request.method === 'PUT') {
      const type = request.headers.get('Content-Type') || ''
      if (!/^image\/(webp|jpeg|png)$/.test(type)) return reply('只接受 webp／jpeg／png', 415)
      const body = await request.arrayBuffer()
      if (body.byteLength === 0 || body.byteLength > MAX_BYTES) return reply('檔案大小不對', 413)
      await env.PHOTOS.put(key, body, { httpMetadata: { contentType: type } })
      return reply('ok')
    }

    if (request.method === 'GET') {
      const obj = await env.PHOTOS.get(key)
      if (!obj) return reply('找不到', 404)
      return new Response(obj.body, {
        headers: {
          ...CORS,
          'Content-Type': obj.httpMetadata?.contentType || 'image/jpeg',
          'Cache-Control': 'private, max-age=31536000, immutable',
          ETag: obj.httpEtag,
        },
      })
    }

    return reply('不支援', 405)
  },
}
