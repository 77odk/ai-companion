/**
 * Space's optional physical sprite layer. Assets must preload before activation.
 * Passing this technical gate does NOT mean the scene is visually approved.
 */
export const SPACE_LAYER_BASE = '/space/layered/'
export const SPACE_LAYER_VERSION = '2026-10-09'
// Only the dedicated local review builder selects this compile-time mode.
// Normal production builds cannot enable it with a URL, storage or window flag.
export const SPACE_ART_REVIEW_BUILD = import.meta.env?.MODE === 'space-art-review'
export const SPACE_LAYER_REQUIRED = [
  'room-content-clean-v2.webp',
  'room-foliage-restored-v2.webp',
  'foliage-alpha-v2.webp',
  'room-content-cavity-v2.webp',
  'room-closed.webp',
  'room-cavity.webp',
  'glass_memory_jar.png',
  'open_book.png',
  'tablet_player.png',
  'wired_earphones.png',
  'e_drawer_hq_v2.webp',
  'c_drawer_inner_hq_v3.webp',
  'origami_pink.png',
  'origami_blue.png',
  'origami_yellow.png',
  'origami_purple.png',
] as const

function hasSpaceLayerResources(value: unknown): boolean {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  const item = value as { enabled?: unknown; artApproved?: unknown; version?: unknown; assets?: unknown }
  const assets = item.assets
  return item.version === SPACE_LAYER_VERSION
    && Array.isArray(assets)
    && SPACE_LAYER_REQUIRED.every((filename) => assets.includes(filename))
}

export function isSpaceLayerManifestReady(value: unknown): boolean {
  if (!hasSpaceLayerResources(value)) return false
  const item = value as { enabled?: unknown; artApproved?: unknown }
  return item.enabled === true && item.artApproved === true
}

export async function preloadSpaceLayer(): Promise<boolean> {
  try {
    const result = await fetch(`${SPACE_LAYER_BASE}manifest.json`, { cache: 'no-store' })
    if (!result.ok) return false
    const manifest: unknown = await result.json()
    // An explicitly marked, temporary review build renders unapproved artwork
    // for inspection. It does not change either approval field or the normal
    // production readiness function, and it still requires all actual assets.
    if (SPACE_ART_REVIEW_BUILD ? !hasSpaceLayerResources(manifest) : !isSpaceLayerManifestReady(manifest)) return false
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
