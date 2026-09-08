// 因果链第一步 · 未来意图识别（纯函数，零依赖，可 Node 单测）
// 目标：从聊天里认出「约好/计划/想看」类的话，并推算出这件事发生在哪天——
// 因果链（远期因果 v3⑥）：昨天说想看某片 → 今天 TA 动态里真出现 → 聊天接得上 → 周记回响。
// 第一步地基：事件不只是「说话那天」发，而是「事发生那天」发（约了周五去看，周五动态写"刚看完"）。
//
// 只认客观计划，不瞎猜：
// - 必须同时有「意图词」（想/约/看/吃/去…）+「时间词」（今晚/明天/周五/周末/下周三/X号…）才算
// - 只有意图没时间（"好想看那个电影啊"）→ 不算（没约日子，无从因果）
// - 只有时间没意图（"明天要加班"）→ 不算（不是共同计划）
// - 别把「回忆过去」（昨天看了/上周去的）当未来计划 → 时间词限今天起算

export type FutureKind = 'watch' | 'eat' | 'go' | 'other'

export interface FutureIntent {
  /** 类型：看电影/剧/演出类、吃饭类、出门/去某地类、其他约定 */
  kind: FutureKind
  /** 距离今天的偏移天数（0=今天内（待会/今晚），1=明天，7=下周五……）；算不出具体日子时给 null */
  dayOffset: number | null
  /** 意图原文（"去看电影""吃火锅""去爬山"），供生成动态时引用 */
  intent: string
  /** 时间词原文（"明天""周五""下周三"……） */
  when: string
}

// ---- 意图识别：先认「完整动作短语」（自带对象），再认「动词+对象」松散结构 ----
// 完整短语命中即算（撸串/吃火锅/看电影本身就是完整计划）；
// 松散结构要求 动词(看/吃/去) 之后不远出现对象词，避免"明天去公司/明天要加班"误伤。
const WATCH_FULL_RE = /(看电影|看(?:部|个|场)?电影|看(?:部|个)?片子?|看展|看演唱会|看演出|看比赛|刷(?:部|个)?剧|追(?:部|个)?剧|追番|看球)/i
const WATCH_STRUCT_RE = /(想看|想去看|要去看|约好看|一起看|陪我看|去看|打算看|准备看).{0,8}(电影|片子?|剧|展|演唱会|演出|动漫|番|球赛|比赛)/i
const EAT_FULL_RE = /(撸串|吃火锅|烧烤|小龙虾|吃日料|吃烤鱼|吃面|约饭|干饭|喝奶茶|喝咖啡|吃大餐|吃顿好的|恰饭)/i
const EAT_STRUCT_RE = /(想吃|要去吃|去吃|约好(?:了)?吃|一起(?:去)?吃|喝|吃).{0,8}(饭|火锅|烤(?:肉|串|鱼)|串|餐|面|粉|小龙虾|烧烤|奶茶|咖啡|日料|川菜|甜品)/i
const GO_FULL_RE = /(去爬山|去逛公园|去游乐园|去海边|去露营|去郊游|去唱歌|去桌游|去旅行|去旅游|去玩|去逛街|去散步|去跑步|去健身|去游泳|出门玩)/i
const GO_STRUCT_RE = /(想去|要不要去|要(?:不)?去|打算去|准备去|约好(?:了)?|约了|一起去|说好(?:了)?|答应(?:了)?去).{0,8}(爬山|玩|逛|公园|游乐园|海边|露营|郊游|唱歌|桌游|旅行|看|走走|转转|出门)/i
const PLAN_RE = /(约好|约了|说好|说定了|定了|安排|计划|答应|说好了|约好了)/i

/** 认意图类型：返回 { kind, intent } 或 null */
function detectKind(text: string): { kind: FutureKind; intent: string } | null {
  const t = String(text ?? '')
  const take = (kind: FutureKind, m: RegExpMatchArray): { kind: FutureKind; intent: string } => {
    const raw = (m[0] ?? '').replace(/[，。！？!?,、~～\s]+/g, '')
    return { kind, intent: raw.length > 12 ? `${raw.slice(0, 12)}…` : raw }
  }
  for (const [kind, re] of [
    ['watch', WATCH_FULL_RE],
    ['eat', EAT_FULL_RE],
    ['go', GO_FULL_RE],
    ['watch', WATCH_STRUCT_RE],
    ['eat', EAT_STRUCT_RE],
    ['go', GO_STRUCT_RE],
  ] as const) {
    const m = t.match(re)
    if (m) return take(kind as FutureKind, m)
  }
  if (PLAN_RE.test(t)) return { kind: 'other', intent: t.replace(/[，。！？!?,、~～\s]+/g, '').slice(0, 12) }
  return null
}

// ---- 时间词 → 今天起算的 dayOffset（周几按本地时区）----
const WEEKDAY: Record<string, number> = { 一: 1, 二: 2, 三: 3, 四: 4, 五: 5, 六: 6, 日: 0, 天: 0 }

/** 本地自然日零点 */
function dayStart(ts: number): number {
  const d = new Date(ts)
  d.setHours(0, 0, 0, 0)
  return d.getTime()
}

/** 认时间 → 距今天偏移；认不出返回 null */
function detectWhen(text: string, now: Date): { when: string; dayOffset: number | null } | null {
  const t = String(text ?? '')
  const n = now instanceof Date ? now : new Date()
  const nowW = n.getDay()

  // 1) 具体日期：X月X日 / X号
  let m = t.match(/(\d{1,2})月(\d{1,2})日|(\d{1,2})号/)
  if (m) {
    let month: number
    let day: number
    if (m[1]) {
      month = Number(m[1])
      day = Number(m[2])
    } else {
      month = n.getMonth() + 1
      day = Number(m[3])
      if (day < n.getDate()) month += 1 // "30号"月中说=下月
    }
    if (month > 12) return null
    const target = new Date(n.getFullYear(), month - 1, day)
    const diff = Math.round((dayStart(target.getTime()) - dayStart(n.getTime())) / 86400000)
    return { when: m[0], dayOffset: diff >= 0 && diff <= 60 ? diff : null }
  }

  // 2) 明天/后天/大后天（含 明晚/今晚 等今天内）
  m = t.match(/大后天|大大后天|后天|明天|明晚/)
  if (m) {
    const w = m[0]
    const off = w.includes('大后天') ? 3 : w.includes('后天') ? 2 : 1
    return { when: w, dayOffset: off }
  }
  m = t.match(/今晚|今天晚上|待会|等会儿|一会儿|马上|现在|这会儿/)
  if (m) return { when: m[0], dayOffset: 0 }

  // 3) 星期几：周X/这周X/下(个)周X/星期X/礼拜X
  m = t.match(/((?:这|本)周|周)([一二三四五六日天])|(下(?:个)?周)([一二三四五六日天])|(星期|礼拜)([一二三四五六日天])/)
  if (m) {
    let target: number | null = null
    let base = 0 // 0=本周 1=下周
    if (m[2]) {
      target = WEEKDAY[m[2]] ?? null
      base = m[1] && m[1].includes('这') ? 0 : m[1] === '周' ? 0 : 0 // 周X / 这周X 都算本周
    } else if (m[4]) {
      target = WEEKDAY[m[4]] ?? null
      base = 1
    } else if (m[6]) {
      target = WEEKDAY[m[6]] ?? null
      base = 0
    }
    if (target != null) {
      let diff = target - nowW
      if (base === 1) diff += 7
      else if (diff <= 0) diff += 7 // 本周已过 → 顺延下周（周四说"周三去看"=下周三）
      return { when: m[0], dayOffset: diff >= 0 && diff <= 14 ? diff : null }
    }
  }
  // 4) 周末：这/本周末=最近的周六；下周末=下一周周六
  m = t.match(/下(?:个)?周末|(?:这|本)?周末|周末/)
  if (m) {
    const w = m[0]
    let sat = 6 - nowW
    if (sat <= 0) sat += 7
    if (w.startsWith('下')) sat += 7
    return { when: w, dayOffset: sat <= 14 ? sat : null }
  }

  // 5) 下周（无星期）
  m = t.match(/下(?:个)?周(?!末)|下个礼拜|下礼拜/)
  if (m) return { when: m[0], dayOffset: 7 }

  return null
}

/**
 * 主入口：从一句话里认「未来共同计划」。
 * @returns 认不出/不是计划 → null
 */
export function parseFutureIntent(text: string, now: Date = new Date()): FutureIntent | null {
  const t = String(text ?? '').trim()
  if (!t) return null
  const kindHit = detectKind(t)
  if (!kindHit) return null
  const whenHit = detectWhen(t, now)
  if (!whenHit) return null
  return {
    kind: kindHit.kind,
    intent: kindHit.intent,
    when: whenHit.when,
    dayOffset: whenHit.dayOffset,
  }
}

/** 未来计划对应的自然日 key（YYYY-MM-DD）；dayOffset null 时（今天内）也给今天 key */
export function futureDayKey(intent: FutureIntent, now: Date = new Date()): string {
  const d = new Date(now.getTime())
  const off = intent.dayOffset ?? 0
  d.setDate(d.getDate() + off)
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${d.getFullYear()}-${m}-${day}`
}
