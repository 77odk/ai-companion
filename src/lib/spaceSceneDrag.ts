/** Coordinate helpers for the mobile Space's fixed 941×1672 scene plane.
 * Only photos change position; objects and uploaded photo data remain untouched.
 */
export type ScenePointer = { x: number; y: number }
export type ScenePhotoPlacement = { x: number; y: number; rotate: number }

function clampPosition(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value))
}

/** Delta-based dragging avoids a jump when a rotated photo is first touched. */
export function projectSpacePhotoDrag(
  origin: ScenePhotoPlacement,
  start: ScenePointer,
  current: ScenePointer,
  boardWidth: number,
  boardHeight: number,
): ScenePhotoPlacement {
  if (
    !Number.isFinite(boardWidth) || !Number.isFinite(boardHeight)
    || boardWidth <= 0 || boardHeight <= 0
    || !Number.isFinite(start.x) || !Number.isFinite(start.y)
    || !Number.isFinite(current.x) || !Number.isFinite(current.y)
  ) return { ...origin }

  return {
    x: clampPosition(origin.x + (current.x - start.x) * 100 / boardWidth, 2, 78),
    y: clampPosition(origin.y + (current.y - start.y) * 100 / boardHeight, 1, 72),
    rotate: origin.rotate,
  }
}

/** Click stays click until the user's finger has intentionally moved. */
export function hasMovedSpacePhoto(
  start: ScenePointer,
  current: ScenePointer,
  threshold = 5,
): boolean {
  return Math.hypot(current.x - start.x, current.y - start.y) > threshold
}

/** Drawer pull is a gesture, never a scroll-jacking global listener. */
export function projectSpaceDrawerPull(startY: number, currentY: number, hitHeight: number): number {
  if (!Number.isFinite(hitHeight) || hitHeight <= 0 || !Number.isFinite(startY) || !Number.isFinite(currentY)) return 0
  return clampPosition((currentY - startY) * 100 / hitHeight, 0, 48)
}

export function shouldOpenSpaceDrawer(pullPercent: number): boolean {
  return Number.isFinite(pullPercent) && pullPercent >= 22
}

/** Cover the actual Space view without stretching the approved scene.
 * Cropping is symmetric; every object shares this exact pixel plane.
 */
export function computeSpaceCover(
  viewportWidth: number,
  viewportHeight: number,
): { width: number; height: number } | null {
  if (!Number.isFinite(viewportWidth) || !Number.isFinite(viewportHeight)
    || viewportWidth <= 0 || viewportHeight <= 0) return null
  const scale = Math.max(viewportWidth / 941, viewportHeight / 1672)
  return { width: 941 * scale, height: 1672 * scale }
}
