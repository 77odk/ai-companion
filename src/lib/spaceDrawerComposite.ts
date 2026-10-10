/**
 * E-front / C-interior drawer compositing in the 941 × 1672 Space world.
 * No external renderer or dependencies. Art is source-derived, not synthesized
 * user content. This does not touch the desk, photos, letters or app state.
 *
 * Canvas is sized to the drawer ROI only (514 × 363), not the full scene.
 */
export const SPACE_DRAWER_ART_ROI = { x: 427, y: 1309, width: 514, height: 363 } as const

type Point = readonly [number, number]
type Quad = readonly [Point, Point, Point, Point]
export interface SpaceDrawerArt {
  /** Full 481x243 E source crop; the face is sampled only below the envelopes. */
  face: CanvasImageSource
  /** Full 506x210 C source crop; only its inner depth survives alpha cutout. */
  interior: CanvasImageSource
}

const SOURCE_FACE: Quad = [
  [466, 1500], [940, 1586], [940, 1671], [466, 1571],
]
const OPEN_FACE: Quad = [
  [442, 1442], [940, 1540], [940, 1671], [442, 1614],
]
const lerp = (from: number, to: number, value: number) => from + (to - from) * value
const clamp = (p: number) => Number.isFinite(p) ? Math.max(0, Math.min(1, p)) : 0
const mixQuad = (p: number): Quad => SOURCE_FACE.map((q, i) => [
  lerp(q[0], OPEN_FACE[i][0], p),
  lerp(q[1], OPEN_FACE[i][1], p),
]) as unknown as Quad

/** Front-apron occlusion: the inner envelopes may emerge only behind the desk
 * edge, then clear the lip as the drawer moves out. These are world Y values. */
export function spaceDrawerAperture(progress: number): { leftTop: number; rightTop: number } {
  const p = clamp(progress)
  return { leftTop: 1452 - 110 * p, rightTop: 1546 - 150 * p }
}

/** C canvas has its own alpha silhouette; do not paint its separate cabinet. */
export function paintSpaceDrawer(
  ctx: CanvasRenderingContext2D,
  art: SpaceDrawerArt,
  progress: number,
): void {
  const p = clamp(progress)
  const { x, y, width, height } = SPACE_DRAWER_ART_ROI
  ctx.clearRect(0, 0, width, height)
  if (p <= 0) return

  // Translate to the approved world plane; the fixed desktop never moves.
  ctx.save()
  ctx.translate(-x, -y)

  ctx.save()
  // A delayed smooth reveal prevents C letters from suddenly popping into
  // view on the first quarter of a drag. The cavity appears before contents.
  const interiorPhase = clamp((p - 0.03) / 0.72)
  ctx.globalAlpha = interiorPhase * interiorPhase * (3 - 2 * interiorPhase)
  // The C cutout already excludes its unrelated tabletop and front cabinet.
  ctx.translate(0, (1 - p) * 23)
  // Progressive apron occlusion, not alpha-only fade: otherwise the C sprite
  // protrudes through the stationary E tabletop on the first frames.
  const { leftTop, rightTop } = spaceDrawerAperture(p)
  ctx.beginPath()
  ctx.moveTo(435, leftTop)
  ctx.lineTo(941, rightTop)
  ctx.lineTo(941, 1672)
  ctx.lineTo(435, 1672)
  ctx.closePath()
  ctx.clip()
  ctx.drawImage(art.interior, 435, 1325, 506, 210)
  ctx.restore()

  // Draw ONLY the natural E wooden front. Source top sampling starts *below*
  // the E envelope and wax heart: this removes the doubled-wax bug.
  const destination = mixQuad(p)
  ctx.save()
  ctx.globalAlpha = Math.min(1, p * 3)
  const strips = 32
  for (let strip = 0; strip < strips; strip++) {
    const a = strip / strips, b = (strip + 1) / strips
    const along = (pointA: Point, pointB: Point, ratio: number): Point => [
      lerp(pointA[0], pointB[0], ratio), lerp(pointA[1], pointB[1], ratio),
    ]
    const tl = along(destination[0], destination[1], a)
    const tr = along(destination[0], destination[1], b)
    const bl = along(destination[3], destination[2], a)
    const br = along(destination[3], destination[2], b)
    const sl = along(SOURCE_FACE[0], SOURCE_FACE[1], a)
    const sr = along(SOURCE_FACE[0], SOURCE_FACE[1], b)
    const sb = along(SOURCE_FACE[3], SOURCE_FACE[2], a)
    // Source E image starts at world (460, 1429).
    const sx1 = sl[0] - 460, sx2 = sr[0] - 460
    const sy1 = sl[1] - 1429, sy2 = sr[1] - 1429
    const syBottom = sb[1] - 1429
    const dY = syBottom - sy1
    if (sx2 <= sx1 || dY <= 0) continue
    const c = (bl[0] - tl[0]) / dY
    const d = (bl[1] - tl[1]) / dY
    const aMatrix = (tr[0] - tl[0] - c * (sy2 - sy1)) / (sx2 - sx1)
    const bMatrix = (tr[1] - tl[1] - d * (sy2 - sy1)) / (sx2 - sx1)
    const e = tl[0] - aMatrix * sx1 - c * sy1
    const f = tl[1] - bMatrix * sx1 - d * sy1
    ctx.save()
    ctx.beginPath()
    ctx.moveTo(tl[0] - .15, tl[1] - .15)
    ctx.lineTo(tr[0] + .15, tr[1] - .15)
    ctx.lineTo(br[0] + .15, br[1] + .15)
    ctx.lineTo(bl[0] - .15, bl[1] + .15)
    ctx.closePath()
    ctx.clip()
    ctx.transform(aMatrix, bMatrix, c, d, e, f)
    ctx.drawImage(art.face, 0, 0, 481, 243)
    ctx.restore()
  }
  ctx.restore()
  ctx.restore()
}

/** Full drawer opens on the original 760ms timeline, with no frame-rate drift. */
export function drawerFrameProgress(elapsedMs: number, durationMs = 760): number {
  if (!Number.isFinite(elapsedMs) || elapsedMs <= 0) return 0
  if (!Number.isFinite(durationMs) || durationMs <= 0) return 1
  const t = clamp(elapsedMs / durationMs)
  return 1 - (1 - t) ** 3
}
