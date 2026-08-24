// 登录状态（B2b 登录墙）：读 token / 判定登录 / 登出 / 游客可看 view 集合
// 纯逻辑都抽成可被 Node 单测的导出函数；token 存在哪沿用 sync.ts 的 ai_companion_account。
// 登录状态变化用 dataChange 的 ELUVIN_AUTH_CHANGE 广播（登录/登出后 UI 要刷新）。

import { getAccount, clearAccount } from './sync.ts'
import { notifyAuthChanged } from './dataChange.ts'

/** 游客可看的展示类 view：欢迎页 / 选角色模板页 / 使用指南 */
export const PUBLIC_VIEWS = ['welcome', 'role', 'guide'] as const

/** 判断 view 是否游客可看（纯函数，可单测） */
export function isPublicView(view: string): boolean {
  return (PUBLIC_VIEWS as readonly string[]).includes(view)
}

/** 本地 token：未登录返回空串（token 非空即有账号） */
export function getToken(): string {
  return getAccount()?.token ?? ''
}

/** 是否已登录：本地有非空 token 即为已登录 */
export function isLoggedIn(): boolean {
  return getToken() !== ''
}

/** 登出：清 token/account 并广播登录状态变化（App 收到后刷新登录墙） */
export function logout(): void {
  clearAccount()
  notifyAuthChanged()
}
