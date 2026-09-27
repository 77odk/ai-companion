// 账号数据权利：导出全部数据 / 注销账号（2026-09-27）
//
// 隐私口径：导出走用户自己的 token，只返回他自己的数据（后端 /api/export 已解密成可读文字）；
// 注销是真删（后端事务内清干净），前端在成功后清掉本机缓存，避免「重新注册又把旧记录同步回去」。

import { API_BASE } from './sync'
import { getToken } from './auth'

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

/** 清掉本机所有忆文缓存（注销后调用，避免重新注册时旧数据又被同步上去）。 */
export function clearLocalCompanionData(): number {
  let removed = 0
  try {
    const keys: string[] = []
    for (let i = 0; i < localStorage.length; i += 1) {
      const k = localStorage.key(i)
      if (k && k.startsWith('ai_companion_')) keys.push(k)
    }
    for (const k of keys) {
      localStorage.removeItem(k)
      removed += 1
    }
  } catch {
    /* 读不到 storage 就算了 */
  }
  return removed
}
