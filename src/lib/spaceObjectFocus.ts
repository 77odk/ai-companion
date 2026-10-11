export interface SpaceObjectFrame { x: number; y: number; width: number; height: number }

// Measured on the same 941×1672 content-clean room as AISpace. These frames
// enlarge native pixels; they do not generate a new jar or tablet silhouette.
export const SPACE_JAR_FRAME: SpaceObjectFrame = { x: 190, y: 790, width: 260, height: 310 }
export const SPACE_PLAYER_FRAME: SpaceObjectFrame = { x: 522, y: 880, width: 315, height: 234 }
export const SPACE_PLAYER_SCREEN = [[566, 892], [819, 913], [797, 1060], [546, 1038]] as const
export const SPACE_BOOK_FRAME: SpaceObjectFrame = { x: 215, y: 1080, width: 726, height: 270 }
export const SPACE_BOOK_PAPER = [[440, 1108], [923, 1158], [838, 1318], [239, 1208]] as const
export type SpaceObjectQuad = readonly (readonly [number, number])[]

/** Project the actual DOM control plane into the native tablet screen.
 * CSS performs input's inverse transform too, so the painted controls and
 * their hit areas share this plane. No independent rectangular black panel. */
export function spaceObjectScreenMatrix(width: number, height: number, frame = SPACE_PLAYER_FRAME): number[] {
  return spaceObjectPlaneMatrix(width, height, frame, SPACE_PLAYER_SCREEN)
}

export function spaceObjectPlaneMatrix(width: number, height: number, frame: SpaceObjectFrame, corners: SpaceObjectQuad): number[] {
  if (!(width > 0 && height > 0 && Number.isFinite(width) && Number.isFinite(height))) throw new Error('A visible object frame is required')
  if (corners.length !== 4) throw new Error('Four physical corners are required')
  const scale = width / frame.width
  const q = corners.map(([x, y]) => [(x - frame.x) * scale, (y - frame.y) * scale])
  const [p0, p1, p2, p3] = q
  const dx1 = p1[0] - p2[0], dx2 = p3[0] - p2[0]
  const dy1 = p1[1] - p2[1], dy2 = p3[1] - p2[1]
  const dx3 = p0[0] - p1[0] + p2[0] - p3[0], dy3 = p0[1] - p1[1] + p2[1] - p3[1]
  const determinant = dx1 * dy2 - dx2 * dy1
  const g = (dx3 * dy2 - dx2 * dy3) / determinant
  const h = (dx1 * dy3 - dx3 * dy1) / determinant
  const a = p1[0] - p0[0] + g * p1[0], b = p3[0] - p0[0] + h * p3[0]
  const d = p1[1] - p0[1] + g * p1[1], e = p3[1] - p0[1] + h * p3[1]
  return [a / width, d / width, 0, g / width, b / height, e / height, 0, h / height,
    0, 0, 1, 0, p0[0], p0[1], 0, 1]
}
