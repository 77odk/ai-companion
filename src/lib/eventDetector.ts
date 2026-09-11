// Event 识别（E2）：粗筛 → 额度 → LLM 精判 → 硬过滤 → createEvent
// 2026-09-11。成本控制：只有「共同主体 + 已发生动作」双命中的候选才消耗额度精判；
// 明显未来/不确定表达先于一切直接 false（不耗额度）；每 session + 设备本地日期每天最多 3 次精判；
// 模型返回严格 JSON，一次调用记一次额度（不管 true/false）；解析失败不创建不重试；无 key 静默跳过。
import { createEvent, EVENT_TYPES } from './eventStore.ts'
import { loadSettings } from './storage.ts'
import { chatCompletion } from './modelChat.ts'

/** 精判额度：每个会话 + 设备本地日期，每天最多 3 次 */
export const EVENT_JUDGE_LIMIT = 3

/** 硬过滤：confidence 阈值（模型返回后必过） */
export const EVENT_CONFIDENCE_THRESHOLD = 0.75

const JUDGE_QUOTA_KEY = 'ai_companion_event_judge'

// ---- 负向过滤（先于一切，不耗额度） ----

// 明显未来表达：以后/计划/愿望/假设
const NEGATIVE_FUTURE_RE =
  /以后(?:我们|一起)|下周(?:我们|一起)?|周五我们|周末我们|好想一起|想和你|如果(?:以后|有机会)|有机会一起|打算|准备(?:和|跟)?你|要和你|希望(?:我们|以后)|等(?:我们|你)|改天(?:我们|一起)|下次我们/
// 不确定表达：猜测/不确定回忆
const NEGATIVE_UNCERTAIN_RE = /应该(?:是)?(?:我们|一起)?去过|可能(?:是)?(?:我们)?一起|我记得我们好像|好像(?:是)?我们|不确定(?:是不是)?我们|我们(?:好像|似乎)/

/** 负向过滤：未来/不确定表达直接 false（不消耗额度） */
export function isNegativeExpression(text: string): boolean {
  const t = typeof text === 'string' ? text.trim() : ''
  if (!t) return true
  return NEGATIVE_FUTURE_RE.test(t) || NEGATIVE_UNCERTAIN_RE.test(t)
}

// ---- 粗筛（成本控制核心：主体 + 已发生动作 双命中才算候选） ----

/** 共同主体词（至少一个） */
const SUBJECT_RE = /我们|一起|我们俩|你和我|咱们|跟你|和你|和TA|和 TA/
/** 已发生动作词（至少一个；现在时/将来时的「去看/去吃」不算） */
const ACTION_RE = /去了|去过|吃了|看了|见了|到了|回来|完成了|一起做了|一起玩了|一起看了/

/** 加分项：时间词 / 关系词（只作加分，单独出现不算候选） */
export const TIME_BONUS_RE = /今天|昨天|刚刚|刚才|上周|前几天|那天|周末/
export const RELATION_BONUS_RE = /第一次|终于|约好了|说定了|和好了|见面了|旅行回来/

/** 粗筛：必须同时命中「共同主体」和「已发生动作」 */
export function coarsePass(text: string): boolean {
  const t = typeof text === 'string' ? text.trim() : ''
  if (!t) return false
  return SUBJECT_RE.test(t) && ACTION_RE.test(t)
}

// ---- 额度（每 session + 设备本地日期，每天最多 3 次） ----

/** 设备本地日期 key（YYYY-MM-DD） */
export function localDateKey(now: number): string {
  const d = new Date(now)
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const dd = String(d.getDate()).padStart(2, '0')
  return `${d.getFullYear()}-${m}-${dd}`
}

/** 额度 key：会话（空串 = 全局）+ 日期 */
export function judgeQuotaKey(sessionId: string | undefined, now: number): string {
  return `${sessionId?.trim() || '_global'}|${localDateKey(now)}`
}

function readQuotaMap(): Record<string, number> {
  try {
    const raw = localStorage.getItem(JUDGE_QUOTA_KEY)
    if (!raw) return {}
    const d = JSON.parse(raw)
    return d && typeof d === 'object' ? (d as Record<string, number>) : {}
  } catch {
    return {}
  }
}

function writeQuotaMap(map: Record<string, number>): void {
  try {
    localStorage.setItem(JUDGE_QUOTA_KEY, JSON.stringify(map))
  } catch {
    // 存不下不影响
  }
}

/** 已用额度（刷新页面不清零，按 key 累计） */
export function getJudgeQuotaUsed(sessionId: string | undefined, now: number): number {
  const map = readQuotaMap()
  return map[judgeQuotaKey(sessionId, now)] ?? 0
}

/** 消耗一次额度：已满返回 false（超限直接丢弃，不排队、不延后、不补跑） */
export function consumeJudgeQuota(sessionId: string | undefined, now: number): boolean {
  const key = judgeQuotaKey(sessionId, now)
  const map = readQuotaMap()
  const used = map[key] ?? 0
  if (used >= EVENT_JUDGE_LIMIT) return false
  map[key] = used + 1
  writeQuotaMap(map)
  return true
}

// ---- LLM 精判 ----

export interface EventJudgeResult {
  isEvent: boolean
  type?: string
  title?: string
  occurredAt?: string
  confidence?: number
  evidence?: string
}

/**
 * 精判系统提示词（硬规则）：不是总结记忆、不是推测历史；只判断文本里是否明确表达了
 * 「已发生、与当前 TA 共同经历、内容与时间可确定」的具体事件。
 */
export function buildEventJudgeSystemPrompt(now: number): string {
  const today = localDateKey(now)
  return (
    '你是忆文里的对话分析器。判断用户这句话里，是否明确表达了一件【已经发生】的、与当前 TA（对话对象）' +
    '【共同经历】的、内容与时间都【可确定】的具体事件。\n' +
    `今天是 ${today}。\n` +
    '规则（硬性）：\n' +
    '- 不是总结记忆、不是推测历史、不是根据上下文脑补；只看这一句话本身是否明确表达。\n' +
    '- 未来计划、愿望、假设、不确定的回忆、模型推测、用户单方面经历、普通长期事实、无法确定发生或时间的内容：一律 isEvent=false。\n' +
    '- 绝不根据记忆或计划推断事件。\n' +
    '- isEvent=true 时：type 只能从以下枚举选：' +
    EVENT_TYPES.join('/') +
    '（activity=日常一起做的事、meal=一起吃饭、trip=一起出行、celebration=庆祝/节日、milestone=第一次/里程碑）；' +
    'title 用一句 10-20 字的人话概括这件事；occurredAt 必须是绝对日期（YYYY-MM-DD 或 ISO 格式），不能写「今天/昨天」这种相对词；' +
    'confidence 是 0-1 的小数，表示你有多确定这是一件真实发生的共同经历。\n' +
    '只输出一个 JSON 对象，不要任何其他文字：{"isEvent":true/false,"type":"...","title":"...","occurredAt":"...","confidence":0.0,"evidence":"一句话依据"}'
  )
}

/** 从模型输出里提取 JSON 对象（容忍 ```json 包裹 / 前后废话） */
export function parseJudgeJson(raw: string): EventJudgeResult | null {
  if (typeof raw !== 'string' || !raw.trim()) return null
  let s = raw.trim()
  const fenced = s.match(/```(?:json)?\s*([\s\S]*?)```/)
  if (fenced) s = fenced[1].trim()
  const start = s.indexOf('{')
  const end = s.lastIndexOf('}')
  if (start < 0 || end <= start) return null
  try {
    const d = JSON.parse(s.slice(start, end + 1))
    if (d == null || typeof d !== 'object') return null
    return {
      isEvent: d.isEvent === true,
      type: typeof d.type === 'string' ? d.type : undefined,
      title: typeof d.title === 'string' ? d.title : undefined,
      occurredAt: typeof d.occurredAt === 'string' ? d.occurredAt : undefined,
      confidence:
        typeof d.confidence === 'number' && Number.isFinite(d.confidence) ? d.confidence : undefined,
      evidence: typeof d.evidence === 'string' ? d.evidence : undefined,
    }
  } catch {
    return null
  }
}

/** 解析模型给的日期字符串 → 时间戳；失败返回 null（now 参数保留兼容旧调用，未使用） */
export function parseOccurredAt(str: string | undefined, _now?: number): number | null {
  if (!str || typeof str !== 'string') return null
  const t = new Date(str).getTime()
  if (!Number.isFinite(t) || t <= 0) return null
  return t
}

/**
 * 硬过滤（模型返回后必过）：isEvent===true、type 合法、title 非空、
 * occurredAt 可解析且不晚于当前时间（未来直接拒）、confidence >= EVENT_CONFIDENCE_THRESHOLD。
 * 全过返回 createEvent 入参；任一不过返回 null。
 */
export function applyEventHardFilter(
  r: EventJudgeResult,
  sessionId: string | undefined,
  now: number,
): Parameters<typeof createEvent>[0] | null {
  if (!r || r.isEvent !== true) return null
  const title = (r.title ?? '').trim()
  if (!title) return null
  if (!EVENT_TYPES.includes(r.type as (typeof EVENT_TYPES)[number])) return null
  const occurredAt = parseOccurredAt(r.occurredAt, now)
  if (occurredAt == null || occurredAt > now) return null
  const confidence = r.confidence ?? 0
  if (!(confidence >= EVENT_CONFIDENCE_THRESHOLD)) return null
  return {
    sessionId,
    type: r.type as (typeof EVENT_TYPES)[number],
    title,
    occurredAt,
    confidence,
    source: 'chat',
  }
}

/**
 * 主流程（Chat 用户消息落库后调用；异步不阻塞、失败静默）：
 * 负向过滤 → 粗筛 → 额度 → 无 key 静默 → 精判（记额度）→ JSON 解析 → 硬过滤 → createEvent。
 */
export async function processEventCandidate(input: {
  sessionId?: string
  userText: string
  now?: number
}): Promise<void> {
  try {
    const now = input.now ?? Date.now()
    const text = (input.userText ?? '').trim()
    if (!text) return
    // 1 负向过滤（先于一切，不耗额度）
    if (isNegativeExpression(text)) return
    // 2 粗筛（主体 + 已发生动作 双命中才算候选）
    if (!coarsePass(text)) return
    // 3 额度：超限直接丢弃
    if (!consumeJudgeQuota(input.sessionId, now)) return
    // 4 无 key 静默跳过（不报错不提示）
    const settings = loadSettings()
    const hasKey = Boolean(settings.apiKey?.trim() && settings.baseUrl?.trim() && settings.model?.trim())
    if (!hasKey) return
    // 5 精判（一次调用记一次额度，不管返回 true 还是 false）
    const raw = await chatCompletion(
      settings,
      [
        { role: 'system', content: buildEventJudgeSystemPrompt(now) },
        { role: 'user', content: text },
      ],
      { maxTokens: 200, temperature: 0 },
    )
    const result = parseJudgeJson(raw)
    if (!result) return // JSON 解析失败 → 不创建，不重试
    // 6 硬过滤
    const input2 = applyEventHardFilter(result, input.sessionId, now)
    if (!input2) return
    createEvent(input2)
  } catch {
    // 失败静默：不打扰聊天
  }
}
