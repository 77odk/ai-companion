// TA 空间动态 → 聊天注入（TASK-SPACE-CHAT）
// 让 TA 聊天时知道自己发过什么（被问"是你发动态那家店吗"有真凭据），
// 并补一个中性的"生活基线"事实锚（人设没写生活信息时，TA 说"在洗碗/翻书"才有根）。
// 纯逻辑零依赖（只 import 类型），方便被 Node 脚本直接跑单测。

import type { SpacePost } from './aiSpaceCore.ts'

/**
 * 把最近动态格式化成聊天注入块：只取 text，逐条成行（列表已最新在前）。
 * 返回空串 = 没动态可注入，调用方据此跳过，不占上下文。
 */
export function buildSpacePostsBlock(posts: SpacePost[], limit = 5): string {
  const list = (Array.isArray(posts) ? posts : []).slice(0, limit)
  const lines = list
    .map((p) => (p && typeof p.text === 'string' ? p.text.trim() : ''))
    .filter(Boolean)
  if (lines.length === 0) return ''
  return (
    '你最近发过的动态：\n' +
    lines.map((t) => `- ${t}`).join('\n') +
    '\n这是你自己发过的生活记录，对方提起时照实接，别当成现在正在发生的事。'
  )
}

/**
 * 人设里是否已带生活锚点（职业/身份/工作/住处/日常习惯等）。
 * 命中 = 人设已经给了 TA 一个生活落点 → 不再补基线，避免注入与人设冲突的内容
 * （基线必须从人设长出来：人设写了"我是学生"就绝不注入"上班族"）。
 * 取保守策略：宁可少补、不可补错。
 */
export function personaHasLifeAnchors(persona: string): boolean {
  const t = String(persona ?? '').trim()
  if (!t) return false
  return /职业|工作|上班|学生|公司|学校|大学|住处|住在|小区|租房|开店|书店|经营|医生|老师|程序员|写手|作者|画师|设计师|上班族|画家|作家|做饭/.test(
    t,
  )
}

/**
 * 中性生活基线（事实锚，不是行为规则）：人设没写生活信息时补，
 * 给 TA"你是谁/你在哪/平时做什么"的根——TA 说"在洗碗/翻书"才有依据，
 * 不编造人设里没有的具体工作/身份。
 */
export const LIFE_BASELINE =
  '你在这个城市有自己的日子在过：平时自己做饭、喜欢看看书散散步，有自己的日常节奏和生活的小事。对方问起你的生活时，顺着这个自然说，别编出人设里没有的工作和身份。'
