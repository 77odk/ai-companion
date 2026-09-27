// 最近聊天素材：给 TA 的 Space 提供“对话余响”与已确认事件证据。
// 继续沿用现有 ai_space_recent_topic_<sid> key，不新增 storage key。
// 新聊天先记 USER 原话；只有 TA 最终可见回复真实落库后，才补成 pairVersion=1 的“对话对”。
// 老数据没有 pairVersion/taText，保留可读但绝不自动升级成 conversation 素材。
//
// FutureIntent 只证明“约好了”：到 futureDay 只能作为 planned 素材。
// “是否真的共同发生/完成”不在本地做语义正则判断；交给 Space 本来就会执行的那一次 LLM 生成判定。

import { stripMemoryMarkers } from './memory.ts'
import { parseFutureIntent, futureDayKey } from './futureIntent.ts'

const TOPICS_KEY = 'ai_space_recent_topic'
const MAX_TOPICS = 8
const TOPIC_MAX_LEN = 80
const REPLY_MAX_LEN = 240
const CONVERSATION_MIN_LEN = 6

/** 一条聊天素材。pairVersion=1 + taText 表示这是本批之后真实完成的一轮对话。 */
export interface ChatTopic {
  t: string
  ts: number
  /** 约定发生日（YYYY-MM-DD）；只代表 planned，不代表发生。 */
  futureDay?: string
  /** TA 当轮最终真实可见回复；旧数据没有。 */
  taText?: string
  /** TA 回复真实落库时间。 */
  taTs?: number
  /** 只有新格式完整对话对才写 1；旧数据不迁移。 */
  pairVersion?: 1
}

export interface SpaceConversationPair {
  userText: string
  taText: string
  ts: number
  taTs: number
  /** 这组素材来自此前“约好今天做”的 FutureIntent；planned 本身不代表已经发生。 */
  plannedForDay: boolean
}

const topicsKey = (sessionId?: string) => (sessionId ? `${TOPICS_KEY}_${sessionId}` : TOPICS_KEY)

function dayKeyOfTs(ts: number): string {
  const d = new Date(ts)
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${d.getFullYear()}-${m}-${day}`
}

/** USER 原话只做轻清洗，不做语义摘要。 */
export function cleanTopicText(text: string): string {
  const t = stripMemoryMarkers(String(text ?? ''))
    .replace(/\s+/g, ' ')
    .trim()
  if (!t) return ''
  return t.length > TOPIC_MAX_LEN ? `${t.slice(0, TOPIC_MAX_LEN)}…` : t
}

/** TA 回复同样只压空白/截长，保留 TA 当时真实理解，不二次调用模型。 */
export function cleanTopicReply(text: string): string {
  const t = stripMemoryMarkers(String(text ?? ''))
    .replace(/\s+/g, ' ')
    .trim()
  if (!t) return ''
  return t.length > REPLY_MAX_LEN ? `${t.slice(0, REPLY_MAX_LEN)}…` : t
}

/** 读素材。老字符串/老对象继续兼容读取，但不会被伪装成新对话对。 */
export function loadChatTopics(sessionId?: string): ChatTopic[] {
  try {
    const raw = localStorage.getItem(topicsKey(sessionId))
    if (!raw) return []
    const arr = JSON.parse(raw)
    if (!Array.isArray(arr)) return []
    return arr
      .map((x): ChatTopic | null => {
        if (typeof x === 'string' && x.trim().length > 0) return { t: x.trim(), ts: 0 }
        if (!x || typeof x !== 'object' || typeof x.t !== 'string' || x.t.trim().length === 0) return null
        const futureDay = typeof x.futureDay === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(x.futureDay)
          ? x.futureDay
          : undefined
        const topic: ChatTopic = {
          t: x.t.trim(),
          ts: typeof x.ts === 'number' && Number.isFinite(x.ts) ? x.ts : 0,
          ...(futureDay ? { futureDay } : {}),
        }
        if (
          x.pairVersion === 1 &&
          typeof x.taText === 'string' &&
          x.taText.trim().length > 0 &&
          typeof x.taTs === 'number' &&
          Number.isFinite(x.taTs)
        ) {
          topic.pairVersion = 1
          topic.taText = x.taText.trim()
          topic.taTs = x.taTs
        }
        return topic
      })
      .filter((x): x is ChatTopic => x !== null)
      .slice(-MAX_TOPICS)
  } catch {
    return []
  }
}

/** USER 消息先记下来；此时还不是 conversation 素材，必须等 TA 回复真实落库。 */
export function recordChatTopic(text: string, sessionId?: string, ts: number = Date.now()): void {
  const clean = cleanTopicText(text)
  if (clean.length < 4) return
  const topics = loadChatTopics(sessionId)
  const intent = parseFutureIntent(String(text ?? ''), new Date(ts))
  const topic: ChatTopic = { t: clean, ts }
  if (intent) topic.futureDay = futureDayKey(intent, new Date(ts))
  topics.push(topic)
  localStorage.setItem(topicsKey(sessionId), JSON.stringify(topics.slice(-MAX_TOPICS)))
}

/**
 * TA 最终可见回复已经真实落库后，把同一轮 USER 素材补成“对话对”。
 * 精确锁 userTs + 清洗后 USER 文本，避免并发/切角色时串轮；找不到就不猜。
 */
export function completeChatTopicPair(
  userText: string,
  taText: string,
  sessionId?: string,
  userTs: number = 0,
  taTs: number = Date.now(),
): boolean {
  if (!Number.isFinite(userTs) || userTs <= 0) return false
  const user = cleanTopicText(userText)
  const reply = cleanTopicReply(taText)
  if (!user || !reply) return false
  const topics = loadChatTopics(sessionId)
  for (let i = topics.length - 1; i >= 0; i--) {
    const topic = topics[i]
    if (topic.ts !== userTs || topic.t !== user || topic.pairVersion === 1) continue
    topics[i] = { ...topic, taText: reply, taTs, pairVersion: 1 }
    localStorage.setItem(topicsKey(sessionId), JSON.stringify(topics.slice(-MAX_TOPICS)))
    return true
  }
  return false
}

/**
 * 只做机械粗筛，不做“事件有没有发生”的语义判断。
 * - 字数下限；
 * - 去掉空白/标点后有足够字符多样性，过滤纯“哈哈哈哈 / 好的好的 / 在吗在吗”一类低信息重复。
 * 拿不准的完整对话对全部留下，最终是否值得发、属于 conversation 还是 event，
 * 交给进入 Space 时本来就会发生的那一次模型调用。
 */
export function hasConcreteTopicInfo(text: string): boolean {
  const t = cleanTopicText(text)
  if (t.length < CONVERSATION_MIN_LEN) return false
  const dense = Array.from(t.toLowerCase()).filter((ch) => /[\p{L}\p{N}]/u.test(ch))
  if (dense.length < CONVERSATION_MIN_LEN) return false
  return new Set(dense).size >= 4
}

export function isConversationMaterialCandidate(topic: ChatTopic): boolean {
  return (
    topic.pairVersion === 1 &&
    typeof topic.taText === 'string' &&
    topic.taText.trim().length > 0 &&
    typeof topic.taTs === 'number' &&
    Number.isFinite(topic.taTs) &&
    topic.taTs > 0 &&
    hasConcreteTopicInfo(topic.t)
  )
}

/** 新格式里已经完整成对的 planned FutureIntent。旧 futureDay 因没有 pairVersion，不会进入。 */
export function collectPlannedDays(topics: ChatTopic[], todayKey: string): Set<string> {
  const out = new Set<string>()
  for (const topic of topics) {
    if (!isConversationMaterialCandidate(topic)) continue
    if (topic.futureDay && topic.futureDay <= todayKey) out.add(topic.futureDay)
  }
  return out
}

/**
 * conversation 有两种来源：
 * - 当天真实完整对话对；
 * - 到了约定日的 planned 对话对。
 * 最终 source 在单次 Space LLM 生成后决定；本层只负责候选日期。
 */
export function collectConversationDays(topics: ChatTopic[], todayKey: string): Set<string> {
  const out = collectPlannedDays(topics, todayKey)
  for (const topic of topics) {
    if (!isConversationMaterialCandidate(topic) || topic.ts <= 0) continue
    const day = dayKeyOfTs(topic.ts)
    if (day <= todayKey) out.add(day)
  }
  return out
}

/** conversation 的因果时间下界：普通余响晚于 TA 回复；planned 日则至少不能早于 7:00（旧证据不会推到未来）。 */
export function collectConversationEvidenceAt(topics: ChatTopic[], todayKey: string): Map<string, number> {
  const out = new Map<string, number>()
  for (const topic of topics) {
    if (!isConversationMaterialCandidate(topic)) continue
    if (topic.ts > 0) {
      const day = dayKeyOfTs(topic.ts)
      if (day <= todayKey) out.set(day, Math.max(out.get(day) ?? 0, topic.taTs ?? topic.ts))
    }
    if (topic.futureDay && topic.futureDay <= todayKey) {
      const previous = out.get(topic.futureDay)
      // 约定是过去说的：不用旧时间戳把约定日动态推成“刚发生”；没有当天证据时保持 undefined。
      if (previous == null) out.set(topic.futureDay, 0)
    }
  }
  return out
}

/**
 * 只给某条 Space 动态它对应自然日的真实素材，最多 3 组；不再塞“最近 5 条不相干话题”。
 * plannedForDay 只代表“今天是说好的那天”；是否真的发生不在本层判断。
 */
export function conversationPairsForDay(
  topics: ChatTopic[],
  dayKey: string,
  limit: number = 3,
): SpaceConversationPair[] {
  const rows: SpaceConversationPair[] = []
  for (const topic of topics) {
    if (!isConversationMaterialCandidate(topic)) continue
    const sameDay = topic.ts > 0 && dayKeyOfTs(topic.ts) === dayKey
    const plannedForDay = topic.futureDay === dayKey
    if (!sameDay && !plannedForDay) continue
    rows.push({
      userText: topic.t,
      taText: topic.taText as string,
      ts: topic.ts,
      taTs: topic.taTs as number,
      plannedForDay,
    })
  }

  const sorted = rows.sort((a, b) => Math.max(a.taTs, a.ts) - Math.max(b.taTs, b.ts))
  const maxRows = Math.max(1, limit)
  const selected = sorted.slice(-maxRows)

  // 如果这天来自旧约定，至少保留一组 planned 原始对话，让模型能把“当天发生了什么”
  // 与“之前约好了什么”放在一起理解；不在本地做动作词匹配。
  const latestPlanned = [...sorted].reverse().find((row) => row.plannedForDay)
  if (
    latestPlanned &&
    !selected.some((row) => row.ts === latestPlanned.ts && row.taTs === latestPlanned.taTs)
  ) {
    selected[0] = latestPlanned
    selected.sort((a, b) => Math.max(a.taTs, a.ts) - Math.max(b.taTs, b.ts))
  }
  return selected
}

/**
 * 兼容旧调用名：保留原合同“话题日 + 已到期约定日”。
 * Space-N1 的运行链不再用它判 Event；保留只为旧调用/旧测试合同兼容。
 */
export function collectTopicDays(topics: ChatTopic[], todayKey: string): Set<string> {
  const out = new Set<string>()
  for (const topic of topics) {
    if (!topic || typeof topic !== 'object') continue
    if (typeof topic.ts === 'number' && Number.isFinite(topic.ts) && topic.ts > 0) {
      out.add(dayKeyOfTs(topic.ts))
    }
    if (typeof topic.futureDay === 'string' && topic.futureDay <= todayKey) {
      out.add(topic.futureDay)
    }
  }
  return out
}

/** 兼容旧调用名：保留原合同，只按真实聊天时间给话题日下界。 */
export function collectTopicEvidenceAt(topics: ChatTopic[]): Map<string, number> {
  const out = new Map<string, number>()
  for (const topic of topics) {
    if (!topic || typeof topic !== 'object' || !Number.isFinite(topic.ts) || topic.ts <= 0) continue
    const day = dayKeyOfTs(topic.ts)
    out.set(day, Math.max(out.get(day) ?? 0, topic.ts))
  }
  return out
}
