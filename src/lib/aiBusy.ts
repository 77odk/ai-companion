// AI 忙碌状态工具（TASK-BUSY）
// TA 说"去洗碗了""去忙了"这类话时，真的进入忙碌状态，4-5分钟后再回来。
// 纯逻辑抽成可单测的导出函数；localStorage 读写委托给 sessionStore。

/** 忙碌关键词：TA 回复里出现这些词就触发忙碌状态 */
const BUSY_KEYWORDS = [
  '去洗碗', '洗碗了', '洗个碗',
  '去做饭', '做饭了', '煮个面', '去煮面',
  '去洗澡', '洗澡了', '洗个澡', '冲个澡',
  '我先忙', '先忙一下', '稍等我', '等我一下', '我去忙',
  '去趟厕所', '去个厕所', '上个厕所',
  '出去一下', '我出去', '出门一下',
  '去拿个', '去取个', '去倒个',
]

/** 忙碌中自动回复文案（用户发消息时回一句短的，不展开） */
const BUSY_REPLIES = [
  '在忙呢，等下说。',
  '稍等我一下，马上好。',
  '嗯，我先忙完找你。',
  '忙着呢，一会回你。',
]

export interface BusyState {
  status: 'idle' | 'busy'
  /** 忙碌结束时间戳（Date.now() 级别） */
  busyUntil: number
  /** 忙碌原因：洗碗/做饭/其他 */
  busyReason: string
  /** 忙碌前最后几条对话的 JSON 字符串（用来生成回来的消息时衔接话题） */
  busyContext: string
  /** 忙完回来的消息是否已发（防重复补发） */
  returnSent: boolean
}

/** 默认空闲状态 */
export const IDLE_STATE: BusyState = {
  status: 'idle',
  busyUntil: 0,
  busyReason: '',
  busyContext: '',
  returnSent: false,
}

/**
 * 检测文本中是否包含忙碌关键词。
 * 纯函数，可单测。
 */
export function containsBusyKeyword(text: string): boolean {
  const t = String(text ?? '')
  return BUSY_KEYWORDS.some((kw) => t.includes(kw))
}

/**
 * 找到忙碌关键词所在句子的结尾位置（用于流式截断）。
 * 截断规则：找到第一个忙碌关键词，然后从关键词往后找第一个句子结束符
 * （句号/问号/感叹号/省略号/换行/字符串结尾），截到那个位置。
 * 返回 -1 表示没找到关键词。
 * 纯函数，可单测。
 */
export function findBusyCutoff(text: string): number {
  const t = String(text ?? '')
  // 找最早出现的关键词位置
  let earliest = -1
  for (const kw of BUSY_KEYWORDS) {
    const idx = t.indexOf(kw)
    if (idx >= 0 && (earliest < 0 || idx < earliest)) earliest = idx
  }
  if (earliest < 0) return -1
  // 从关键词往后找第一个句子结束符
  const rest = t.slice(earliest)
  const sentenceEnd = rest.search(/[。！？!?…\n]/)
  if (sentenceEnd < 0) {
    // 没找到结束符，截到字符串结尾（关键词所在的整句还没说完，保留已输出部分）
    return t.length
  }
  // 截到结束符（含结束符），位置 = 关键词起点 + 结束符在rest中的索引 + 1
  return earliest + sentenceEnd + 1
}

/**
 * 生成随机忙碌时长（毫秒）。
 * 3.5-5.5 分钟，随机浮动，别每次都准点。
 * 纯函数，可单测（传 rand 注入）。
 */
export function randomBusyDurationMs(rand: () => number = Math.random): number {
  const minMs = 3.5 * 60 * 1000
  const maxMs = 5.5 * 60 * 1000
  return Math.round(minMs + rand() * (maxMs - minMs))
}

/**
 * 从忙碌原因关键词推断 reason 文案。
 * 纯函数，可单测。
 */
export function inferBusyReason(text: string): string {
  const t = String(text ?? '')
  if (/洗碗/.test(t)) return '洗碗'
  if (/做饭|煮面|煮个/.test(t)) return '做饭'
  if (/洗澡|冲澡/.test(t)) return '洗澡'
  if (/厕所/.test(t)) return '上厕所'
  if (/出去|出门/.test(t)) return '出门'
  return '忙'
}

/**
 * 取一条忙碌中自动回复文案（随机）。
 * 纯函数，可单测。
 */
export function pickBusyReply(rand: () => number = Math.random): string {
  return BUSY_REPLIES[Math.floor(rand() * BUSY_REPLIES.length)] ?? BUSY_REPLIES[0]
}

/**
 * 把忙碌前最后几条对话序列化成 context 字符串。
 * 用于生成"忙完回来"消息时衔接话题。
 * 纯函数，可单测。
 */
export function serializeBusyContext(messages: { role: string; content: string }[]): string {
  if (!Array.isArray(messages) || messages.length === 0) return ''
  return messages
    .slice(-3)
    .map((m) => `${m.role === 'user' ? '我' : 'TA'}：${String(m.content ?? '').slice(0, 100)}`)
    .join('\n')
}
