import { useCallback, useEffect, useState } from 'react'
import type { StoredMessage } from './storage'
import { loadMessages, loadPersona, saveMessages } from './storage'
import {
  addPendingOp,
  confirmMessageInCache,
  getActiveSessionId,
  getMessagesCache,
  markRead,
  newPendingOpId,
  removePendingOp,
  saveMessagesCache,
  type PendingOp,
} from './sessionStore'
import { getToken } from './auth'
import { enqueueSessionMessageCommit } from './sessionMessageQueue'
import { postMessage } from './sessionApi'
import { extractOpeningLine } from './customPersona'

/**
 * 第三组拆分：消息缓存与对账（第二轮拆分第 3 组）。
 * 只搬结构，不改逻辑：messages 状态及其读写、persistMessages、
 * uploadMessage 及其全部调用点、无会话首条 opening 消息装载。
 * 受保护链路（上传 / 合并 / 去重 / 聊天记录写入）原样搬移，语义一个字不动。
 * 失败重试相关状态（failedReplyRetryRef / setFailedReplyRetryAvailable / failedText）
 * 属于流式回复失败域，被 engine / ChatReplyError / send 跨组共享，留在 Chat.tsx，本组不搬。
 */
export function useChatMessages(options: { activeSessionId: string | null }) {
  const { activeSessionId } = options

  const [messages, setMessages] = useState<StoredMessage[]>(() =>
    activeSessionId ? getMessagesCache(activeSessionId) : loadMessages(),
  )

  const persistMessages = useCallback((sid: string | null, msgs: StoredMessage[]) => {
    if (sid) {
      saveMessagesCache(sid, msgs)
      // 数据 owner 由 sid 决定；“已读”只属于此刻仍在看的会话。
      if (sid === getActiveSessionId()) markRead(sid)
    } else {
      saveMessages(msgs)
    }
  }, [])

  const uploadMessage = useCallback((
    sid: string | null,
    msg: StoredMessage,
    onConfirmed?: (confirmed: { id: number; ts: number }) => void,
  ): Promise<void> => {
    const token = getToken()
    if (!sid || !token) return Promise.resolve()
    const op: PendingOp = {
      id: newPendingOpId(),
      type: 'message',
      sessionId: sid,
      ...(msg.conversationBranchId ? { conversationBranchId: msg.conversationBranchId } : {}),
      payload: { role: msg.role, content: msg.content, thinking: msg.thinking ?? '' },
      ts: msg.ts,
    }
    addPendingOp(op)
    return enqueueSessionMessageCommit(sid, () =>
      postMessage(token, sid, { role: msg.role, content: msg.content, thinking: msg.thinking }),
    ).then((res) => {
      if (!res.ok) return
      removePendingOp(op.id)
      confirmMessageInCache(sid, op, res.data)
      const confirmedTs = Date.parse(res.data.createdAt)
      if (Number.isFinite(confirmedTs)) onConfirmed?.({ id: res.data.id, ts: confirmedTs })
    })
  }, [])

  // 无有效 session 时：首条 opening 消息装载（global 模式）。原代码行为原样搬移，依赖数组保持原样。
  useEffect(() => {
    if (activeSessionId) return
    const existing = loadMessages()
    if (existing.length > 0) return
    const opening = extractOpeningLine(loadPersona())
    if (!opening) return
    const firstMsg: StoredMessage = { role: 'assistant', content: opening, ts: Date.now() }
    const next = [...existing, firstMsg]
    saveMessages(next)
    setMessages(next)
  }, [activeSessionId])

  return { messages, setMessages, persistMessages, uploadMessage }
}
