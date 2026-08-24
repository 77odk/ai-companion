// 老数据一键迁移（B2d）
// 登录用户没有云端会话、但本地（B2c 前）有旧 persona/聊天记录/记忆时，把本地数据打包成第一个云端会话。
// 纯逻辑 + 迁移标记，Node 可直接单测；真正的上传循环在 App.tsx 里做。
// 红线：迁移是复制到云端，本地数据绝不删除（本地原样保留，置位后也不再重复迁移）。

import { loadMemory } from './memory.ts'
import { loadMessages, loadPersona } from './storage.ts'

/** 迁移消息条数保护上限：超过只迁最近 2000 条（本地旧数据正常量级远小于此，防一次性塞爆） */
export const MAX_MIGRATE_MESSAGES = 2000

const MIGRATED_KEY = 'ai_companion_migrated'

/** 本地是否有旧数据：persona（去空白后）或聊天记录或本地记忆任一非空 */
export function hasLocalLegacyData(): boolean {
  return loadPersona().trim() !== '' || loadMessages().length > 0 || loadMemory().length > 0
}

/** 迁移用的一条消息：只保留后端需要的 role/content/ts */
export interface MigrationMessage {
  role: 'user' | 'assistant'
  content: string
  ts: number
}

/** 迁移用的一条记忆：只保留 content */
export interface MigrationMemory {
  content: string
}

/** 迁移内容：persona（可为空串）+ 升序消息 + 记忆 */
export interface MigrationPayload {
  persona: string
  messages: MigrationMessage[]
  memories: MigrationMemory[]
}

/**
 * 组装迁移内容：
 * - persona：loadPersona() 原样（空则用空串，新建会话允许空 persona）
 * - messages：只保留 {role, content, ts}，role ∈ user/assistant、content 非空、ts 有限；
 *   按 ts 升序，超过 MAX_MIGRATE_MESSAGES 只取最近 2000 条
 * - memories：只保留 {content}（非空）
 */
export function buildMigrationPayload(): MigrationPayload {
  const messages = loadMessages()
    .filter(
      (m) =>
        m != null &&
        (m.role === 'user' || m.role === 'assistant') &&
        typeof m.content === 'string' &&
        m.content.trim() !== '' &&
        typeof m.ts === 'number' &&
        Number.isFinite(m.ts),
    )
    .map((m) => ({ role: m.role, content: m.content, ts: m.ts }))
    .sort((a, b) => a.ts - b.ts)
    .slice(-MAX_MIGRATE_MESSAGES)
  const memories = loadMemory()
    .filter((m) => m != null && typeof m.text === 'string' && m.text.trim() !== '')
    .map((m) => ({ content: m.text }))
  return { persona: loadPersona(), messages, memories }
}

/** 迁移成功完成标记（localStorage 'ai_companion_migrated' = '1'），防止重复建会话 */
export function setLocalMigratedFlag(): void {
  try {
    localStorage.setItem(MIGRATED_KEY, '1')
  } catch {
    // 存不下不影响功能
  }
}

/** 是否已迁移过（置位后即使本地还有旧数据也不再自动迁移） */
export function hasMigratedFlag(): boolean {
  try {
    return localStorage.getItem(MIGRATED_KEY) === '1'
  } catch {
    return false
  }
}
