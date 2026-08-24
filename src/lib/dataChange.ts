// 本地数据变更广播（storage / memory / anniversary / aiSpace / sync 共用）
// 独立成零依赖小模块：storage 又要被 memory/anniversary 依赖，事件常量放这里避免模块间循环引用。
// Node 单测环境没有 window：dispatch 前判存在，静默跳过。

export const ELUVIN_DATA_CHANGE = 'eluvin-data-change'

/** 登录状态变化广播（登录/登出后 UI 要刷新，App 监听后重算登录墙） */
export const ELUVIN_AUTH_CHANGE = 'eluvin-auth-change'

/** 广播"本地数据有变化"：账号同步模块监听到就防抖上传（同页签 storage 事件不触发，所以用自定义事件） */
export function notifyDataChanged(): void {
  if (typeof window === 'undefined' || typeof window.dispatchEvent !== 'function') return
  window.dispatchEvent(new Event(ELUVIN_DATA_CHANGE))
}

/** 广播"登录状态有变化"（token 写入/清除后调用，App 重新判定登录墙） */
export function notifyAuthChanged(): void {
  if (typeof window === 'undefined' || typeof window.dispatchEvent !== 'function') return
  window.dispatchEvent(new Event(ELUVIN_AUTH_CHANGE))
}
