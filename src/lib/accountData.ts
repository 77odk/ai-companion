// 账号数据权利：导出全部数据 / 注销账号（2026-09-27）
//
// 隐私口径：导出走用户自己的 token，只返回他自己的数据（后端 /api/export 已解密成可读文字）；
// 注销是真删（后端事务内清干净），前端在成功后清掉本机缓存，避免「重新注册又把旧记录同步回去」。

import { API_BASE } from './sync.ts'
import { getToken } from './auth.ts'

export const DELETE_CONFIRM_WORD = '注销'

function humanError(status: number, fallback: string): string {
  if (status === 401) return '登录已过期，请重新登录后再试'
  if (status === 400) return '确认词不对，请照着提示重新输入'
  return fallback
}

/** 导出全部数据，浏览器直接下载一个 JSON 文件。 */
export async function exportMyData(): Promise<void> {
  const token = getToken()
  if (!token) throw new Error('还没登录，先登录才能导出')

  const res = await fetch(`${API_BASE}/api/export`, {
    headers: { Authorization: `Bearer ${token}` },
  })
  if (!res.ok) throw new Error(humanError(res.status, '导出失败了，稍后再试试'))

  const text = await res.text()
  const stamp = new Date().toISOString().slice(0, 10)
  const blob = new Blob([text], { type: 'application/json' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = `忆文数据导出-${stamp}.json`
  document.body.appendChild(a)
  a.click()
  a.remove()
  window.setTimeout(() => URL.revokeObjectURL(url), 5000)
}

/** 注销账号：服务端真删，成功后必须由调用方清本地缓存并退出登录。 */
export async function deleteMyAccount(confirmWord: string): Promise<void> {
  const token = getToken()
  if (!token) throw new Error('还没登录')

  const res = await fetch(`${API_BASE}/api/account`, {
    method: 'DELETE',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ confirm: confirmWord }),
  })
  if (!res.ok) throw new Error(humanError(res.status, '注销失败了，稍后再试试'))
}

/** 注销要清干净的本地前缀：会话/记忆/设置为 ai_companion_，TA 空间动态与照片为 ai_space_，
 *  登录态与同意记录为 eluvin_（注意 eluvin_vid 是 HttpOnly Cookie，本来就不在 localStorage 里）。 */
export const LOCAL_DATA_PREFIXES = ['ai_companion_', 'ai_space_', 'eluvin_'] as const

function clearByPrefix(storage: Storage, prefixes: readonly string[]): number {
  let removed = 0
  try {
    const keys: string[] = []
    for (let i = 0; i < storage.length; i += 1) {
      const k = storage.key(i)
      if (k && prefixes.some((p) => k.startsWith(p))) keys.push(k)
    }
    for (const k of keys) {
      storage.removeItem(k)
      removed += 1
    }
  } catch {
    /* 读不到 storage 就算了 */
  }
  return removed
}

/** 清掉本机所有忆文痕迹（注销后调用，避免重新注册时旧数据又被同步上去）。
 *  两处都清：localStorage（会话/记忆/设置/空间动态与照片/登录态/同意记录）
 *  与 sessionStorage（本次进站的同意标记）。 */
export function clearLocalCompanionData(): number {
  let removed = 0
  try { removed += clearByPrefix(localStorage, LOCAL_DATA_PREFIXES) } catch { /* ignore */ }
  try { removed += clearByPrefix(sessionStorage, LOCAL_DATA_PREFIXES) } catch { /* ignore */ }
  return removed
}
