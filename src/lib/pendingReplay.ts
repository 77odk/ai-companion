import { postMemory, postMessage } from './sessionApi.ts'
import {
  confirmMessageInCache,
  getPendingOps,
  removePendingOp,
  type PendingOp,
} from './sessionStore.ts'

/**
 * Recovery 只重放“开始恢复时已经存在”的 outbox 快照。
 * 等 session gate 的过程中新增的消息由它自己的正常 upload 负责，避免 recovery + normal 双 POST。
 * 不新增 storage，不改变 sessionStore / API；成功后的对账仍复用现有 confirmMessageInCache。
 */
export async function flushPendingOpsSnapshot(
  token: string,
  snapshot: PendingOp[],
): Promise<void> {
  for (const op of Array.isArray(snapshot) ? snapshot : []) {
    if (op.type === 'cloud-state') continue

    // 可能已被它自己的正常 upload 消费；只重放此刻仍在 outbox 的快照项。
    if (!getPendingOps().some((current) => current.id === op.id)) continue

    if (op.type === 'message') {
      const res = await postMessage(token, op.sessionId, {
        role: op.payload.role as 'user' | 'assistant',
        content: String(op.payload.content ?? ''),
      })
      if (res.ok) {
        removePendingOp(op.id)
        confirmMessageInCache(op.sessionId, op, res.data)
      } else if (res.status === 401) {
        return
      }
      continue
    }

    if (op.type === 'memory') {
      const res = await postMemory(token, op.sessionId, {
        content: String(op.payload.content ?? ''),
      })
      if (res.ok) {
        removePendingOp(op.id)
      } else if (res.status === 401) {
        return
      }
    }
  }
}
