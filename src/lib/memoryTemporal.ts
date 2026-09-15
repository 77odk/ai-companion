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

function kindAndDuration(text: string): [MemoryTemporalKind, number] | null {
  const candidate = withoutQuotedTitles(String(text ?? ''))
  if (CURRENT_RE.test(candidate)) return ['current', DAY]
  if (DAY_RE.test(candidate)) return ['day', 2 * DAY]
  if (RECENT_RE.test(candidate)) return ['recent', 14 * DAY]
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
