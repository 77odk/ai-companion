// 最近聊天话题（TASK_UI_BATCH2 事件触发：TA 的动态优先呼应最近聊到的事）
// 聊天页用户每次发消息时 recordChatTopic 记一条，动态生成时 loadChatTopics 读出来注入 LLM。
// 按会话分 key（ai_space_recent_topic_<sid>），无会话回落全局 key，最多保留最近 5 条。

import { stripMemoryMarkers } from './memory.ts'

const TOPICS_KEY = 'ai_space_recent_topic'
const MAX_TOPICS = 5
const TOPIC_MAX_LEN = 40

const topicsKey = (sessionId?: string) => (sessionId ? `${TOPICS_KEY}_${sessionId}` : TOPICS_KEY)

/** 把一条用户消息清成「可当话题的摘要」：去记忆标记、压空白、截断 */
export function cleanTopicText(text: string): string {
  const t = stripMemoryMarkers(String(text ?? ''))
    .replace(/\s+/g, ' ')
    .trim()
  if (!t) return ''
  return t.length > TOPIC_MAX_LEN ? `${t.slice(0, TOPIC_MAX_LEN)}…` : t
}

/** 读最近话题（最多 MAX_TOPICS 条，坏数据兜底空） */
export function loadChatTopics(sessionId?: string): string[] {
  try {
    const raw = localStorage.getItem(topicsKey(sessionId))
    if (!raw) return []
    const arr = JSON.parse(raw)
    if (!Array.isArray(arr)) return []
    return arr
      .filter((x): x is string => typeof x === 'string' && x.trim().length > 0)
      .slice(-MAX_TOPICS)
  } catch {
    return []
  }
}

/** 记一条用户消息进最近话题（太短/没内容的跳过，凑满 5 条滚旧） */
export function recordChatTopic(text: string, sessionId?: string): void {
  const clean = cleanTopicText(text)
  if (clean.length < 4) return
  const topics = loadChatTopics(sessionId)
  topics.push(clean)
  localStorage.setItem(topicsKey(sessionId), JSON.stringify(topics.slice(-MAX_TOPICS)))
}
