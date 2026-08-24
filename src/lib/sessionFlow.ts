// 会话流程纯逻辑（B2c-2 / B3）
// 登录后分流 / 挑最近会话 / 选角色页用途标记 / 删会话后选下一个 / 会话标题摘要，都是纯函数，Node 可直接单测。
// App.tsx 用它做「登录用户打开 → 有会话进聊天 / 无会话进选角色」的分流，RolePicker 用它区分「换个 TA」的两种去向。

import type { Session } from './sessionApi.ts'
import { ROLE_TEMPLATES } from './personaTemplates.ts'

/** 选角色页用途：first=首次/游客选角色新建；current=换个TA·当前会话换人设；new=换个TA·开新会话换TA */
export type RolePickMode = 'first' | 'current' | 'new'

/** 会话标题摘要：自定义人设取第一行内容（剥掉「角色昵称：」等前缀），超长截前 8 字；空则空串 */
export function sessionTitleFromPersona(persona: string): string {
  const p = (persona ?? '').trim()
  if (!p) return ''
  const firstLine = p
    .split('\n')
    .map((l) => l.trim())
    .find((l) => l !== '') ?? ''
  const cleaned = firstLine.replace(/^(角色昵称|性格特质|关系背景|初次见面开场白)：/, '').trim()
  const title = cleaned || p
  return title.length > 8 ? `${title.slice(0, 8)}…` : title
}

/** 新建会话的标题：模板用模板名，自定义用人设摘要；空则默认「新会话」 */
export function resolveSessionTitle(selected: string | null, persona: string): string {
  if (selected && selected !== 'custom') {
    const t = ROLE_TEMPLATES.find((x) => x.id === selected)
    if (t?.name) return t.name
  }
  return sessionTitleFromPersona(persona) || '新会话'
}

/** 删除会话后选下一个：剩余 >0 取最近，无则返回 null（调用方进选角色页新建） */
export function pickNextSessionAfterDelete(sessions: Session[], deletedId: string | number): Session | null {
  const rest = (Array.isArray(sessions) ? sessions : []).filter((s) => String(s.id) !== String(deletedId))
  return pickMostRecentSession(rest)
}

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
