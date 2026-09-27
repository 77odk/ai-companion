// 崩溃上报（第一方，2026-09-27）
//
// 目的：推广后用户遇到白屏，我们这边要能知道，而不是等用户来反馈。
// 隐私口径：只报「错误信息 + 组件栈 + 页面路径 + 浏览器 UA」，绝不带聊天内容、记忆、模型 key；
// 只从正式站上报；同一个错误 10 分钟内只报一次；上报本身失败一律静默，绝不影响使用。

import { API_BASE } from './sync'
import { isOfficialFrontendHost } from './siteStats'

const SENT_KEY = 'ai_companion_crash_sent'
const COOLDOWN_MS = 10 * 60 * 1000
const MAX_SIGNATURES = 20
const CRASH_PATH = '/api/crash'

export interface CrashSignatureRecord {
  [signature: string]: number
}

function readSent(): CrashSignatureRecord {
  try {
    const raw = localStorage.getItem(SENT_KEY)
    if (!raw) return {}
    const parsed = JSON.parse(raw) as unknown
    if (!parsed || typeof parsed !== 'object') return {}
    const out: CrashSignatureRecord = {}
    for (const [k, v] of Object.entries(parsed as Record<string, unknown>)) {
      if (typeof v === 'number' && Number.isFinite(v)) out[k] = v
    }
    return out
  } catch {
    return {}
  }
}

function writeSent(sent: CrashSignatureRecord): void {
  try {
    const trimmed = Object.entries(sent)
      .sort((a, b) => b[1] - a[1])
      .slice(0, MAX_SIGNATURES)
    localStorage.setItem(SENT_KEY, JSON.stringify(Object.fromEntries(trimmed)))
  } catch {
    /* 存不下就算了，上报逻辑不受影响 */
  }
}

/** 上报一次崩溃；不返回任何东西，也永不抛。 */
export function reportCrash(error: unknown, component?: string): void {
  try {
    if (!isOfficialFrontendHost()) return

    const message =
      error instanceof Error ? `${error.name}: ${error.message}` : String(error ?? 'unknown')
    const signature = message.slice(0, 120)
    const now = Date.now()

    const sent = readSent()
    const last = sent[signature] ?? 0
    if (now - last < COOLDOWN_MS) return
    sent[signature] = now
    writeSent(sent)

    const body = JSON.stringify({
      message: message.slice(0, 500),
      stack: error instanceof Error ? String(error.stack || '').slice(0, 2000) : '',
      component: String(component || '').slice(0, 300),
      path: `${location.pathname}${location.hash}`.slice(0, 200),
      ua: navigator.userAgent.slice(0, 200),
    })

    void fetch(`${API_BASE}${CRASH_PATH}`, {
      method: 'POST',
      keepalive: true,
      headers: { 'Content-Type': 'application/json' },
      body,
    }).catch(() => {})
  } catch {
    /* 上报绝不能再引发异常 */
  }
}
