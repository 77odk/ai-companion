// PWA 刷新：顶部自动更新提示走快路径；隐藏三连点保留彻底强刷。
const FAST_REFRESH_WAIT_MS = 350

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => window.setTimeout(resolve, ms))
}

/**
 * 自动检测到新版本后的快刷新：
 * - 只注销当前 scope 的 Service Worker，不清整站 Cache Storage；
 * - 整个等待最多 350ms，避免 iOS/PWA 卡在“立即刷新”；
 * - reload 后页面直接从网络拿新 index，VitePWA 会重新注册最新 SW。
 */
export async function refreshToLatest(): Promise<void> {
  try {
    const unregisterCurrent = async () => {
      const registration = await navigator.serviceWorker?.getRegistration?.()
      if (registration) await registration.unregister()
    }
    await Promise.race([unregisterCurrent(), wait(FAST_REFRESH_WAIT_MS)])
  } catch {
    // 刷新优先；SW 查询/注销失败不阻塞 reload。
  }
  location.reload()
}

/**
 * 隐藏强刷：清 PWA 缓存 + 注销全部 Service Worker + 重新加载。
 * 只用于顶栏标题 / 登录墙 logo 连点等故障排查入口。
 */
export async function forceRefresh(): Promise<void> {
  try {
    if ('caches' in window) {
      const keys = await caches.keys()
      await Promise.all(keys.map((k) => caches.delete(k)))
    }
    if (navigator.serviceWorker?.getRegistrations) {
      const regs = await navigator.serviceWorker.getRegistrations()
      await Promise.all(regs.map((r) => r.unregister()))
    }
  } catch {
    // 兜底：没网或不支持时，能刷新就好
  }
  location.reload()
}
