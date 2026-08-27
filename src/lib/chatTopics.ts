// 最近聊天话题（事件触发：TA 的动态呼应用户提到的事）
// 聊天页用户每次发消息时 recordChatTopic 记一条（带时间戳），动态生成时 loadChatTopics 读出来注入 LLM。
// 按会话分 key（ai_space_recent_topic_<sid>），无会话回落全局 key，最多保留最近 5 条。
// ★带时间戳：TA 生成动态时能识别「这件事是哪天说的/提到哪天」，只在事件当天（或当天相关）呼应，
//   不是当天聊完当天硬发（2026-08-26 七七拍板：当天的事当天发，特定日期事件到那天再发）。

import { stripMemoryMarkers } from './memory.ts'

const TOPICS_KEY = 'ai_space_recent_topic'
const MAX_TOPICS = 5
const TOPIC_MAX_LEN = 50

/** 一条话题：内容 + 记录时的时间戳（用于判断隔了多久、关联日期） */
export interface ChatTopic {
  t: string
  ts: number
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

/** 读最近话题（最多 MAX_TOPICS 条，坏数据兜底空）。兼容旧版纯字符串数组（当 ts=0） */
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
          return { t: x.t.trim(), ts: typeof x.ts === 'number' ? x.ts : 0 }
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
  topics.push({ t: clean, ts })
  localStorage.setItem(topicsKey(sessionId), JSON.stringify(topics.slice(-MAX_TOPICS)))
}
