// 自我时间线工具（TASK-SELF-TIMELINE）
// TA 的自我连续性：让它记得自己刚说过/做过什么。
// 前端无 LLM，不能推断"洗完回来了"，只能原样引用 TA 说过的话，
// 是否完成由模型自己判断。纯函数，可 Node 单测。
import { stripActionMarkers } from './api.ts'
import { stripMemoryMarkers } from './memory.ts'
import type { Lang } from './langDetect.ts'
export interface TimelineMsg {
  role: string
  content: string
  ts?: number
}
/** 单条引用最大字数 */
const MAX_LEN = 60
/** 引用最近 N 条 TA 自己的话 */
const RECENT_N = 3
/**
 * 把时间差转成"刚刚/N分钟前/N小时前/N天前"（EN: just now/N min ago/N hours ago/N days ago）。
 * ts 缺失或非法返回空串（调用方自行决定是否带时间前缀）。
 * 纯函数，可单测。
 */
export function formatAgo(ts: number | undefined, now: number = Date.now(), lang: Lang = 'zh'): string {
  if (!ts || !Number.isFinite(ts) || ts <= 0) return ''
  if (ts > now) return '' // 时间戳在未来属数据异常，不标注
  const diff = now - ts
  const min = Math.floor(diff / 60000)
  if (lang === 'en') {
    if (min < 1) return 'just now'
    if (min < 60) return `${min} min ago`
    const h = Math.floor(min / 60)
    if (h < 24) return `${h} hour${h > 1 ? 's' : ''} ago`
    const days = Math.floor(h / 24)
    return `${days} day${days > 1 ? 's' : ''} ago`
  }
  if (min < 1) return '刚刚'
  if (min < 60) return `${min}分钟前`
  const h = Math.floor(min / 60)
  if (h < 24) return `${h}小时前`
  return `${Math.floor(h / 24)}天前`
}
/**
 * 组装自我时间线注入块：取最近 N 条 TA 自己说过的话，
 * 清洗记忆/动作标记，截断，标时间差，原样引用（不推断结果）。
 * 无可用消息返回空串，注入方据此决定是否占一行。
 * 框架文字按 lang 翻译，引用内容不翻译（TA 自己说的话原样用）。
 * 纯函数，可单测。
 */
export function buildSelfTimelineBlock(messages: TimelineMsg[], now: number = Date.now(), lang: Lang = 'zh'): string {
  const list = Array.isArray(messages) ? messages : []
  const mine = list.filter(
    (m) => m?.role === 'assistant' && typeof m?.content === 'string' && m.content.trim() !== '',
  )
  const recent = mine.slice(-RECENT_N)
  if (recent.length === 0) return ''
  const isEn = lang === 'en'
  const lines: string[] = []
  for (const m of recent) {
    let text = stripMemoryMarkers(String(m.content ?? ''))
    text = stripActionMarkers(text)
    text = text.replace(/\s+/g, ' ').trim()
    if (!text) continue
    text = text.slice(0, MAX_LEN)
    const ago = formatAgo(m.ts, now, lang)
    lines.push(isEn ? `${ago ? `${ago} ` : ''}You said: ${text}` : `${ago ? `${ago} ` : ''}你说过：${text}`)
  }
  if (lines.length === 0) return ''
  if (isEn) {
    return (
      'Things you recently said (these are your own words — when they bring one up, respond based on what actually happened, don\'t act like it never happened):\n' +
      lines.map((l) => `- ${l}`).join('\n')
    )
  }
  return (
    '你刚说过的话（这是你自己说过的话，对方提起时照实接，别当没发生过）：\n' +
    lines.map((l) => `- ${l}`).join('\n')
  )
}
