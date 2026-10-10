/** Draw the E wooden drawer front with two adjacent source-derived triangles.
 * The caller supplies a transparent 514x363 scratch canvas and composites
 * that canvas ONCE at the desired opacity. This prevents 32-strip alpha seams.
 * No independent desk shape, content or model-generated texture is introduced.
 */
type Point = readonly [number, number]
export type SpaceDrawerQuad = readonly [Point, Point, Point, Point]

export function paintSpaceDrawerFrontMesh(
  ctx: CanvasRenderingContext2D,
  image: CanvasImageSource,
  source: SpaceDrawerQuad,
  destination: SpaceDrawerQuad,
): void {
  for (const indices of [[0, 1, 2], [0, 2, 3]] as const) {
    const s = indices.map(i => source[i])
    const d = indices.map(i => destination[i])
    const sx1 = s[1][0] - s[0][0], sy1 = s[1][1] - s[0][1]
    const sx2 = s[2][0] - s[0][0], sy2 = s[2][1] - s[0][1]
    const dx1 = d[1][0] - d[0][0], dy1 = d[1][1] - d[0][1]
    const dx2 = d[2][0] - d[0][0], dy2 = d[2][1] - d[0][1]
    const determinant = sx1 * sy2 - sx2 * sy1
    if (Math.abs(determinant) < 1e-7) continue
    const a = (dx1 * sy2 - dx2 * sy1) / determinant
    const b = (dy1 * sy2 - dy2 * sy1) / determinant
    const c = (sx1 * dx2 - sx2 * dx1) / determinant
    const dMatrix = (sx1 * dy2 - sx2 * dy1) / determinant
    const e = d[0][0] - a * s[0][0] - c * s[0][1]
    const f = d[0][1] - b * s[0][0] - dMatrix * s[0][1]
    ctx.save()
    ctx.beginPath()
    ctx.moveTo(d[0][0], d[0][1])
    ctx.lineTo(d[1][0], d[1][1])
    ctx.lineTo(d[2][0], d[2][1])
    ctx.closePath()
    ctx.clip()
    ctx.transform(a, b, c, dMatrix, e, f)
    ctx.drawImage(image, 0, 0)
    ctx.restore()
  }
}
