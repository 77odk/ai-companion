// TA 空间动态 → 聊天注入（TASK-SPACE-CHAT）
// 让 TA 聊天时知道自己发过什么（被问"是你发动态那家店吗"有真凭据），
// 并补一个中性的"生活基线"事实锚（人设没写生活信息时，TA 说"在洗碗/翻书"才有根）。
// 纯逻辑零依赖（只 import 类型），方便被 Node 脚本直接跑单测。
import type { SpacePost } from './aiSpaceCore.ts'
import type { Lang } from './langDetect.ts'
/** 单条动态的评论互动摘要：让 TA 知道"对方留言了、自己回没回"（TASK-SPACE-CHAT #4） */
function formatComments(post: SpacePost, lang: Lang = 'zh'): string {
  const cs = Array.isArray(post.comments) ? post.comments : []
  if (cs.length === 0) return ''
  const parts: string[] = []
  const isEn = lang === 'en'
  // 对方（用户）的留言 + TA 对应的回复（replyTo 指向那条用户评论）
  for (const uc of cs) {
    if (uc.from !== 'user') continue
    const reply = cs.find((c) => c.from === 'ta' && c.replyTo === uc.id)
    if (isEn) {
      parts.push(reply ? `They commented "${uc.text}", you replied "${reply.text}"` : `They commented "${uc.text}", you haven't replied yet`)
    } else {
      parts.push(reply ? `对方留言「${uc.text}」，你回了「${reply.text}」` : `对方留言「${uc.text}」，你还没回`)
    }
  }
  // TA 主动发的不归属任何留言的回复（理论上少见，也带上）
  for (const tc of cs) {
    if (tc.from === 'ta' && !tc.replyTo) {
      parts.push(isEn ? `You added "${tc.text}" under this post` : `你在这条下补了一句「${tc.text}」`)
    }
  }
  return parts.length > 0 ? (isEn ? `\n    Interactions: ${parts.join('; ')}` : `\n    互动：${parts.join('；')}`) : ''
}
/**
 * 把最近动态（含评论互动）格式化成聊天注入块：只取 text + 评论，逐条成行（列表已最新在前）。
 * 返回空串 = 没动态可注入，调用方据此跳过，不占上下文。
 * 框架文字按 lang 翻译，动态正文不翻译（TA 自己写的内容原样用）。
 */
export function buildSpacePostsBlock(posts: SpacePost[], limit = 5, lang: Lang = 'zh'): string {
  const list = (Array.isArray(posts) ? posts : []).slice(0, limit)
  const lines = list
    .map((p) => {
      if (!p || typeof p.text !== 'string') return ''
      const t = p.text.trim()
      if (!t) return ''
      return '- ' + t + formatComments(p, lang)
    })
    .filter(Boolean)
  if (lines.length === 0) return ''
  if (lang === 'en') {
    return (
      'Your recent posts:\n' +
      lines.join('\n') +
      '\nThese are life posts you wrote yourself. When they bring one up, respond based on what actually happened — don\'t treat them as things happening right now.'
    )
  }
  return (
    '你最近发过的动态：\n' +
    lines.join('\n') +
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
/** 中性生活基线 EN 版 */
export const LIFE_BASELINE_EN =
  'You have your own life in this city: you usually cook for yourself, enjoy reading and taking walks, and have your own daily rhythm and small moments. When they ask about your life, speak naturally from this — don\'t make up jobs or identities that aren\'t in your persona.'
