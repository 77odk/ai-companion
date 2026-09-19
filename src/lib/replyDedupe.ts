// 回复去复读（TASK-REPLY-HYGIENE）
// 现象：弱模型（实测智谱 glm-4.7-flash、中转 Gemini）会把自己上一两句原样再发一遍，
// 用户看到「我正在吃早餐呢，等下还得去图书馆把论文改完」连发三条。
// 做法：本轮拆出的气泡，若与最近两条 TA 自己的消息「整条一样」，就不发这条气泡。
// 红线：
//   - 只丢重复气泡，绝不改内容、不动顺序、不动分条规则本身；
//   - 太短的不判（「嗯」「好」这类天然会重复）；
//   - 若本轮所有气泡都被判重（例如用户就是要求「再说一遍」），原样保留，宁可重复也不吞回复。

/** 归一化：去空白 + 去尾部标点，只用于比较 */
const norm = (s: string): string =>
  String(s ?? '')
    .replace(/\s+/g, '')
    .replace(/[。．.！!？?，,、~～…]+$/u, '')

/** 少于这个字数不判重 */
export const MIN_DUP_LEN = 8

/** 往回看几条 TA 自己的消息 */
export const LOOKBACK = 2

export interface ReplyPart {
  content: string
}

export interface HistoryMsg {
  role: string
  content: string
}

/**
 * 丢掉与最近 TA 自己消息整条重复的气泡。
 * @param parts 本轮拆好的气泡（顺序不变）
 * @param history 本轮之前的会话消息（含 user / assistant）
 */
export function dropRepeatedReplies<T extends ReplyPart>(
  parts: T[],
  history: HistoryMsg[],
  lookback: number = LOOKBACK,
): T[] {
  if (!Array.isArray(parts) || parts.length === 0) return parts
  const recent = (Array.isArray(history) ? history : [])
    .filter((m) => m && m.role === 'assistant' && typeof m.content === 'string' && m.content.trim() !== '')
    .slice(-lookback)
    .map((m) => norm(m.content))
    .filter((n) => n.length >= MIN_DUP_LEN)
  if (recent.length === 0) return parts
  const fresh = parts.filter((p) => {
    const n = norm(p?.content)
    if (n.length < MIN_DUP_LEN) return true
    return !recent.includes(n)
  })
  return fresh.length > 0 ? fresh : parts
}
