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
