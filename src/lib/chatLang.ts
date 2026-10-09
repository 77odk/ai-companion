// 聊天页 · 会话语言判定（拆分第 6 刀）
// 从 Chat.tsx 的 send 流程整段搬出：人设优先；人设空则看包含当前消息的最近 5 条用户消息，过半为中文即中文。
// 本文件是纯计算：不碰状态、不写存储（落库动作留在 Chat.tsx）。
import { detectLang, type Lang } from './langDetect'
import { messageEvidenceText } from './messageQuote'
import type { StoredMessage } from './storage'

export function resolveChatLang(input: {
  persona: string
  replayExistingUser: boolean
  roundVisibleMessages: StoredMessage[]
  text: string
}): Lang {
  const { persona, replayExistingUser, roundVisibleMessages, text } = input
const personaText = persona?.trim() || ''
let lang: Lang
if (personaText) {
  lang = detectLang(personaText)
} else {
  const recentUserMsgs = (replayExistingUser
    ? roundVisibleMessages.filter((m) => m.role === 'user').map((m) => messageEvidenceText(m.content))
    : [
        ...roundVisibleMessages.filter((m) => m.role === 'user').map((m) => messageEvidenceText(m.content)),
        text,
      ]
  ).slice(-5)
  const zhCount = recentUserMsgs.filter((m) => detectLang(m) === 'zh').length
  lang = zhCount > recentUserMsgs.length / 2 ? 'zh' : 'en'
}
  return lang
}
