import { useEffect, useState } from 'react'
import { Icon } from '../components/Icon'
import { toast } from '../components/ui'
import {
  appUrl,
  automationSql,
  buildLinks,
  buildScriptable,
  checkAuto,
  createAutoKey,
  getAutoKey,
  SCRIPT_VERSION,
  type AutoKey,
} from '../lib/automation'
import { getConfig, getSession, onCloudChange, type CloudConfig, type CloudSession } from '../lib/cloud'
import { getMeta, setMeta } from '../lib/db'
import { formatDateTimeShort } from '../lib/ledger'

const GUIDE_URL = 'https://github.com/d22967106-sudo/App/blob/claude/confident-babbage-8nlxkb/docs/setup-automation.md'

async function copy(text: string, what: string) {
  try {
    await navigator.clipboard.writeText(text)
    toast(`已複製${what}`)
  } catch {
    // 少數情況剪貼簿不能用：改成跳出視窗讓使用者自己全選複製
    prompt(`請長按全選後複製${what}`, text)
  }
}

function CopyButton({ text, label, what }: { text: string; label: string; what?: string }) {
  return (
    <button className="btn-outline" onClick={() => copy(text, what ?? label.replace(/^複製/, ''))}>
      <Icon name="copy" size={18} />
      {label}
    </button>
  )
}

/** 「統計與設定」裡的自動化區塊 */
export function AutomationSection() {
  const [st, setSt] = useState<{ cfg: CloudConfig | null; session: CloudSession | null; key: AutoKey | null; budget: number }>()
  const load = async () =>
    setSt({ cfg: await getConfig(), session: await getSession(), key: await getAutoKey(), budget: (await getMeta<number>('auto.budget')) ?? 0 })
  useEffect(() => {
    load()
    return onCloudChange(load)
  }, [])
  const [busy, setBusy] = useState<'key' | 'check' | null>(null)
  const [result, setResult] = useState<{ ok: boolean; text: string } | null>(null)
  if (!st) return null
  const { cfg, session, key } = st

  const makeKey = async () => {
    if (key && !confirm('重新產生金鑰後，舊的金鑰立刻失效：Overland、捷徑、小工具都要換成新的。確定嗎？')) return
    setBusy('key')
    setResult(null)
    try {
      await createAutoKey()
      await load()
      toast('已產生自動化金鑰')
    } catch (e) {
      setResult({ ok: false, text: (e as Error).message })
    } finally {
      setBusy(null)
    }
  }

  const test = async () => {
    if (!cfg?.photoUrl || !key) return
    setBusy('check')
    setResult(null)
    try {
      setResult({ ok: true, text: `連線正常：${await checkAuto(cfg.photoUrl, key.key)}` })
    } catch (e) {
      setResult({ ok: false, text: (e as Error).message })
    } finally {
      setBusy(null)
    }
  }

  const links = cfg?.photoUrl && key ? buildLinks(cfg.photoUrl, key.key) : null

  return (
    <section className="card stack" aria-label="自動化">
      <h2 className="section-title" style={{ margin: 0, display: 'flex', alignItems: 'center', gap: 6 }}>
        <Icon name="bolt" size={18} />
        自動化
      </h2>
      <p className="muted" style={{ fontSize: 14, margin: 0 }}>
        背景定位自動記軌跡、用捷徑快速記一筆和記步數、主畫面小工具。照{' '}
        <a href={GUIDE_URL} target="_blank" rel="noreferrer">
          自動化教學
        </a>{' '}
        一步一步做。
      </p>

      {!cfg || !session ? (
        <p className="hint" style={{ margin: 0 }}>
          要先在上面的「雲端同步」登入，才能設定自動化。
        </p>
      ) : !cfg.photoUrl ? (
        <p className="hint" style={{ margin: 0 }}>
          要先在「雲端同步 → 修改雲端設定」填照片伺服器網址（自動化的資料也是由它接收）。
        </p>
      ) : (
        <>
          <h3 className="auto-step">① Supabase 設定（只要做一次）</h3>
          <p className="muted" style={{ fontSize: 13, margin: 0 }}>
            按下面的按鈕複製，到 Supabase 後台 → SQL Editor → New query，貼上後按 Run，看到 Success 就好。
          </p>
          <CopyButton text={automationSql} label="複製設定 SQL" what="設定 SQL" />

          <h3 className="auto-step">② 自動化金鑰</h3>
          {key ? (
            <>
              <div className="kv">
                <span>金鑰</span>
                <span>
                  {key.key.slice(0, 7)}…（{formatDateTimeShort(key.createdAt)} 建立）
                </span>
              </div>
              <button className="btn-outline" onClick={test} disabled={busy != null}>
                {busy === 'check' ? <span className="spinner" /> : <Icon name="check" size={18} />}
                測試連線
              </button>
            </>
          ) : (
            <p className="muted" style={{ fontSize: 13, margin: 0 }}>
              背景定位 App、捷徑、小工具都用這把金鑰把資料送進來（等同密碼，不要給別人）。
            </p>
          )}
          {result && (
            <p className={result.ok ? 'hint' : 'error-text'} role={result.ok ? 'status' : 'alert'} style={{ margin: 0 }}>
              {result.text}
            </p>
          )}
          <button className={key ? 'btn-text' : 'btn-primary'} onClick={makeKey} disabled={busy != null}>
            {busy === 'key' ? <span className="spinner" /> : null}
            {key ? '重新產生金鑰' : '產生自動化金鑰'}
          </button>

          {links && key && (
            <>
              <details className="auto-box">
                <summary>③ 背景定位（Overland）</summary>
                <div className="stack">
                  <p className="muted" style={{ fontSize: 13, margin: 0 }}>
                    先到 App Store 安裝「Overland GPS Tracker」並打開一次，再回來按下面的按鈕，會自動填好接收網址和金鑰。
                  </p>
                  <a className="btn-primary" href={links.overlandSetup}>
                    一鍵設定 Overland
                  </a>
                  <p className="muted" style={{ fontSize: 12, margin: 0 }}>
                    改用 OwnTracks 的話：模式選 HTTP，網址貼上這個（已含金鑰）。
                  </p>
                  <CopyButton text={links.owntracks} label="複製 OwnTracks 網址" />
                </div>
              </details>

              <details className="auto-box">
                <summary>④ 捷徑（快速記一筆、每晚步數、記下位置）</summary>
                <div className="stack">
                  <p className="muted" style={{ fontSize: 13, margin: 0 }}>
                    照教學建立捷徑時，需要的網址和金鑰從這裡複製。「授權」那一欄要貼的是「Bearer 金鑰」整串。
                  </p>
                  <CopyButton text={`Bearer ${key.key}`} label="複製授權（Bearer 金鑰）" what="授權" />
                  <CopyButton text={links.entry} label="複製「記一筆」網址" what="記一筆網址" />
                  <CopyButton text={links.steps} label="複製「步數」網址" what="步數網址" />
                  <CopyButton text={links.location} label="複製「記下位置」網址" what="記下位置網址" />
                </div>
              </details>

              <details className="auto-box">
                <summary>⑤ 主畫面小工具（Scriptable）</summary>
                <div className="stack">
                  <div className="field">
                    <label htmlFor="auto-budget">每月預算（新台幣，0＝不顯示）</label>
                    <input
                      id="auto-budget"
                      className="text-input"
                      inputMode="numeric"
                      value={st.budget ? String(st.budget) : ''}
                      placeholder="例如 20000"
                      onChange={async (e) => {
                        const v = Number(e.target.value.replace(/[^\d]/g, '')) || 0
                        await setMeta('auto.budget', v)
                        setSt({ ...st, budget: v })
                      }}
                    />
                  </div>
                  <p className="muted" style={{ fontSize: 13, margin: 0 }}>
                    按下面的按鈕複製腳本，到 Scriptable 按右上角 + 新增腳本、貼上。改了預算要重新複製貼上。
                  </p>
                  <CopyButton
                    text={buildScriptable({ workerUrl: cfg.photoUrl, key: key.key, budget: st.budget, appUrl: appUrl() })}
                    label="複製 Scriptable 腳本"
                    what="小工具腳本"
                  />
                  <p className="muted" style={{ fontSize: 12, margin: 0 }}>
                    腳本版本 {SCRIPT_VERSION}（Scriptable 裡腳本第一行會寫版本，不一樣就重新複製貼上）
                  </p>
                </div>
              </details>
            </>
          )}
        </>
      )}
    </section>
  )
}
