// 生成中途关页面 / 切后台的兜底（2026-09-14 七七实测：生成到一半退出去，回来那条回复凭空消失）
//
// 背景：TA 的回复是流式生成的，只有 finalize（正常结束/报错）才会落库上传。
// 用户生成到一半就退出/关页面时，fetch 被浏览器掐断，finalize 永远跑不到 ——
// 半截回复既不在本地、也没排队上传，回来就是一片空白，看起来像「TA 没回」。
//
// 做法：关页面/切后台时把已经生成出来的那部分落库，并排进 pendingOps（同步写 localStorage，
// 不需要网络）；下次打开聊天页时的 flushPendingOps 会把它补传到后端。
import { loadMessages, saveMessages, type StoredMessage } from './storage.ts'
import { splitDetailedAssistantReply, type ReplyLength } from './replyLength.ts'
import {
  addPendingOp,
  getMessagesCache,
  newPendingOpId,
  saveMessagesCache,
  splitAssistantReplies,
} from './sessionStore.ts'

/**
 * 把半截回复提交落库（并把每条排进待上传队列）。
 * @param sessionId 当前会话；null = 游客/无会话，只本地落库不上传
 * @param ts 本轮 assistant 占位消息的 ts（同 ts 的旧内容会被替换，不重复堆）
 * @param cleanedText 已经清洗过的正文（stripThinkBlocks / stripMemoryMarkers / stripEmoji …）
 * @param queue 是否排进待上传队列。关页面（pagehide）要排；只是切到后台（visibilitychange hidden）
 *              不排 —— 那种情况流还在跑，等正常结束走原有上传，别把半截抢先传上去。
 * @returns 落库的 assistant 分条（没内容返回空数组，调用方据此判断是否真的提交了）
 */
export function commitPartialReply(
  sessionId: string | null,
  ts: number,
  cleanedText: string,
  queue = true,
  replyLength: ReplyLength = 'natural',
): StoredMessage[] {
  const parts = replyLength === 'long'
    ? splitDetailedAssistantReply(cleanedText, ts)
    : splitAssistantReplies(cleanedText, ts)
  if (!parts.length) return []
  const base = sessionId ? getMessagesCache(sessionId) : loadMessages()
  // 替换同 ts 的旧内容（占位空消息 / 之前落过的半截），不是追加
  const kept = base.filter((m) => !(m.role === 'assistant' && m.ts === ts))
  const merged = [...kept, ...parts].sort((a, b) => a.ts - b.ts)
  if (sessionId) saveMessagesCache(sessionId, merged)
  else saveMessages(merged)
  if (sessionId && queue) {
    for (const m of parts) {
      addPendingOp({
        id: newPendingOpId(),
        type: 'message',
        sessionId,
        payload: { role: m.role, content: m.content, thinking: m.thinking ?? '' },
        ts: m.ts,
      })
    }
  }
  return parts
}
