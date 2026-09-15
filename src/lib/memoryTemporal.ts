export type MemoryTemporalKind = 'stable' | 'current' | 'day' | 'recent'

export interface MemoryTemporalState {
  kind: MemoryTemporalKind
  temporary: boolean
  expired: boolean
  expiresAt?: number
}

const HOUR = 60 * 60 * 1000
const DAY = 24 * HOUR

const CURRENT_RE = /(?:现在|正在|这会儿|刚刚|刚才|此刻|眼下|目前正在|刚吃完|刚到|刚下班|刚起床)|\b(?:right now|currently|at the moment|just now|just finished|just got|just arrived)\b/i
const DAY_RE = /(?:今天下午|今天晚上|今天|今晚|今早|今晨|明天|明早|明晚|昨天|昨晚)|\b(?:today|tonight|this morning|tomorrow|yesterday|last night)\b/i
const RECENT_RE = /(?:最近几天|最近|这两天|这几天|近期|这周|本周|这个星期|这阵子)|\b(?:recently|these days|this week|lately|for the past few days)\b/i
// 「刚 + 状态变化/人生事件」：这些不是当天环境动作，而是会持续一段时间的处境，
// 保守按 recent（14d）处理，避免「我刚分手了」这类当下状态被当成永不过期的事实。
// 注意：刚下班 / 刚到 / 刚起床 / 刚吃完 属当下状态，仍走 CURRENT（24h），不在本表内。
const JUST_EVENT_RE = /刚(?:才)?(?:分手|搬家|辞职|离职|入职|结婚|离婚|搬到|换工作|失业|毕业)|\bjust (?:broke up|moved|quit|resigned|got married|got divorced|graduated|started a new job)\b/i

/**
 * Titles and explicit quotations can contain a time word as a name rather than
 * as a time constraint (for example, “我喜欢《今天》这首歌”). Ignore those
 * spans before applying the deliberately conservative temporal rules.
 */
function withoutQuotedTitles(text: string): string {
  return text
    .replace(/《[^》]*》/g, '')
    .replace(/「[^」]*」/g, '')
    .replace(/『[^』]*』/g, '')
    .replace(/[“"][^”"]*[”"]/g, '')
}

/**
 * 语义优先级（V1 定稿）：recent（明确阶段词） → recent（刚+人生事件） → current → day → stable。
 * 不用「取最长时长」：那样会把「我今天刚下班」也拉成 14d，丢掉当下状态该有的短期性。
 */
function kindAndDuration(text: string): [MemoryTemporalKind, number] | null {
  const candidate = withoutQuotedTitles(String(text ?? ''))
  if (RECENT_RE.test(candidate)) return ['recent', 14 * DAY]
  if (JUST_EVENT_RE.test(candidate)) return ['recent', 14 * DAY]
  if (CURRENT_RE.test(candidate)) return ['current', DAY]
  if (DAY_RE.test(candidate)) return ['day', 2 * DAY]
  return null
}

/** Pure, repeatable temporal policy based only on final memory text and time. */
export function classifyMemoryTemporal(
  text: string,
  createdAt: number,
  now: number = Date.now(),
): MemoryTemporalState {
  const match = kindAndDuration(text)
  if (!match) return { kind: 'stable', temporary: false, expired: false }

  const [kind, duration] = match
  if (!Number.isFinite(createdAt) || createdAt <= 0) {
    return { kind, temporary: true, expired: false }
  }

  const expiresAt = createdAt + duration
  const expired = Number.isFinite(now) && now > expiresAt
  return { kind, temporary: true, expired, expiresAt }
}

/** Invalid or missing legacy timestamps stay active rather than being silently lost. */
export function isMemoryActive(
  memory: { text: string; createdAt?: number },
  now: number = Date.now(),
): boolean {
  return !classifyMemoryTemporal(memory.text, memory.createdAt as number, now).expired
}
