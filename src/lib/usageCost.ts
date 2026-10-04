import type { ContextUsageTurn, Provider } from './storage.ts'

export type UsageCurrency = 'CNY' | 'USD'

export interface UsageCostEstimate {
  amount: number
  currency: UsageCurrency
  /** 所有金额都是按公开 token 单价估算，不等同服务商最终账单。 */
  estimated: true
  /** cache usage 缺失时按未命中输入价估，页面要明确说明。 */
  cacheKnown: boolean
}

interface TokenRate {
  currency: UsageCurrency
  input: number
  cached?: number
  output: number
}

function isOfficialHost(provider: Provider, host: string): boolean {
  const value = String(host ?? '').toLowerCase()
  if (!value) return false
  if (provider === 'deepseek') return value === 'api.deepseek.com'
  if (provider === 'openai') return value === 'api.openai.com'
  if (provider === 'volcengine') return value === 'ark.cn-beijing.volces.com'
  if (provider === 'zhipu') return value === 'open.bigmodel.cn'
  if (provider === 'mimo') return value === 'api.xiaomimimo.com'
  return false
}

const CHINA_PUBLIC_HOLIDAYS_2026 = new Set([
  '2026-01-01', '2026-01-02', '2026-01-03',
  '2026-02-15', '2026-02-16', '2026-02-17', '2026-02-18', '2026-02-19', '2026-02-20', '2026-02-21', '2026-02-22', '2026-02-23',
  '2026-04-04', '2026-04-05', '2026-04-06',
  '2026-05-01', '2026-05-02', '2026-05-03', '2026-05-04', '2026-05-05',
  '2026-06-19', '2026-06-20', '2026-06-21',
  '2026-09-25', '2026-09-26', '2026-09-27',
  '2026-10-01', '2026-10-02', '2026-10-03', '2026-10-04', '2026-10-05', '2026-10-06', '2026-10-07',
])

function utcDayKey(d: Date): string {
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`
}

function deepSeekFlashRate(createdAt: number): TokenRate | null {
  const d = new Date(createdAt)
  const day = d.getUTCDay()
  const hour = d.getUTCHours()
  const weekday = day >= 1 && day <= 5
  const inPeakWindow = weekday && ((hour >= 1 && hour < 4) || (hour >= 6 && hour < 10))
  if (!inPeakWindow) {
    return { currency: 'USD', input: 0.15, cached: 0.003, output: 0.6 }
  }

  // DeepSeek 官方规则：周一到周五两个 UTC 高峰窗收费更高，但中国法定节假日全日仍按闲时价。
  // 当前内置 2026 国务院节假日；未来年份的“高峰窗”若无法确认是否法定假日，宁可不估价。
  if (d.getUTCFullYear() !== 2026) return null
  if (CHINA_PUBLIC_HOLIDAYS_2026.has(utcDayKey(d))) {
    return { currency: 'USD', input: 0.15, cached: 0.003, output: 0.6 }
  }
  return { currency: 'USD', input: 0.3, cached: 0.006, output: 1.2 }
}

function rateForTurn(turn: ContextUsageTurn): TokenRate | null {
  if (!isOfficialHost(turn.provider, turn.baseUrlHost)) return null
  const model = turn.model.trim().toLowerCase()

  if (turn.provider === 'deepseek' && (
    model === 'deepseek-flash' ||
    model === 'deepseek-v4-flash' ||
    model === 'deepseek-v4-flash-vision-exp'
  )) {
    return deepSeekFlashRate(turn.createdAt)
  }

  if (turn.provider === 'openai' && model === 'gpt-4o') {
    return { currency: 'USD', input: 2.5, cached: 1.25, output: 10 }
  }
  if (turn.provider === 'openai' && model === 'gpt-4o-mini') {
    return { currency: 'USD', input: 0.15, cached: 0.075, output: 0.6 }
  }

  if (turn.provider === 'volcengine' && model.startsWith('doubao-seed-character')) {
    // 火山方舟标准在线推理，输入长度按本轮 prompt_tokens 分段。
    return turn.inputTokens <= 32_000
      ? { currency: 'CNY', input: 0.8, cached: 0.16, output: 2 }
      : { currency: 'CNY', input: 1.2, cached: 0.16, output: 6 }
  }
  if (turn.provider === 'volcengine' && model === 'glm-5.3-flash') {
    return { currency: 'CNY', input: 0.8, cached: 0.23, output: 2.8 }
  }

  // 智谱 / 小米 / 自定义中转的公开价格目前无法仅凭现有请求字段稳定还原，
  // 宁可显示未知，也不把其它平台价格套进来。
  return null
}

export function estimateUsageTurnCost(turn: ContextUsageTurn): UsageCostEstimate | null {
  const rate = rateForTurn(turn)
  if (!rate) return null
  if (!Number.isFinite(turn.inputTokens) || turn.inputTokens < 0) return null
  if (typeof turn.outputTokens !== 'number' || !Number.isFinite(turn.outputTokens) || turn.outputTokens < 0) {
    return null
  }

  const cacheKnown = typeof turn.cachedTokens === 'number' && Number.isFinite(turn.cachedTokens) && turn.cachedTokens >= 0
  const cached = cacheKnown ? Math.min(turn.inputTokens, turn.cachedTokens ?? 0) : 0
  const uncached = Math.max(0, turn.inputTokens - cached)
  const cachedRate = rate.cached ?? rate.input
  const amount = (
    uncached * rate.input +
    cached * cachedRate +
    turn.outputTokens * rate.output
  ) / 1_000_000

  return {
    amount,
    currency: rate.currency,
    estimated: true,
    cacheKnown,
  }
}

export interface UsageMoneyTotals {
  CNY: number
  USD: number
  unknownTurns: number
  cacheEstimatedTurns: number
}

export interface UsageDaySummary {
  key: string
  label: string
  inputTokens: number
  outputTokens: number
  turns: number
  cost: UsageMoneyTotals
}

export interface UsageSessionSummary {
  sessionId: string
  inputTokens: number
  outputTokens: number
  turns: number
  cost: UsageMoneyTotals
}

export interface UsageSummary {
  today: UsageDaySummary
  days: UsageDaySummary[]
  sessions: UsageSessionSummary[]
  totalTurns: number
  cacheHitRate: number | null
  cacheKnownInputTokens: number
  cacheUnknownTurns: number
}

function emptyMoney(): UsageMoneyTotals {
  return { CNY: 0, USD: 0, unknownTurns: 0, cacheEstimatedTurns: 0 }
}

function addTurnMoney(target: UsageMoneyTotals, turn: ContextUsageTurn): void {
  const estimate = estimateUsageTurnCost(turn)
  if (!estimate) {
    target.unknownTurns += 1
    return
  }
  target[estimate.currency] += estimate.amount
  if (!estimate.cacheKnown) target.cacheEstimatedTurns += 1
}

function localDayKey(ts: number): string {
  const d = new Date(ts)
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

function localDayLabel(ts: number): string {
  const d = new Date(ts)
  return `${d.getMonth() + 1}/${d.getDate()}`
}

function outputOf(turn: ContextUsageTurn): number {
  return typeof turn.outputTokens === 'number' && Number.isFinite(turn.outputTokens)
    ? Math.max(0, turn.outputTokens)
    : 0
}

function makeDay(ts: number): UsageDaySummary {
  return {
    key: localDayKey(ts),
    label: localDayLabel(ts),
    inputTokens: 0,
    outputTokens: 0,
    turns: 0,
    cost: emptyMoney(),
  }
}

export function summarizeUsageTurns(turns: ContextUsageTurn[], now = Date.now()): UsageSummary {
  const safe = (Array.isArray(turns) ? turns : [])
    .filter((turn) => Number.isFinite(turn.createdAt) && turn.createdAt > 0)
    .sort((a, b) => b.createdAt - a.createdAt)

  const days: UsageDaySummary[] = []
  const byDay = new Map<string, UsageDaySummary>()
  const today = new Date(now)
  today.setHours(12, 0, 0, 0)
  for (let offset = 6; offset >= 0; offset--) {
    const d = new Date(today)
    d.setDate(today.getDate() - offset)
    const day = makeDay(d.getTime())
    days.push(day)
    byDay.set(day.key, day)
  }

  const sessions = new Map<string, UsageSessionSummary>()
  let cacheKnownInputTokens = 0
  let cacheKnownTokens = 0
  let cacheUnknownTurns = 0

  for (const turn of safe) {
    const day = byDay.get(localDayKey(turn.createdAt))
    if (day) {
      day.inputTokens += turn.inputTokens
      day.outputTokens += outputOf(turn)
      day.turns += 1
      addTurnMoney(day.cost, turn)
    }

    const session = sessions.get(turn.sessionId) ?? {
      sessionId: turn.sessionId,
      inputTokens: 0,
      outputTokens: 0,
      turns: 0,
      cost: emptyMoney(),
    }
    session.inputTokens += turn.inputTokens
    session.outputTokens += outputOf(turn)
    session.turns += 1
    addTurnMoney(session.cost, turn)
    sessions.set(turn.sessionId, session)

    if (typeof turn.cachedTokens === 'number' && Number.isFinite(turn.cachedTokens) && turn.cachedTokens >= 0) {
      cacheKnownInputTokens += turn.inputTokens
      cacheKnownTokens += Math.min(turn.inputTokens, turn.cachedTokens)
    } else {
      cacheUnknownTurns += 1
    }
  }

  const todaySummary = byDay.get(localDayKey(now)) ?? makeDay(now)
  return {
    today: todaySummary,
    days,
    sessions: [...sessions.values()].sort(
      (a, b) => (b.inputTokens + b.outputTokens) - (a.inputTokens + a.outputTokens),
    ),
    totalTurns: safe.length,
    cacheHitRate: cacheKnownInputTokens > 0 ? cacheKnownTokens / cacheKnownInputTokens : null,
    cacheKnownInputTokens,
    cacheUnknownTurns,
  }
}

export function formatUsageTokens(tokens: number): string {
  const safe = Number.isFinite(tokens) ? Math.max(0, Math.round(tokens)) : 0
  if (safe >= 1_000_000) return `${(safe / 1_000_000).toFixed(safe >= 10_000_000 ? 1 : 2)}M`
  if (safe >= 1_000) return `${(safe / 1_000).toFixed(safe >= 100_000 ? 0 : 1)}k`
  return String(safe)
}

function moneyPart(symbol: string, amount: number): string {
  if (amount >= 1) return `${symbol}${amount.toFixed(2)}`
  if (amount >= 0.01) return `${symbol}${amount.toFixed(3)}`
  if (amount > 0) return `${symbol}${amount.toFixed(5)}`
  return `${symbol}0`
}

export function formatUsageMoney(cost: UsageMoneyTotals): string {
  const parts: string[] = []
  if (cost.CNY > 0) parts.push(moneyPart('¥', cost.CNY))
  if (cost.USD > 0) parts.push(moneyPart('$', cost.USD))
  if (parts.length === 0) return cost.unknownTurns > 0 ? '未知' : '¥0'
  return parts.join(' + ')
}
