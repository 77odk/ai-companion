import assert from 'node:assert/strict'
import { SPACE_PLAYER_FRAME, SPACE_PLAYER_SCREEN, spaceObjectScreenMatrix } from '../src/lib/spaceObjectFocus.ts'

// Verify projection geometry, rather than comparing hard-coded CSS strings.
// The browser also uses this matrix to map pointer input back into controls.
for (const width of [280, 326, 366, 406, 430]) {
  const height = width * SPACE_PLAYER_FRAME.height / SPACE_PLAYER_FRAME.width
  const matrix = spaceObjectScreenMatrix(width, height)
  assert.equal(matrix.length, 16)
  assert.ok(matrix.every(Number.isFinite))
  const project = (x, y) => {
    const w = matrix[3] * x + matrix[7] * y + matrix[15]
    assert.ok(w > 0, 'the visible control plane must never cross the camera')
    return [(matrix[0] * x + matrix[4] * y + matrix[12]) / w,
      (matrix[1] * x + matrix[5] * y + matrix[13]) / w]
  }
  const corners = [[0, 0], [width, 0], [width, height], [0, height]]
  corners.forEach(([x, y], i) => {
    const actual = project(x, y)
    const expected = SPACE_PLAYER_SCREEN[i].map((value, axis) =>
      (value - (axis ? SPACE_PLAYER_FRAME.y : SPACE_PLAYER_FRAME.x)) * width / SPACE_PLAYER_FRAME.width)
    actual.forEach((value, axis) => assert.ok(Math.abs(value - expected[axis]) < 1e-8))
  })
  for (let y = 0; y <= height; y += height / 10) {
    for (let x = 0; x <= width; x += width / 10) {
      const [px, py] = project(x, y)
      assert.ok(px >= 0 && px <= width && py >= 0 && py <= height, 'controls must stay on the physical screen')
    }
  }
}
assert.throws(() => spaceObjectScreenMatrix(0, 100))
assert.throws(() => spaceObjectScreenMatrix(100, -1))
console.log('[Space object focus] native screen geometry stays inside the tablet at mobile sizes')
