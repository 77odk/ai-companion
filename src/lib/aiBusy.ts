// AI 忙碌状态工具（TASK-BUSY）
// TA 说"我去洗碗了""我先去开个会"这类表达"离开去忙"的话时，进入忙碌状态，4-5分钟后再回来。
// 2026-09-05 升级：从词表精确匹配改为"离开意图"句式正则匹配——不枚举具体事情，匹配句式结构。
// 纯逻辑抽成可单测的导出函数；localStorage 读写委托给 sessionStore。

/**
 * 离开意图前缀：TA 表达"我要离开去做某事"的起始词。
 * 不枚举具体事情（洗碗/开会/写报告），只匹配"离开意图"的句式结构。
 */
const BUSY_INTENT_PREFIX = /(我去|我出去|我先|我得|我要去|等我|我忙一下|我去忙)/

/**
 * 完整离开句式：前缀 + 0~12 字内容 + 结尾词（了/吧/啊/啦/。/～）。
 * 用于"触发判定"——只有完整的离开句式才触发 busy，半句话不触发。
 */
const BUSY_INTENT_FULL = /(我去|我出去|我先|我得|我要去|等我|我忙一下|我去忙).{0,12}(了|吧|啊|啦|一下|。|～|！|？)/

/**
 * 排除列表：句式命中但内容是奔向对方的（为对方做的事），不触发。
 * TA 说"我去找你吧"是要继续聊，不该消失 4-5 分钟。
 */
const BUSY_EXCLUDE = /(找你|接你|给你|陪你|来看你|去找你)/

/**
 * 第三批⑩：英文 busy 句式（二期）——英文用户说 "I'll go wash the dishes" 也触发。
 * 英文前缀：I'll go / I'm going to / let me / I need to / I'm gonna / I'll go handle / brb 等
 */
const BUSY_INTENT_PREFIX_EN = /(I'?ll go|I'?m going to|let me|I need to|I'?m gonna|I'?ll go handle|I'?ll be right back|brb|I'?m off to|I gotta|I'?ve got to)/i

/**
 * 英文完整离开句式：前缀 + 0~20 字符内容 + 结尾词（now/right away/quickly/brb/./! 等）
 */
const BUSY_INTENT_FULL_EN = /(I'?ll go|I'?m going to|let me|I need to|I'?m gonna|I'?ll go handle|I'?ll be right back|brb|I'?m off to|I gotta|I'?ve got to).{0,30}(now|right away|quickly|brb|be right back|\.|!|~)/i

/**
 * 英文排除列表：come find you / see you / pick you up 这类奔向对方的，不触发
 */
const BUSY_EXCLUDE_EN = /(come find you|come see you|see you|pick you up|get you|meet you|come get you)/i

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
 * 匹配离开意图句式，返回匹配对象或 null。
 *
 * 两层分离（乔 2026-09-05 强调）：
 * - 本函数管"触发判定"——这句是不是完整离开句式（有结尾词、不被排除列表排除）
 * - findBusyCutoff 管"流式截断位置"——截在哪、别掐半句话
 *
 * 纯函数，可单测。
 */
export function matchBusyIntent(text: string): RegExpMatchArray | null {
  const t = String(text ?? '')
  // 中文句式
  const m = t.match(BUSY_INTENT_FULL)
  if (m) {
    if (BUSY_EXCLUDE.test(m[0])) return null
    return m
  }
  // 第三批⑩：英文句式
  const mEn = t.match(BUSY_INTENT_FULL_EN)
  if (mEn) {
    if (BUSY_EXCLUDE_EN.test(mEn[0])) return null
    return mEn
  }
  // 英文纯离开词：brb / gotta go / be right back 单独出现即离开意图（2026-09-05 乔补强）
  const pureEn = t.match(/\b(brb|be right back|gotta go|gtg|i'?m off)\b/i)
  if (pureEn) {
    if (BUSY_EXCLUDE_EN.test(pureEn[0])) return null
    return pureEn
  }
  // 英文前缀 + 动作（无结束语也触发，如 "I'll go wash the dishes"）：
  // 前缀命中后检查后续内容，含"非离开动词"（think/tell you/with you 等）→ 不是离开，不触发
  // （2026-09-05 乔补强：原版只认带结尾词 now/right away 的句式，日常口语大量漏匹配）
  const prefixEn = t.match(BUSY_INTENT_PREFIX_EN)
  if (prefixEn) {
    const after = t.slice((prefixEn.index ?? 0) + prefixEn[0].length).slice(0, 40)
    if (BUSY_EXCLUDE_EN.test(after)) return null
    // 非离开动词黑名单：以这些开头说明还要继续聊/跟你相关，不是去忙
    if (
      /(think|tell you|ask you|talk to you|chat with you|show you|help you|explain|be honest|with you|wait for you|come get you)/i.test(
        after,
      )
    ) {
      return null
    }
    return prefixEn
  }
  return null
}

/**
 * 检测文本中是否包含离开意图句式。
 * 纯函数，可单测。
 */
export function containsBusyKeyword(text: string): boolean {
  return matchBusyIntent(text) !== null
}

/**
 * 找到离开意图句式所在句子的结尾位置（用于流式截断）。
 *
 * 两层分离：本函数管"截在哪"——找到离开意图前缀的起始位置，往后找第一个句子结束符
 * （句号/问号/感叹号/省略号/换行/字符串结尾），截到那个位置。
 * 不管"这句是不是完整离开句式"——那是 matchBusyIntent 的事。
 *
 * 返回 -1 表示没找到离开意图前缀。
 * 纯函数，可单测。
 */
export function findBusyCutoff(text: string): number {
  const t = String(text ?? '')
  // 中文前缀
  let m = t.match(BUSY_INTENT_PREFIX)
  // 第三批⑩：英文前缀
  const mEn = t.match(BUSY_INTENT_PREFIX_EN)
  // 取最早出现的前缀位置
  let earliest = -1
  if (m && m.index !== undefined) earliest = m.index
  if (mEn && mEn.index !== undefined && (earliest < 0 || mEn.index < earliest)) {
    earliest = mEn.index
    m = mEn
  }
  if (earliest < 0) return -1
  // 从前缀往后找第一个句子结束符
  const rest = t.slice(earliest)
  const sentenceEnd = rest.search(/[。！？!?…\n]/)
  if (sentenceEnd < 0) {
    // 没找到结束符，截到字符串结尾（关键词所在的整句还没说完，保留已输出部分）
    return t.length
  }
  // 截到结束符（含结束符），位置 = 前缀起点 + 结束符在rest中的索引 + 1
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
  if (/洗碗|洗个碗/.test(t)) return '洗碗'
  if (/做饭|煮面|煮个/.test(t)) return '做饭'
  if (/洗澡|冲澡|洗个澡/.test(t)) return '洗澡'
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
