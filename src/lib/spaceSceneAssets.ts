/**
 * Space's optional physical sprite layer. Assets must preload before activation.
 * Passing this technical gate does NOT mean the scene is visually approved.
 */
export const SPACE_LAYER_BASE = '/space/layered/'
export const SPACE_LAYER_VERSION = '2026-10-09'
export const SPACE_LAYER_REQUIRED = [
  'room-closed.webp',
  'room-cavity.webp',
  'glass_memory_jar.png',
  'open_book.png',
  'tablet_player.png',
  'wired_earphones.png',
  'open_drawer.png',
  'origami_pink.png',
  'origami_blue.png',
  'origami_yellow.png',
  'origami_purple.png',
] as const

export function isSpaceLayerManifestReady(value: unknown): boolean {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  const item = value as { enabled?: unknown; version?: unknown; assets?: unknown }
  const assets = item.assets
  return item.enabled === true
    && item.version === SPACE_LAYER_VERSION
    && Array.isArray(assets)
    && SPACE_LAYER_REQUIRED.every((filename) => assets.includes(filename))
}

export async function preloadSpaceLayer(): Promise<boolean> {
  try {
    const result = await fetch(`${SPACE_LAYER_BASE}manifest.json`, { cache: 'no-store' })
    if (!result.ok || !isSpaceLayerManifestReady(await result.json())) return false
    const loaded = await Promise.all(SPACE_LAYER_REQUIRED.map((filename) => new Promise<boolean>((resolve) => {
      const image = new Image()
      image.onload = () => resolve(image.naturalWidth > 0 && image.naturalHeight > 0)
      image.onerror = () => resolve(false)
      image.src = SPACE_LAYER_BASE + filename
    })))
    return loaded.every(Boolean)
  } catch {
    return false
  }
}
