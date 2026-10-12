import { paintSpaceDrawerFrontMesh } from './spaceDrawerFaceMesh.ts'

/**
 * Original E-front / E-interior drawer compositing in the 941 × 1672 Space world.
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
  /** The same E source crop; the inside is masked above the front face. */
  interior: CanvasImageSource
}

const SOURCE_FACE: Quad = [
  [468, 1462], [940, 1582], [940, 1671], [468, 1582],
]
const clamp = (p: number) => Number.isFinite(p) ? Math.max(0, Math.min(1, p)) : 0

/** A wooden front is a rigid plane. Every corner travels by the same vector;
 * changing its height independently was stretching the original E material. */
export function spaceDrawerTravel(progress: number): Point {
  const p = clamp(progress)
  return [24 * (1 - p), -68 * (1 - p)]
}

export function spaceDrawerFrontQuad(progress: number): Quad {
  const [dx, dy] = spaceDrawerTravel(progress)
  return SOURCE_FACE.map(([x, y]) => [x + dx, y + dy]) as unknown as Quad
}

/** The inside and front are samples of one original E drawer, translated as
 * one rigid object. No differently photographed interior needs an offset. */
export function spaceDrawerInteriorTravel(progress: number): Point {
  return spaceDrawerTravel(progress)
}

/** Front-apron occlusion: the inner envelopes may emerge only behind the desk
 * edge, then clear the lip as the drawer moves out. These are world Y values. */
export function spaceDrawerAperture(progress: number): { leftTop: number; rightTop: number } {
  // This is the fixed cabinet opening, never the travelling inner lip.
  void progress
  return { leftTop: 1432, rightTop: 1518 }
}

/** Blend the fixed closed-drawer background into the empty cavity at the
 * same progress as the moving drawer. An instantaneous full cavity on first
 * touch would reveal a black hole before the E sprite becomes visible. */
export function spaceDrawerCavityAlpha(progress: number): number {
  // All exposed materials become opaque before the 25% inspect frame.
  // A long full-room dissolve makes the real wooden drawer look translucent.
  return Math.min(1, clamp(progress) * 6)
}

/** Fast material reveal: opacity stops blending with the old closed cabinet
 * before the drawer reaches its clearly visible first quarter. */
export function spaceDrawerFrontAlpha(progress: number): number {
  return Math.min(1, clamp(progress) * 6)
}

export function spaceDrawerInteriorAlpha(progress: number): number {
  return clamp((clamp(progress) - 0.01) / 0.2)
}

/** Native E rim and face share their original left edge. */
export function spaceDrawerInnerLeftEdge(progress: number): number {
  return spaceDrawerFrontQuad(progress)[0][0] - 3
}

/** Paint only source-derived E materials inside the fixed cabinet opening. */
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
  ctx.globalAlpha = spaceDrawerInteriorAlpha(p)
  const { leftTop, rightTop } = spaceDrawerAperture(p)
  ctx.beginPath()
  ctx.moveTo(435, leftTop)
  ctx.lineTo(941, rightTop)
  ctx.lineTo(941, 1672)
  ctx.lineTo(435, 1672)
  ctx.closePath()
  ctx.clip()
  const [innerX, innerY] = spaceDrawerInteriorTravel(p)
  ctx.translate(innerX, innerY)
  // Native E source: the cabinet's fixed apron is above this contour;
  // its envelope bed ends at the same sloping edge as the moving front.
  ctx.beginPath()
  ctx.moveTo(468, 1462)
  ctx.lineTo(514, 1430)
  ctx.lineTo(940, 1517)
  ctx.lineTo(940, 1582)
  ctx.closePath()
  ctx.clip()
  ctx.drawImage(art.interior, 460, 1429, 481, 243)
  ctx.restore()

  // Two native E triangles replace 32 vertical strips. The mapping math is
  // shared with its geometry test rather than duplicated in this renderer.
  const destination = spaceDrawerFrontQuad(p)
  ctx.save()
  ctx.globalAlpha = spaceDrawerFrontAlpha(p)
  // The full-height rigid face emerges beneath the fixed cabinet apron.
  // Occlusion clips the object, never stretches or trims its source artwork.
  ctx.beginPath()
  ctx.moveTo(435, leftTop)
  ctx.lineTo(941, rightTop)
  ctx.lineTo(941, 1672)
  ctx.lineTo(435, 1672)
  ctx.closePath()
  ctx.clip()
  const sourceFace: Quad = [
    [8, 33], [480, 153], [480, 242], [8, 153],
  ]
  paintSpaceDrawerFrontMesh(ctx, art.face, sourceFace, destination)
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
