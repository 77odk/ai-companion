// 角色数据隔离的公共迁移（TASK-UI2）
// 老全局数据（相逢纪/相与书/TA 的生活）首次按会话读取时，迁移到「默认角色（第一个会话）」名下，
// 打标记防重复迁移；原全局 key 清掉，避免以后两个地方读到两份。
// 无会话（遗留/游客模式）不迁移，老 key 继续可读——兼容既有逻辑。

import { getDefaultSessionId } from './sessionStore.ts'

/**
 * 把老全局 key 的数据迁到默认角色（第一个会话）的 key 下。
 * 幂等：已打迁移标记、没有默认会话、全局无数据、或目标 key 已有数据 → 跳过。
 * 返回是否真的发生过迁移（数据从全局挪到了会话 key）。
 * 由各 store（anniversary/weeklyReview/aiSpace）在按会话读取时调用。
 */
export function migrateGlobalToDefaultSession(
  globalKey: string,
  sessionKeyOf: (sid: string) => string,
  markerKey: string,
): boolean {
  try {
    if (localStorage.getItem(markerKey) != null) return false
    const defaultSid = getDefaultSessionId()
    if (!defaultSid) return false
    const raw = localStorage.getItem(globalKey)
    if (raw == null) return false
    const targetKey = sessionKeyOf(defaultSid)
    const existing = localStorage.getItem(targetKey)
    if (existing == null) {
      // 目标 key 空 → 直接搬过去，删全局、打标
      localStorage.setItem(targetKey, raw)
      localStorage.removeItem(globalKey)
      localStorage.setItem(markerKey, '1')
      return true
    }
    // 目标已有数据（review3 新-12）：不能无条件删全局——目标里可能没有全局这份内容，删了就真丢了。
    // 两个都是 JSON 数组时按项合并去重，合并成功才删全局并打标；
    // 结构对不上/解析失败 → 全局原样保留、不打标，下次再试，绝不丢数据。
    try {
      const a = JSON.parse(existing)
      const b = JSON.parse(raw)
      if (Array.isArray(a) && Array.isArray(b)) {
        const seen = new Set<string>()
        const merged = [...b, ...a].filter((item) => {
          const key = item != null && typeof item === 'object' ? JSON.stringify(item) : String(item)
          if (seen.has(key)) return false
          seen.add(key)
          return true
        })
        localStorage.setItem(targetKey, JSON.stringify(merged))
        localStorage.removeItem(globalKey)
        localStorage.setItem(markerKey, '1')
        return true
      }
    } catch {
      // 合并失败：保留全局数据，下次再试
    }
    return false
  } catch {
    // 迁移失败不阻塞：数据留在全局 key，遗留模式仍可读，下次再试
    return false
  }
}
