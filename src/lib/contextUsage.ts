/**
 * 上下文总量口径：当前会话「所有内容」的 token 总量（对齐 provider / 后台的 content 统计）。
 *
 * 为什么要单独一层：
 * - 胶囊原先把「本轮请求的 promptTokens + 本轮输出」当成上下文总量，于是数字永远≈本轮输入，
 *   看起来像「只算了一轮」。
 * - 本地估算（estimateToken，按中文字数加权）与服务商真实分词之间差着数倍，两套口径交替出现，
 *   数字就会忽大忽小。
 *
 * 这一层的做法：
 * - 总量 = 会话全部消息 content 的估算之和 × 校准系数；
 * - 校准系数由服务商真实 usage 反推（真实 promptTokens ÷ 同段内容的本地估算），指数平滑，逐步逼近真实分词；
 * - 系数只在本机保存，不影响请求与预算判断（预算仍走 composeContext 的估算）。
 */
import type { StoredMessage } from './storage.ts'
import { estimateToken } from './token.ts'

const FACTOR_KEY = 'ai_companion_context_factor'

/** 本地估算按中文 1.5 token/字，DeepSeek 真实分词约 0.35 token/字 → 初值取实测比值，随后靠 usage 收敛。 */
const DEFAULT_FACTOR = 0.24
const MIN_FACTOR = 0.1
const MAX_FACTOR = 1.5
/** 平滑权重：新观测占三成，避免单轮波动把系数带偏。 */
const SMOOTH = 0.3

export function loadContextFactor(): number {
  try {
    const raw = localStorage.getItem(FACTOR_KEY)
    const v = raw == null ? Number.NaN : Number(raw)
    if (!Number.isFinite(v) || v <= 0) return DEFAULT_FACTOR
    return Math.min(MAX_FACTOR, Math.max(MIN_FACTOR, v))
  } catch {
    return DEFAULT_FACTOR
  }
}

export function saveContextFactor(factor: number): void {
  try {
    if (!Number.isFinite(factor) || factor <= 0) return
    const clamped = Math.min(MAX_FACTOR, Math.max(MIN_FACTOR, factor))
    localStorage.setItem(FACTOR_KEY, String(clamped))
  } catch {
    /* 本地存储不可用时忽略，下次仍用默认系数 */
  }
}

/** 纯函数：给定消息列表与系数，算 provider 口径的 content token 总量。 */
export function contentTokensOf(messages: StoredMessage[], factor: number): number {
  let sum = 0
  for (const m of messages) {
    if (!m || typeof m.content !== 'string') continue
    sum += estimateToken(m.content)
  }
  return Math.round(sum * factor)
}

/** 用一轮真实 usage 反推系数（realPromptTokens ÷ 同段本地估算），并做平滑。 */
export function calibrateContextFactor(
  current: number,
  estimatedTokens: number,
  realPromptTokens: number,
): number {
  if (!Number.isFinite(estimatedTokens) || estimatedTokens <= 0) return current
  if (!Number.isFinite(realPromptTokens) || realPromptTokens <= 0) return current
  const observed = realPromptTokens / estimatedTokens
  if (!Number.isFinite(observed) || observed < MIN_FACTOR || observed > MAX_FACTOR) return current
  return Math.min(MAX_FACTOR, Math.max(MIN_FACTOR, current * (1 - SMOOTH) + observed * SMOOTH))
}
