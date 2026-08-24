// 会话状态 + 乐观缓存（B2c-1）
// localStorage 只做页面缓存，后端是权威数据源。聊天「发送即显示」：本地缓存先写 → 异步上传后端，
// 上传失败进 pendingOps 队列，联网自动补传。消息缓存按会话分 key，切换会话互不干扰。
// 纯逻辑都抽成可被 Node 单测的导出函数；localStorage 读写只在函数内，导入不触发。

import { notifyDataChanged } from './dataChange.ts'
import { postMessage, postMemory, type Session } from './sessionApi.ts'
import type { StoredMessage } from './storage.ts'

const ACTIVE_SESSION_KEY = 'ai_companion_active_session_id'
const SESSIONS_CACHE_KEY = 'ai_companion_sessions_cache'
const PENDING_OPS_KEY = 'ai_companion_pending_ops'
const msgsKey = (sessionId: string) => `ai_companion_msgs_${sessionId}`

/** 待补传操作：上传失败先落队列，联网后按序重试 */
export interface PendingOp {
  id: string
  type: 'message' | 'memory'
  sessionId: string
  /** 上传用的载荷：message = {role, content}，memory = {content} */
  payload: Record<string, unknown>
  /** 本地写入时的时间戳（消息按这个 ts 跟缓存里的乐观条目对上号） */
  ts: number
}

// ---- 当前会话 ----

/** 当前会话 id（localStorage 存字符串；没选过返回空串） */
export function getActiveSessionId(): string {
  try {
    return localStorage.getItem(ACTIVE_SESSION_KEY) ?? ''
  } catch {
    return ''
  }
}

/** 设置当前会话 id（空串 = 清掉） */
export function setActiveSessionId(id: string): void {
  try {
    if (id) localStorage.setItem(ACTIVE_SESSION_KEY, String(id))
    else localStorage.removeItem(ACTIVE_SESSION_KEY)
  } catch {
    // 存不下不影响功能
  }
}

// ---- 会话列表缓存 ----

export function getSessionsCache(): Session[] {
  try {
    const raw = localStorage.getItem(SESSIONS_CACHE_KEY)
    if (!raw) return []
    const arr = JSON.parse(raw)
    return Array.isArray(arr) ? (arr as Session[]) : []
  } catch {
    return []
  }
}

/** 会话列表拉取后落缓存（列表不含消息/记忆） */
export function setSessionsCache(list: Session[]): void {
  try {
    localStorage.setItem(SESSIONS_CACHE_KEY, JSON.stringify(Array.isArray(list) ? list : []))
  } catch {
    // 存不下不影响功能
  }
}

// ---- 消息乐观缓存（key 带 sessionId，各会话独立） ----

export function getMessagesCache(sessionId: string): StoredMessage[] {
  try {
    const raw = localStorage.getItem(msgsKey(sessionId))
    if (!raw) return []
    const arr = JSON.parse(raw)
    if (!Array.isArray(arr)) return []
    return arr.filter(
      (m): m is StoredMessage =>
        m != null &&
        (m.role === 'user' || m.role === 'assistant') &&
        typeof m.content === 'string' &&
        typeof m.ts === 'number',
    )
  } catch {
    return []
  }
}

/** 写入某会话的消息缓存，写后广播 dataChange（账号同步监听到会防抖上传，网络失败静默） */
export function saveMessagesCache(sessionId: string, msgs: StoredMessage[]): void {
  try {
    localStorage.setItem(msgsKey(sessionId), JSON.stringify(Array.isArray(msgs) ? msgs : []))
  } catch {
    // 存不下（localStorage 满）不弹窗不打断，聊天照常
  }
  notifyDataChanged()
}

/** 删除会话时同步清该会话的消息缓存 */
export function clearMessagesCache(sessionId: string): void {
  try {
    localStorage.removeItem(msgsKey(sessionId))
  } catch {
    // ignore
  }
}

// ---- pendingSync 队列（上传失败的本地暂存，联网重试） ----

export function getPendingOps(): PendingOp[] {
  try {
    const raw = localStorage.getItem(PENDING_OPS_KEY)
    if (!raw) return []
    const arr = JSON.parse(raw)
    if (!Array.isArray(arr)) return []
    return arr.filter(
      (op): op is PendingOp =>
        op != null &&
        typeof op.id === 'string' &&
        (op.type === 'message' || op.type === 'memory') &&
        typeof op.sessionId === 'string' &&
        op.payload != null &&
        typeof op.payload === 'object' &&
        typeof op.ts === 'number',
    )
  } catch {
    return []
  }
}

export function addPendingOp(op: PendingOp): void {
  try {
    localStorage.setItem(PENDING_OPS_KEY, JSON.stringify([...getPendingOps(), op]))
  } catch {
    // 队列存不下：这条会丢，但聊天记录本身在缓存里还在
  }
}

export function removePendingOp(id: string): void {
  try {
    localStorage.setItem(PENDING_OPS_KEY, JSON.stringify(getPendingOps().filter((op) => op.id !== id)))
  } catch {
    // ignore
  }
}

/** 生成队列条目 id（浏览器用 crypto.randomUUID，Node 测试环境走兜底） */
export function newPendingOpId(): string {
  try {
    if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') return crypto.randomUUID()
  } catch {
    // 走兜底
  }
  return `op_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`
}

// ---- 消息合并（纯函数，可单测） ----

/**
 * 本地缓存与后端消息合并：按 ts 去重，同一 ts 以云端（后端权威）为准；合并后按 ts 升序。
 * 与 sync.ts 的 mergeMessages 思路一致（输入顺序不影响结果），但这里后端优先（权威数据源）。
 */
export function mergeSessionMessages(local: StoredMessage[], cloud: StoredMessage[]): StoredMessage[] {
  const map = new Map<number, StoredMessage>()
  for (const m of [...(local ?? []), ...(cloud ?? [])]) {
    if (m == null || typeof m.ts !== 'number' || Number.isNaN(m.ts)) continue
    map.set(m.ts, m)
  }
  return [...map.values()].sort((a, b) => a.ts - b.ts)
}

// ---- 上传成功后的本地对账 ----

/**
 * 某条消息上传后端成功后，把缓存里对应的乐观条目（本地 ts）替换成服务端版本（ts = createdAt）。
 * 避免下次「本地缓存 + 后端消息」合并时同一条消息因为 ts 不同出现两条。
 */
export function confirmMessageInCache(
  sessionId: string,
  op: PendingOp,
  serverMsg: { role: 'user' | 'assistant'; content: string; createdAt: string },
): void {
  const list = getMessagesCache(sessionId)
  const idx = list.findIndex((m) => m.ts === op.ts && m.role === op.payload.role)
  if (idx < 0) return
  const ts = Date.parse(serverMsg.createdAt)
  if (!Number.isFinite(ts)) return
  list[idx] = { role: serverMsg.role, content: serverMsg.content, ts }
  saveMessagesCache(sessionId, list)
}

// ---- 补传 pending 队列（联网自动补传，Chat 挂载 / window online 时调用） ----

/** 依次重试队列里的上传；成功移除，网络失败留在队列下次再试，401 则停（已登出） */
export async function flushPendingOps(token: string): Promise<void> {
  for (const op of getPendingOps()) {
    if (op.type === 'message') {
      const res = await postMessage(token, op.sessionId, {
        role: op.payload.role as 'user' | 'assistant',
        content: String(op.payload.content ?? ''),
      })
      if (res.ok) {
        removePendingOp(op.id)
        confirmMessageInCache(op.sessionId, op, res.data)
      } else if (res.status === 401) {
        return // 登录已失效，sessionApi 已广播，剩下的等重新登录后再补
      }
    } else if (op.type === 'memory') {
      const res = await postMemory(token, op.sessionId, { content: String(op.payload.content ?? '') })
      if (res.ok) {
        removePendingOp(op.id)
      } else if (res.status === 401) {
        return
      }
    }
  }
}
