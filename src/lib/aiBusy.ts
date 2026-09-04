// AI 忙碌状态工具（TASK-BUSY）
// TA 说"去洗碗了""去忙了"这类话时，真的进入忙碌状态，4-5分钟后再回来。
// 纯逻辑抽成可单测的导出函数；localStorage 读写委托给 sessionStore。

/** 忙碌触发规则：TA 回复里命中这些正则就触发忙碌状态。
 * 2026-09-04 实测修复：原来精确词表（去洗碗/洗碗了/洗个碗）太死，
 * 模型自然表达"我去把碗洗了""碗洗完了跟你说一声"全部漏网。
 * 改为覆盖"去/把/碗洗完了"等常见变体的正则族。 */
const BUSY_PATTERNS: { re: RegExp; reason: string }[] = [
  { re: /去洗碗|洗碗了|洗个碗|把碗洗|碗洗(?:完|好)/, reason: '洗碗' },
  { re: /去做饭|做饭了|煮个面|去煮面|把饭做|饭做(?:完|好)/, reason: '做饭' },
  { re: /去洗澡|洗澡了|洗个澡|冲个澡|把澡洗|澡洗(?:完|好)/, reason: '洗澡' },
  { re: /厕所/, reason: '上厕所' },
  { re: /出去|出门/, reason: '出门' },
  { re: /去拿|去取|去倒/, reason: '拿东西' },
  { re: /我先忙|先忙一下|稍等我|等我一下|我去忙|忙完找你/, reason: '忙' },
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
  return BUSY_PATTERNS.some((p) => p.re.test(t))
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
  // 找最早命中的规则位置
  let earliest = -1
  for (const p of BUSY_PATTERNS) {
    const m = p.re.exec(t)
    if (m && (earliest < 0 || m.index < earliest)) earliest = m.index
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
 * 注意：关键词表里有"洗个澡/洗个碗"这类带"个"的变体，正则必须覆盖，
 * 否则触发了忙碌却归因为"忙"，忙完回来话术对不上（2026-09-04 单测抓到）。
 */
export function inferBusyReason(text: string): string {
  const t = String(text ?? '')
  for (const p of BUSY_PATTERNS) {
    if (p.re.test(t)) return p.reason
  }
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
