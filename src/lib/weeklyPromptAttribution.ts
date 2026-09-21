import { buildWeeklyPrompt, type WeeklyMessageLine, type WeeklyPromptContext } from './weeklyReview.ts'
import { buildAttributionLegend, formatAttributedLine } from './promptAttribution.ts'

export function formatAttributedWeeklyMessage(m: WeeklyMessageLine): string {
  const d = new Date(m.ts)
  const source = m.role === 'user' ? 'USER' : 'SELF'
  return `${d.getMonth() + 1}月${d.getDate()}日 ${formatAttributedLine(String(m.content ?? ''), source, 'zh')}`
}

/**
 * weeklyReview.ts 是受保护的数据/协议模块；在唯一调用出口把旧格式收敛到统一来源协议。
 * 所有转换只作用于本次 prompt，不改周记、聊天、记忆或 Event 原文。
 */
export function buildAttributedWeeklyPrompt(ctx: WeeklyPromptContext): string {
  const prompt = buildWeeklyPrompt({
    ...ctx,
    newMemories: (ctx.newMemories ?? []).map((text) => formatAttributedLine(text, 'USER', 'zh')),
    weekPosts: (ctx.weekPosts ?? []).map((text) => formatAttributedLine(text, 'SELF', 'zh')),
    weekAgenda: (ctx.weekAgenda ?? []).map((text) => formatAttributedLine(text, 'USER', 'zh')),
    weekEvents: (ctx.weekEvents ?? []).map((text) => formatAttributedLine(text, 'SHARED', 'zh', 'USER')),
    ...(ctx.lastReply?.trim() ? { lastReply: formatAttributedLine(ctx.lastReply, 'USER', 'zh') } : {}),
    ...(ctx.pendingReplies?.length
      ? { pendingReplies: ctx.pendingReplies.map((text) => formatAttributedLine(text, 'USER', 'zh')) }
      : {}),
  })

  return `${buildAttributionLegend('zh')}\n${prompt}`
    .replace('【本周聊天摘要】（「对方」= 收信的人；「我」= 写信的你自己）', '【本周聊天摘要】')
    .replace('【你自己发过的动态（是「我」发的，不是对方发的）】', '【SELF 本周发过的动态】')
    .replace(
      '这些是你（写信的人）这周自己发过的动态。写进信里时主语必须是「我」（例：我写过一句…），绝不能写成「你发了……」，那会把收信人当成发帖的人。只在动态确实写了时才提，别硬凑。',
      '这些内容来源于 SELF，只属于你自己；写进信里时用自己的口吻，绝不能归到 USER。只在动态确实写了时才提，别硬凑。',
    )
}
