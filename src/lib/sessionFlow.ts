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

/**
 * 会话人物名（S1 微信备注式）：模板 → 模板默认角色名 charName；
 * 自定义表单填了 TA 昵称 → persona 里「角色昵称：xxx」行取 xxx；都没有 → 「TA」。
 * 用作新建会话的 title 与「TA 自称」的名字。
 */
export function resolveSessionName(persona: string, templateId?: string): string {
  // 模板会话：新建时能拿到模板 id 就用模板默认角色名
  if (templateId && templateId !== 'custom') {
    const t = ROLE_TEMPLATES.find((x) => x.id === templateId)
    if (t?.charName) return t.charName
  }
  // persona 含「角色昵称：xxx」行 → 取 xxx（自定义表单/高级编辑都能命中）
  const p = (persona ?? '').trim()
  if (p) {
    const m = p.match(/^\s*角色昵称：(.+)$/m)
    if (m && m[1].trim()) return m[1].trim()
  }
  // 都没有 → TA
  return 'TA'
}

/** 占位标题（旧会话默认名，不是角色名）：展示时从 persona 兜底解析出角色名 */
const PLACEHOLDER_TITLES = new Set(['新会话', '我们的开始'])

/**
 * 会话展示名：title 不是占位标题时直接用 title（改名后的名字也在这里生效）；
 * 占位标题（旧默认「新会话/我们的开始」）→ 从 persona 兜底解析角色名。
 */
export function displaySessionName(s: { title?: string; persona?: string }): string {
  const t = (s?.title ?? '').trim()
  if (t && !PLACEHOLDER_TITLES.has(t)) return t
  return resolveSessionName(s?.persona ?? '') || 'TA'
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

/** 登录后分流（微信式主页）：有会话 → roles（会话列表主页）；空 → role（选角色新建） */
export function decideLoginTarget(sessions: Session[]): 'roles' | 'role' {
  return Array.isArray(sessions) && sessions.length > 0 ? 'roles' : 'role'
}
