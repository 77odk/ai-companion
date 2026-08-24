// 会话流程纯逻辑（B2c-2）
// 登录后分流 / 挑最近会话 / 选角色页用途标记，都是纯函数，Node 可直接单测。
// App.tsx 用它做「登录用户打开 → 有会话进聊天 / 无会话进选角色」的分流，RolePicker 用它区分「换个 TA」的两种去向。

import type { Session } from './sessionApi.ts'

/** 选角色页用途：first=首次/游客选角色新建；current=换个TA·当前会话换人设；new=换个TA·开新会话换TA */
export type RolePickMode = 'first' | 'current' | 'new'

/** 会话时间戳：updatedAt 优先，缺省用 created_at；都解析失败返回 0（最旧） */
export function sessionTimestamp(s: Session): number {
  const updated = Date.parse(s.updatedAt)
  if (Number.isFinite(updated)) return updated
  const created = Date.parse(s.created_at)
  return Number.isFinite(created) ? created : 0
}

/** 挑最近会话：按会话时间戳取最新；空列表 / 非数组返回 null */
export function pickMostRecentSession(sessions: Session[]): Session | null {
  if (!Array.isArray(sessions) || sessions.length === 0) return null
  return sessions.reduce((best, s) => (sessionTimestamp(s) > sessionTimestamp(best) ? s : best))
}

/** 登录后分流：有会话 → chat；空 → role（选角色新建） */
export function decideLoginTarget(sessions: Session[]): 'chat' | 'role' {
  return Array.isArray(sessions) && sessions.length > 0 ? 'chat' : 'role'
}
