// 当前角色资料解析（S1-2 我的 AI 角色化）
// 「我的 AI」页不再显示全局资料，而是当前会话角色的资料卡：
// 有 activeSessionId → 从会话列表找该会话，名字/人设都跟会话走；
// 无会话/会话未命中 → 兜底全局昵称/人设（过渡态）。
// 纯逻辑可单测：不碰 localStorage/网络，数据由调用方传入。

import type { Session } from './sessionApi.ts'
import { displaySessionName } from './sessionFlow.ts'

/** 按 id 找会话（字符串/数字兼容）；列表为空/id 为空/未命中返回 null */
export function findSessionById(sessions: Session[], id: string | number): Session | null {
  if (!Array.isArray(sessions) || !id) return null
  return sessions.find((s) => s != null && String(s.id) === String(id)) ?? null
}

/**
 * 取当前角色名：有会话 → 会话展示名（displaySessionName：模板名/自定义昵称/TA）；
 * 无会话/未命中 → 全局昵称兜底（loadAIProfile().nickname，空则「TA」）。
 */
export function resolveRoleName(activeSessionId: string, sessions: Session[], globalName: string): string {
  const s = findSessionById(sessions, activeSessionId)
  if (s) return displaySessionName(s)
  const g = (globalName ?? '').trim()
  return g || 'TA'
}

/** 取当前角色人设：有会话 → 会话 persona；无会话/未命中 → 全局人设兜底 */
export function resolveRolePersona(activeSessionId: string, sessions: Session[], globalPersona: string): string {
  const s = findSessionById(sessions, activeSessionId)
  if (s) return s.persona ?? ''
  return globalPersona ?? ''
}

/** 角色首字头像的字：跳过行首空白/emoji（红线：图标禁 emoji），取第一个可见字符；空/全是 emoji → 「TA」 */
export function roleInitial(name: string): string {
  const n = (name ?? '').trim()
  if (!n) return 'TA'
  const stripped = n.replace(/^[\p{Extended_Pictographic}\u{FE0F}\u{200D}]+/u, '').trim()
  return stripped ? Array.from(stripped)[0] : 'TA'
}

/** 改名/改人设后把新值合并回会话列表（只改传入字段），供本地缓存即时生效 */
export function patchSessionInList(
  sessions: Session[],
  id: string | number,
  patch: { title?: string; persona?: string },
): Session[] {
  return (Array.isArray(sessions) ? sessions : []).map((s) => {
    if (String(s.id) !== String(id)) return s
    const next = { ...s }
    if (patch.title !== undefined) next.title = patch.title
    if (patch.persona !== undefined) next.persona = patch.persona
    return next
  })
}
