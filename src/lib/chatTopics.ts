// 最近聊天素材：给 TA 的 Space 提供“对话余响”与已确认事件证据。
// 继续沿用现有 ai_space_recent_topic_<sid> key，不新增 storage key。
// 新聊天先记 USER 原话；只有 TA 最终可见回复真实落库后，才补成 pairVersion=1 的“对话对”。
// 老数据没有 pairVersion/taText，保留可读但绝不自动升级成 conversation 素材。
//
// FutureIntent 只证明“约好了”：到 futureDay 只能作为 planned 素材。
// 只有当天新对话里出现保守的完成证据，才升级成 confirmed event；宁可漏掉，也不能把约定写成已经发生。

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
  /** 这组素材来自此前“约好今天做”的 FutureIntent。 */
  plannedForDay: boolean
  /** 当天聊天出现了保守的“已经完成”证据。 */
  confirmedCompletion: boolean
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
 * 只做“粗筛”，不替模型理解语义：
 * 1) USER 原话达到最低长度；
 * 2) 至少带一个机械的具体信息信号（时间 / 场景地点 / 人与动作 / 明确状态或事情）。
 * 拿不准的留下，生成动态的那一次模型仍可返回 SKIP。
 */
export function hasConcreteTopicInfo(text: string): boolean {
  const t = cleanTopicText(text)
  if (t.length < CONVERSATION_MIN_LEN) return false
  const time = /(?:今天|昨天|明天|今晚|今早|早上|上午|中午|下午|晚上|凌晨|周[一二三四五六日天]|星期[一二三四五六日天]|\d{1,2}[点时:：月日号]|\b(?:today|yesterday|tomorrow|tonight|this\s+(?:morning|afternoon|evening)|monday|tuesday|wednesday|thursday|friday|saturday|sunday)\b|\b\d{1,2}(?::\d{2})?\s?(?:am|pm)\b)/i
  const place = /(?:在|去|到|回|从).{0,10}(?:家|公司|学校|医院|店|路|站|机场|车站|办公室|宿舍|城市|现场)|\b(?:at|in|to|from)\s+(?:home|work|the\s+office|office|school|hospital|the\s+store|store|station|airport)\b/i
  const personAction = /(?:我|你|他|她|TA|朋友|同事|家人|妈妈|爸爸|老板|老师).{0,14}(?:说|告诉|问|去|来|到|回|做|看|吃|喝|睡|工作|上班|下班|开会|考试|面试|生病|住院|难受|开心|生气|委屈|害怕|担心|焦虑|累|哭|笑|决定|发生|遇到|喜欢|想)|\b(?:i|you|he|she|we|they|my\s+(?:friend|coworker|colleague|mom|mother|dad|father|boss|teacher))\b.{0,24}\b(?:said|told|asked|went|came|got|did|made|saw|ate|drank|slept|worked|met|felt|feel|am|was|had|have|decided|happened|liked|wanted|worried|cried|laughed)\b/i
  const eventState = /(?:说个事|跟你说|告诉你|发生|结束|完成|看完|做完|到了|到家|回来|散场|开会|考试|面试|住院|生病|吵架|和好|生日|手术|比赛|被夸|被批评|收到|拿到|丢了|不舒服|失眠)|\b(?:meeting|exam|interview|birthday|surgery|game|argument|hospital|sick|finished|ended|arrived|received|lost|insomnia)\b/i
  return time.test(t) || place.test(t) || personAction.test(t) || eventState.test(t)
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

/** 完成证据只做保守候选识别；宁可漏掉，不能把计划、否定或假设升级成“做完了”。 */
export function hasCompletionEvidence(text: string): boolean {
  const t = cleanTopicText(text)
  if (!t) return false

  // 先排除“差点 / 还没 / 如果 / 打算”等明显未完成或假设语气。
  // 这是硬安全门，不追求全语言理解；拿不准就不升级 confirmed。
  const negatedOrConditional =
    /(?:差点|险些|还没|尚未|没有|没能|如果|假如|要是|准备|打算|计划|想要|想|等会|待会).{0,24}(?:看完|做完|完成|结束|散场|到家|回来)|(?:看完|做完|完成|结束|散场|到家|回来).{0,12}(?:再|才).{0,12}(?:说|聊|做)|\b(?:almost|nearly|haven't|have\s+not|hasn't|has\s+not|didn't|did\s+not|not\s+(?:finished|completed|done)|if|unless|when|once|plan(?:ned)?\s+to|going\s+to|will|would)\b/i
  const interrogativeOrUncertain =
    /[？?]|(?:吗|么|是不是|是否|有没有|可能|也许|大概|好像|似乎).{0,18}(?:看完|做完|完成|结束|散场|到家|回来)|(?:看完|做完|完成|结束|散场|到家|回来).{0,12}(?:吗|么|吧|可能|也许|大概)|\b(?:did|have|has|could|might|maybe|perhaps|probably|possibly)\b.{0,24}\b(?:finish(?:ed)?|complete(?:d)?|end(?:ed)?|done|return(?:ed)?)\b/i
  if (negatedOrConditional.test(t) || interrogativeOrUncertain.test(t)) return false

  const zhCompleted =
    /(?:刚(?:刚|才)?|已经|终于).{0,18}(?:看完|做完|完成|结束|散场|到家|回来)|(?:看完|做完|完成|结束|散场|到家|回来).{0,12}(?:了|啦)/
  const enCompleted =
    /\b(?:just|already|finally)\b.{0,30}\b(?:finished|completed|ended|got\s+home|came\s+back|returned)\b|\b(?:finished|completed|ended|got\s+home|came\s+back|returned)\b.{0,18}\b(?:already|finally|today|tonight)\b/i
  return zhCompleted.test(t) || enCompleted.test(t)
}

/**
 * confirmed event 必须由“这句话本身”证明是共同动作。
 * 不再用“同一天存在 planned”给无关完成事项背书，也不把“跟你说”这类称呼当共同经历。
 */
export function hasSharedCompletionSubject(text: string): boolean {
  const t = cleanTopicText(text)
  if (!t) return false
  // 共同主语必须直接绑定到“完成谓词”本身；中间再出现新的单数主语就不认。
  // 例如“我们聊了会儿，我终于做完作业了”不能借前半句的“我们”升级成共同 Event。
  const zhShared =
    /(?:我们|咱们|我和你|你和我|我俩|咱俩)(?:(?!我(?:刚|已经|终于|才)?).){0,24}(?:看完|做完|完成|结束|散场|到家|回来)|(?:和你|跟你|陪你).{0,8}(?:一起|一块儿|一块).{0,16}(?:看完|做完|完成|结束|散场|到家|回来)/
  const enShared =
    /\b(?:we|you\s+and\s+i|i\s+and\s+you)\b(?:(?!\b(?:i|he|she|they)\b).){0,32}\b(?:finished|completed|ended|got\s+home|came\s+back|returned)\b/i
  return zhShared.test(t) || enShared.test(t)
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
 * confirmed event 日由事件通道优先，aiSpace planner 会避免同天再发 conversation。
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

/** 哪些日期有足够依据升级为 confirmed event。 */
export function collectConfirmedEventDays(topics: ChatTopic[], todayKey: string): Set<string> {
  const out = new Set<string>()
  for (const topic of topics) {
    if (!isConversationMaterialCandidate(topic) || topic.ts <= 0) continue
    const day = dayKeyOfTs(topic.ts)
    if (day > todayKey) continue
    // confirmed 只认“这一条真实对话自身就能证明：共同动作已经完成”。
    // planned 仍可进入 conversation，但绝不能仅凭同日计划把别的完成事项升级成共同 Event。
    if (hasCompletionEvidence(topic.t) && hasSharedCompletionSubject(topic.t)) out.add(day)
  }
  return out
}

export function collectConfirmedEventEvidenceAt(topics: ChatTopic[], todayKey: string): Map<string, number> {
  const confirmed = collectConfirmedEventDays(topics, todayKey)
  const out = new Map<string, number>()
  for (const topic of topics) {
    if (!isConversationMaterialCandidate(topic) || topic.ts <= 0) continue
    const day = dayKeyOfTs(topic.ts)
    if (
      !confirmed.has(day) ||
      !hasCompletionEvidence(topic.t) ||
      !hasSharedCompletionSubject(topic.t)
    ) continue
    out.set(day, Math.max(out.get(day) ?? 0, topic.taTs ?? topic.ts))
  }
  return out
}

/**
 * 只给某条 Space 动态它对应自然日的真实素材，最多 3 组；不再塞“最近 5 条不相干话题”。
 * plannedForDay 只代表“今天是说好的那天”；confirmedCompletion 才代表已完成。
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
      confirmedCompletion:
        sameDay &&
        hasCompletionEvidence(topic.t) &&
        hasSharedCompletionSubject(topic.t),
    })
  }
  const sorted = rows
    .sort((a, b) => Math.max(a.taTs, a.ts) - Math.max(b.taTs, b.ts))
  const maxRows = Math.max(1, limit)
  const selected = sorted.slice(-maxRows)
  const latestConfirmed = [...sorted].reverse().find((row) => row.confirmedCompletion)
  if (
    latestConfirmed &&
    !selected.some((row) => row.ts === latestConfirmed.ts && row.taTs === latestConfirmed.taTs)
  ) {
    selected[0] = latestConfirmed
    selected.sort((a, b) => Math.max(a.taTs, a.ts) - Math.max(b.taTs, b.ts))
  }
  return selected
}

/**
 * 兼容旧调用名：保留原合同“话题日 + 已到期约定日”。
 * Space-N1 的 grounded Event 不再使用它，而是显式调用 collectConfirmedEventDays。
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
