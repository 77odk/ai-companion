// 连点强刷（顶栏标题 / 登录墙 logo 共用）：清 PWA 缓存 + 注销 Service Worker + 重新加载。
// 纯浏览器端，Node 单测环境不可用；调用方负责「连点 N 下」的节流计数。

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
