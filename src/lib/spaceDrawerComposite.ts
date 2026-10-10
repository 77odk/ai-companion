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

/** Blend the fixed closed-drawer background into the empty cavity at the
 * same progress as the moving drawer. An instantaneous full cavity on first
 * touch would reveal a black hole before the E/C sprite becomes visible. */
export function spaceDrawerCavityAlpha(progress: number): number {
  return Math.min(1, clamp(progress) * 2)
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
  // The C source ends at left/right world y=1438/1535 while the E face
  // starts lower during intermediate pull frames. Maintain slight overlap
  // so the fixed cavity cannot shine through their seam.
  ctx.translate(0, (1 - p) * 63 + 8)
  // The previously bundled HQ C bitmap also contains C's stationary desktop
  // and lower cabinet. Clip to its genuine drawer SIDE + LETTERS silhouette
  // so it can never repaint the fixed E desk or duplicate its moving front.
  // Once a clean new-named C asset passes G0-A, this remains an extra guard.
  ctx.beginPath()
  ctx.moveTo(441, 1424)
  ctx.lineTo(492, 1368)
  ctx.lineTo(515, 1332)
  ctx.lineTo(538, 1327)
  ctx.lineTo(648, 1350)
  ctx.lineTo(821, 1373)
  ctx.lineTo(940, 1398)
  ctx.lineTo(940, 1535)
  ctx.lineTo(441, 1438)
  ctx.closePath()
  ctx.clip()
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

  // Two affine triangles replace 32 vertical texture strips. Repeated strips
  // left pinstripe gaps (and produced dark overlaps when widened). This is
  // still the original E wood pixel source, not a repaint or generated desk.
  const destination = mixQuad(p)
  ctx.save()
  ctx.globalAlpha = Math.min(1, p * 3)
  const triangles: readonly (readonly [number, number, number])[] = [[0, 1, 2], [0, 2, 3]]
  for (const [ia, ib, ic] of triangles) {
    const indices = [ia, ib, ic]
    const source: Point[] = indices.map((i) => [
      SOURCE_FACE[i][0] - 460, SOURCE_FACE[i][1] - 1429,
    ])
    const target: Point[] = indices.map((i) => destination[i])
    const sx1 = source[1][0] - source[0][0]
    const sy1 = source[1][1] - source[0][1]
    const sx2 = source[2][0] - source[0][0]
    const sy2 = source[2][1] - source[0][1]
    const dx1 = target[1][0] - target[0][0]
    const dy1 = target[1][1] - target[0][1]
    const dx2 = target[2][0] - target[0][0]
    const dy2 = target[2][1] - target[0][1]
    const determinant = sx1 * sy2 - sx2 * sy1
    if (Math.abs(determinant) < 1e-7) continue
    const a = (dx1 * sy2 - dx2 * sy1) / determinant
    const b = (dy1 * sy2 - dy2 * sy1) / determinant
    const c = (sx1 * dx2 - sx2 * dx1) / determinant
    const d = (sx1 * dy2 - sx2 * dy1) / determinant
    const e = target[0][0] - a * source[0][0] - c * source[0][1]
    const f = target[0][1] - b * source[0][0] - d * source[0][1]
    ctx.save()
    ctx.beginPath()
    ctx.moveTo(...target[0])
    ctx.lineTo(...target[1])
    ctx.lineTo(...target[2])
    ctx.closePath()
    ctx.clip()
    ctx.transform(a, b, c, d, e, f)
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
