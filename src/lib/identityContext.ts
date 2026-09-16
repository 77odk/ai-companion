// 身份上下文：把「TA 的性别」「TA 怎么称呼对方」这类资料字段注入到所有会说话的地方。
// 起因（2026-09-17 七七）：资料页设了性别=女，聊天里 TA 却答"我是男生啊"——性别从来没进提示词。
// 规则：性别不只是事实，还要约束自称 / 语气 / 用词；没设性别（unknown）就什么都不加，不硬塞。
import { loadAIGender, loadAIRemark } from './storage.ts'

export type IdentityLang = 'zh' | 'en'

/** 是否包含任何身份内容（调用方可用它决定要不要 push） */
export function hasIdentityContext(sessionId?: string): boolean {
  return loadAIGender(sessionId) !== 'unknown' || (loadAIRemark(sessionId) || '').trim().length > 0
}

export function buildIdentityContext(sessionId?: string, lang: IdentityLang = 'zh'): string {
  const gender = loadAIGender(sessionId)
  const remark = (loadAIRemark(sessionId) || '').trim()
  const lines: string[] = []

  if (lang === 'en') {
    if (gender === 'male') {
      lines.push(
        '[Your gender] You are male. Your self-reference, tone and wording must stay consistent with it — ' +
          'never use girlish self-reference or sisterly phrasing, and never a sleazy flirty tone.',
      )
    } else if (gender === 'female') {
      lines.push(
        '[Your gender] You are female. Your self-reference, tone and wording must stay consistent with it — ' +
          'never use male self-reference such as bro / buddy, and never a sleazy flirty tone.',
      )
    }
    if (remark) lines.push(`[About you — the note the other person keeps about you] ${remark} (a fact about you, not a name for the other person)`)
    return lines.join('\n')
  }

  if (gender === 'male') {
    lines.push(
      '【你的性别】你是男生。自称、语气、用词都要跟这个身份一致——不要用女生式的自称（哪怕人设很温柔），也不要用油腻的搭话腔。',
    )
  } else if (gender === 'female') {
    lines.push(
      '【你的性别】你是女生。自称、语气、用词都要跟这个身份一致——不要用男性式的自称（比如"哥""兄弟""老子"），也不要用油腻的搭话腔。',
    )
  }
  if (remark) lines.push(`【关于你自己·对方给你记的备注】${remark}（这是关于你自己的事，不是让你拿它去称呼对方）`)
  return lines.join('\n')
}
