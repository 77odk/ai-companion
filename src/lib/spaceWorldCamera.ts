/**
 * Space V2 scene camera — independent, no renderer/DOM or storage dependencies.
 * Coordinates use the approved 941×1672 world plane, with (0,0) top-left.
 * Preparatory code: does not change the active Space page until visual approval.
 */
export const SPACE_WORLD_WIDTH = 941
export const SPACE_WORLD_HEIGHT = 1672

export type SpaceWorldPoint = Readonly<{ x: number; y: number }>
export type SpaceViewport = Readonly<{ x: number; y: number; width: number; height: number }>
export type SpaceRect = Readonly<{ x: number; y: number; width: number; height: number }>
export type SpaceSafeInsets = Readonly<{ top: number; right: number; bottom: number; left: number }>

export type SpaceCamera = Readonly<{
  viewport: SpaceViewport
  scale: number
  origin: SpaceWorldPoint
  worldSize: Readonly<{ width: number; height: number }>
  visibleWorld: SpaceRect
  safeVisibleWorld: SpaceRect
}>

const ZERO_INSETS: SpaceSafeInsets = { top: 0, right: 0, bottom: 0, left: 0 }

function finiteNonNegative(value: number): boolean {
  return Number.isFinite(value) && value >= 0
}

/** Symmetric cover crop. The scene may crop, but must never stretch. */
export function computeSpaceCamera(
  viewport: SpaceViewport,
  safeInsets: SpaceSafeInsets = ZERO_INSETS,
): SpaceCamera | null {
  if (![viewport.x, viewport.y, viewport.width, viewport.height].every(Number.isFinite)
    || viewport.width <= 0 || viewport.height <= 0
    || ![safeInsets.top, safeInsets.right, safeInsets.bottom, safeInsets.left].every(finiteNonNegative)
    || safeInsets.left + safeInsets.right >= viewport.width
    || safeInsets.top + safeInsets.bottom >= viewport.height) return null

  const scale = Math.max(viewport.width / SPACE_WORLD_WIDTH, viewport.height / SPACE_WORLD_HEIGHT)
  if (!Number.isFinite(scale) || scale <= 0) return null
  const origin = {
    x: viewport.x + (viewport.width - SPACE_WORLD_WIDTH * scale) / 2,
    y: viewport.y + (viewport.height - SPACE_WORLD_HEIGHT * scale) / 2,
  }

  const clipped = (left: number, top: number, right: number, bottom: number): SpaceRect => {
    const x0 = Math.max(0, Math.min(SPACE_WORLD_WIDTH, (left - origin.x) / scale))
    const y0 = Math.max(0, Math.min(SPACE_WORLD_HEIGHT, (top - origin.y) / scale))
    const x1 = Math.max(x0, Math.min(SPACE_WORLD_WIDTH, (right - origin.x) / scale))
    const y1 = Math.max(y0, Math.min(SPACE_WORLD_HEIGHT, (bottom - origin.y) / scale))
    return { x: x0, y: y0, width: x1 - x0, height: y1 - y0 }
  }
  const visibleWorld = clipped(
    viewport.x, viewport.y, viewport.x + viewport.width, viewport.y + viewport.height,
  )
  const safeVisibleWorld = clipped(
    viewport.x + safeInsets.left,
    viewport.y + safeInsets.top,
    viewport.x + viewport.width - safeInsets.right,
    viewport.y + viewport.height - safeInsets.bottom,
  )
  return {
    viewport: { ...viewport }, scale, origin,
    worldSize: { width: SPACE_WORLD_WIDTH, height: SPACE_WORLD_HEIGHT },
    visibleWorld, safeVisibleWorld,
  }
}

/** Fixed scene/world point to absolute screen pixels. */
export function spaceWorldToScreen(point: SpaceWorldPoint, camera: SpaceCamera): SpaceWorldPoint {
  return { x: camera.origin.x + point.x * camera.scale, y: camera.origin.y + point.y * camera.scale }
}

/** True inverse: includes viewport offsets as well as cover cropping. */
export function spaceScreenToWorld(point: SpaceWorldPoint, camera: SpaceCamera): SpaceWorldPoint {
  return { x: (point.x - camera.origin.x) / camera.scale, y: (point.y - camera.origin.y) / camera.scale }
}

/** Pointer delta is not a point: only invert scaling, not camera translation. */
export function spaceScreenDeltaToWorld(delta: SpaceWorldPoint, camera: SpaceCamera): SpaceWorldPoint {
  return { x: delta.x / camera.scale, y: delta.y / camera.scale }
}

/** World-space visible/safe hit testing, with no DOM/CSS knowledge. */
export function isSpacePointVisible(
  point: SpaceWorldPoint, camera: SpaceCamera, useSafeFrame = false,
): boolean {
  if (!Number.isFinite(point.x) || !Number.isFinite(point.y)) return false
  const rect = useSafeFrame ? camera.safeVisibleWorld : camera.visibleWorld
  return point.x >= rect.x && point.x <= rect.x + rect.width
    && point.y >= rect.y && point.y <= rect.y + rect.height
}
