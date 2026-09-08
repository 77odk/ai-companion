// 因果链第二环 · 未来约定注入聊天（futureAgenda）
// 第一环做完「约定日 → 动态呼应」（到期才发）；这一环补聊天侧：TA 得记得「约好了还没做」的事，
// 对方提起来（"周五那电影还看不看？"）TA 能自然接上，不是一问三不知。
// 纯逻辑零依赖（只 import 类型），可 Node 单测。
//
// 红线：
// - 只注入话题里真实说过的约定（ChatTopic.futureDay 存在才认），不编造
// - 只注入「还没到期/今天到期」的（到期没发动态的由第一环补，不在这重复催）
// - 至多 3 条，克制不刷屏；没约定返回空串（调用方跳过，不占上下文）
import type { ChatTopic } from './chatTopics.ts'
import type { Lang } from './langDetect.ts'

/** 距今偏移：futureDay(YYYY-MM-DD) - 今天，按本地日历算 */
export function daysUntil(futureDay: string, now: Date = new Date()): number {
  const [y, m, d] = String(futureDay ?? '').split('-').map(Number)
  if (!y || !m || !d) return NaN
  const a = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime()
  const b = new Date(y, m - 1, d).getTime()
  return Math.round((b - a) / 86400000)
}

/** 日期的口语标签：今天 / 明天 / 后天 / M月D日（en: Today/Tomorrow/M/D） */
export function dayLabel(futureDay: string, now: Date = new Date(), lang: Lang = 'zh'): string {
  const diff = daysUntil(futureDay, now)
  if (!Number.isFinite(diff)) return futureDay
  if (diff === 0) return lang === 'en' ? 'today' : '今天'
  if (diff === 1) return lang === 'en' ? 'tomorrow' : '明天'
  if (diff === 2) return lang === 'en' ? 'the day after tomorrow' : '后天'
  const parts = String(futureDay).split('-')
  const m = Number(parts[1])
  const d = Number(parts[2])
  if (lang === 'en') return `${m}/${d}`
  return `${m}月${d}日`
}

/** 类型守卫：futureDay 是合法日期串的约定话题 */
function isFutureTopic(t: ChatTopic): t is ChatTopic & { futureDay: string } {
  return typeof t?.futureDay === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(t.futureDay)
}

/**
 * 构建「你们约好的事」聊天注入块（纯函数）。
 * @param topics 该会话最近话题（loadChatTopics 输出，含 futureDay 的才是约定）
 * @param now 现在（默认真实时间）
 * @returns 注入文本；没有可注入的约定 → 空串
 */
export function buildFutureAgendaBlock(topics: ChatTopic[], now: Date = new Date(), lang: Lang = 'zh'): string {
  const list = (Array.isArray(topics) ? topics : []).filter(isFutureTopic)
  if (list.length === 0) return ''
  const todayKey = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`
  // 只留没到期 / 今天的约定（到期已过的交给动态回填，不在聊天里反复提旧账）
  const pending = list
    .filter((t) => t.futureDay >= todayKey)
    .sort((a, b) => (a.futureDay < b.futureDay ? -1 : 1))
    .slice(0, 3)
  if (pending.length === 0) return ''
  const isEn = lang === 'en'
  const lines = pending.map((t) => {
    const what = String(t.t ?? '').slice(0, 40)
    const when = dayLabel(t.futureDay, now, lang)
    return isEn ? `- ${when}: ${what}` : `- ${when}：${what}`
  })
  if (isEn) {
    return (
      "Things you two agreed to do together (they're upcoming, don't act like they already happened):\n" +
      lines.join('\n') +
      "\nBring one up naturally when it fits — don't report it stiffly or turn it into a question."
    )
  }
  return (
    '你们说好要做的事（还没到日子，别当成已经做了）：\n' +
    lines.join('\n') +
    '\n聊到相关处自然提一句就行，别生硬报备，也别急着追问对方。'
  )
}
