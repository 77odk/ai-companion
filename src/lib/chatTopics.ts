// 最近聊天话题（事件触发：TA 的动态呼应用户提到的事）
// 聊天页用户每次发消息时 recordChatTopic 记一条（带时间戳），动态生成时 loadChatTopics 读出来注入 LLM。
// 按会话分 key（ai_space_recent_topic_<sid>），无会话回落全局 key，最多保留最近 5 条。
// ★带时间戳：TA 生成动态时能识别「这件事是哪天说的/提到哪天」，只在事件当天（或当天相关）呼应，
//   不是当天聊完当天硬发（2026-08-26 七七拍板：当天的事当天发，特定日期事件到那天再发）。
// ★futureDay（因果链第一步 2026-09-09）：约定类话题（"周五去看电影"）额外记「事发生那天」——
//   到那天（futureDay ≤ 今天）才作为事件日触发 TA 的动态呼应（"刚看完那部片"），不是说话当天就发。

import { stripMemoryMarkers } from './memory.ts'
import { parseFutureIntent, futureDayKey } from './futureIntent.ts'

const TOPICS_KEY = 'ai_space_recent_topic'
const MAX_TOPICS = 5
const TOPIC_MAX_LEN = 50

/** 一条话题：内容 + 记录时的时间戳（用于判断隔了多久、关联日期） */
export interface ChatTopic {
  t: string
  ts: number
  /** 因果链第一步：约定发生那天的自然日 key（YYYY-MM-DD），仅约定类话题有 */
  futureDay?: string
}

const topicsKey = (sessionId?: string) => (sessionId ? `${TOPICS_KEY}_${sessionId}` : TOPICS_KEY)

/** 把一条用户消息清成「可当话题的摘要」：去记忆标记、压空白、截断 */
export function cleanTopicText(text: string): string {
  const t = stripMemoryMarkers(String(text ?? ''))
    .replace(/\s+/g, ' ')
    .trim()
  if (!t) return ''
  return t.length > TOPIC_MAX_LEN ? `${t.slice(0, TOPIC_MAX_LEN)}…` : t
}

/** 读最近话题（最多 MAX_TOPICS 条，坏数据兜底空）。兼容旧版纯字符串数组（当 ts=0）与缺 futureDay 的老对象 */
export function loadChatTopics(sessionId?: string): ChatTopic[] {
  try {
    const raw = localStorage.getItem(topicsKey(sessionId))
    if (!raw) return []
    const arr = JSON.parse(raw)
    if (!Array.isArray(arr)) return []
    return arr
      .map((x): ChatTopic | null => {
        if (typeof x === 'string' && x.trim().length > 0) return { t: x.trim(), ts: 0 }
        if (x && typeof x === 'object' && typeof x.t === 'string' && x.t.trim().length > 0) {
          const futureDay = typeof x.futureDay === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(x.futureDay) ? x.futureDay : undefined
          return { t: x.t.trim(), ts: typeof x.ts === 'number' ? x.ts : 0, ...(futureDay ? { futureDay } : {}) }
        }
        return null
      })
      .filter((x): x is ChatTopic => x !== null)
      .slice(-MAX_TOPICS)
  } catch {
    return []
  }
}

/** 记一条用户消息进最近话题（太短/没内容的跳过，凑满 5 条滚旧）。ts 默认 now */
export function recordChatTopic(text: string, sessionId?: string, ts: number = Date.now()): void {
  const clean = cleanTopicText(text)
  if (clean.length < 4) return
  const topics = loadChatTopics(sessionId)
  // 因果链第一步：约定类消息（带未来时间）额外记「约定发生那天」
  const intent = parseFutureIntent(String(text ?? ''), new Date(ts))
  const topic: ChatTopic = { t: clean, ts }
  if (intent) topic.futureDay = futureDayKey(intent, new Date(ts))
  topics.push(topic)
  localStorage.setItem(topicsKey(sessionId), JSON.stringify(topics.slice(-MAX_TOPICS)))
}

/**
 * 因果链第一步：把话题列表转成「事件日」集合（纯函数，可单测）。
 * 规则：
 * - 话题本身那天（ts 的自然日）是事件日（v3 原有：当天聊的事当天可发）
 * - 约定类话题的 futureDay（约定发生那天）也是事件日，但只到「今天」为止——
 *   还没到的约定不算事件日（不能预生成未来的动态），过期太久的（> 回填窗口）由计划器自然不扫。
 * @param topics 话题列表
 * @param todayKey 今天自然日 key（YYYY-MM-DD）
 */
export function collectTopicDays(topics: ChatTopic[], todayKey: string): Set<string> {
  const out = new Set<string>()
  for (const t of topics) {
    if (!t || typeof t !== 'object') continue
    if (typeof t.ts === 'number' && Number.isFinite(t.ts) && t.ts > 0) {
      const d = new Date(t.ts)
      const m = String(d.getMonth() + 1).padStart(2, '0')
      const day = String(d.getDate()).padStart(2, '0')
      out.add(`${d.getFullYear()}-${m}-${day}`)
    }
    // 约定发生那天：已到（≤今天）才算事件日，没到不算（未来动态不预生成）
    if (typeof t.futureDay === 'string' && t.futureDay <= todayKey) {
      out.add(t.futureDay)
    }
  }
  return out
}
