/**
 * Read-only G0-A audit: actual cutout alpha pixels, not merely PNG color-type=6.
 * Node built-ins only. Does not modify, optimize or re-encode public/ assets.
 * Run: node scripts/audit_space_layer_alpha.mjs [directory]
 * Diagnostic output is not approval of the 941x1672 visual baseline.
 */
import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { inflateSync } from 'node:zlib'

function pngInfo(filename) {
  const bytes = readFileSync(filename)
  const signature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])
  if (!bytes.subarray(0, 8).equals(signature)) throw Error('not PNG')
  let width = 0; let height = 0; let position = 8
  const idat = []
  while (position + 12 <= bytes.length) {
    const length = bytes.readUInt32BE(position)
    const tag = bytes.toString('ascii', position + 4, position + 8)
    const end = position + 12 + length
    if (end > bytes.length) throw Error('truncated PNG chunk')
    if (tag === 'IHDR') {
      width = bytes.readUInt32BE(position + 8)
      height = bytes.readUInt32BE(position + 12)
      const depth = bytes[position + 16]
      const color = bytes[position + 17]
      const interlace = bytes[position + 20]
      if (depth !== 8 || color !== 6 || interlace !== 0) throw Error('expected 8-bit non-interlaced RGBA')
    }
    if (tag === 'IDAT') idat.push(bytes.subarray(position + 8, end - 4))
    position = end
    if (tag === 'IEND') break
  }
  if (!width || !height || !idat.length) throw Error('incomplete PNG')
  const stride = width * 4
  const raw = inflateSync(Buffer.concat(idat))
  if (raw.length !== height * (stride + 1)) throw Error('invalid payload length')
  let transparent = 0, partial = 0, opaque = 0, cornerSum = 0, cornerCount = 0
  let borderVisible = 0, borderCount = 0
  let prior = Buffer.alloc(stride)
  let source = 0
  for (let y = 0; y < height; y++) {
    const mode = raw[source++]
    if (mode > 4) throw Error('invalid PNG filter')
    const row = Buffer.from(raw.subarray(source, source + stride))
    source += stride
    for (let k = 0; k < stride; k++) {
      const left = k >= 4 ? row[k - 4] : 0
      const above = prior[k]
      const upperLeft = k >= 4 ? prior[k - 4] : 0
      let add = 0
      if (mode === 1) add = left
      else if (mode === 2) add = above
      else if (mode === 3) add = (left + above) >> 1
      else if (mode === 4) {
        const predict = left + above - upperLeft
        const a = Math.abs(predict - left), b = Math.abs(predict - above), c = Math.abs(predict - upperLeft)
        add = a <= b && a <= c ? left : b <= c ? above : upperLeft
      }
      row[k] = (row[k] + add) & 255
    }
    for (let x = 0; x < width; x++) {
      const alpha = row[x * 4 + 3]
      if (alpha === 0) transparent++
      else if (alpha === 255) opaque++
      else partial++
      if ((x < 5 || x >= width - 5) && (y < 5 || y >= height - 5)) {
        cornerCount++; cornerSum += alpha
      }
      if (x === 0 || x === width - 1 || y === 0 || y === height - 1) {
        borderCount++; if (alpha > 16) borderVisible++
      }
    }
    prior = row
  }
  const cornerMean = cornerSum / Math.max(1, cornerCount)
  const borderVisibleFraction = borderVisible / Math.max(1, borderCount)
  const flags = [
    ...(!transparent ? ['NO_TRANSPARENT_PIXELS'] : []),
    ...(cornerMean > 15 ? ['CORNER_ALPHA_REVIEW'] : []),
    ...(borderVisibleFraction > 0.3 ? ['OUTER_EDGE_REVIEW'] : []),
  ]
  return { width, height, transparent, partial, opaque,
    transparentPercent: +(100 * transparent / (width * height)).toFixed(1),
    cornerMean: +cornerMean.toFixed(1), borderVisiblePercent: +(100 * borderVisibleFraction).toFixed(1), flags }
}
const directory = process.argv[2] ?? 'public/space/layered'
const images = readdirSync(directory).filter((f) => f.toLowerCase().endsWith('.png')).sort()
if (!images.length) throw Error('No PNG images in ' + directory)
const result = {}
for (const file of images) result[file] = pngInfo(join(directory, file))
process.stdout.write(JSON.stringify({ directory, count: images.length, result }, null, 2) + '\n')
