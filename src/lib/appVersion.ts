// #21 · PWA 版本探针：构建内版本与线上 version.json 不一致时提示用户刷新。
// 纯前端、无 storage key / 后端 / 新依赖。

declare const __ELUVIN_BUILD_VERSION__: string

export function getCurrentBuildVersion(): string {
  return typeof __ELUVIN_BUILD_VERSION__ === 'string'
    ? __ELUVIN_BUILD_VERSION__.trim()
    : ''
}

export function shouldShowBuildUpdate(current: string, deployed: string): boolean {
  const a = current.trim()
  const b = deployed.trim()
  return Boolean(a && b && a !== b)
}

export async function fetchDeployedBuildVersion(
  fetchImpl: typeof fetch = fetch,
  url = './version.json',
): Promise<string | null> {
  try {
    const separator = url.includes('?') ? '&' : '?'
    const response = await fetchImpl(`${url}${separator}t=${Date.now()}`, {
      cache: 'no-store',
    })
    if (!response.ok) return null
    const body = (await response.json().catch(() => null)) as { version?: unknown } | null
    return typeof body?.version === 'string' && body.version.trim()
      ? body.version.trim()
      : null
  } catch {
    return null
  }
}

/**
 * 统一的版本探测入口：定时探针（启动 / 回到前台 / 联网 / SW 换版）与
 * 「我的 → 检查更新」都走这里，保证两处判定完全一致、不各写一套。
 */
export type BuildUpdateCheck = 'updated' | 'current' | 'unknown'

type DeployedBuildListener = (version: string | null) => void
const deployedBuildListeners = new Set<DeployedBuildListener>()

/** 订阅探测结果：有新版本给版本号，已是最新给 null。调用方负责展示与「稍后」的忽略逻辑。 */
export function subscribeDeployedBuild(listener: DeployedBuildListener): () => void {
  deployedBuildListeners.add(listener)
  return () => {
    deployedBuildListeners.delete(listener)
  }
}

function emitDeployedBuild(version: string | null): void {
  for (const listener of [...deployedBuildListeners]) listener(version)
}

/**
 * updated = 线上是更新的版本；current = 已经是最新；unknown = 取不到（离线、本地开发构建）。
 * 拿不到当前版本时一律 unknown，不误报。
 */
export async function checkDeployedBuild(
  fetchImpl: typeof fetch = fetch,
): Promise<BuildUpdateCheck> {
  const current = getCurrentBuildVersion()
  if (!current) return 'unknown'
  const deployed = await fetchDeployedBuildVersion(fetchImpl)
  if (!deployed) return 'unknown'
  const updated = shouldShowBuildUpdate(current, deployed)
  emitDeployedBuild(updated ? deployed : null)
  return updated ? 'updated' : 'current'
}
