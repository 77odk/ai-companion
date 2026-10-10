import assert from 'node:assert/strict'
import { readFileSync, statSync } from 'node:fs'
import { isSpaceLayerManifestReady } from '../src/lib/spaceSceneAssets.ts'

const manifest = JSON.parse(readFileSync('public/space/layered/manifest.json', 'utf8'))
const requirements = [
  { name: 'e_drawer_hq_v2.webp', width: 481, height: 243, minBytes: 12000 },
  { name: 'c_drawer_depth_hq_v2.webp', width: 506, height: 210, minBytes: 20000 },
]
const readiness = isSpaceLayerManifestReady(manifest)
assert.equal(readiness, manifest.enabled === true && manifest.artApproved === true &&
  requirements.every(({ name }) => manifest.assets.includes(name)),
  'manifest must preserve two independent technical+visual switches')
const pending = []
for (const { name, width, height, minBytes } of requirements) {
  const path = 'public/space/layered/' + name
  const bytes = readFileSync(path)
  assert.equal(bytes.toString('ascii', 0, 4), 'RIFF', name)
  assert.equal(bytes.toString('ascii', 8, 12), 'WEBP', name)
  let dimensions = null
  if (bytes.toString('ascii', 12, 16) === 'VP8X') {
    dimensions = {
      width: 1 + bytes[24] + (bytes[25] << 8) + (bytes[26] << 16),
      height: 1 + bytes[27] + (bytes[28] << 8) + (bytes[29] << 16),
    }
  }
  assert.deepEqual(dimensions, { width, height }, name + ' world-coordinate sprite must keep its native size')
  const size = statSync(path).size
  assert.ok(size > 0 && size < 300000)
  if (readiness) {
    assert.ok(size >= minBytes, name + ': visual-approved assets must not be old highly compressed prototypes')
  } else if (size < minBytes) {
    pending.push(name + ' (' + size + ' bytes)')
  }
}
assert.equal(isSpaceLayerManifestReady({ ...manifest, enabled: true, artApproved: false }), false)
assert.equal(isSpaceLayerManifestReady({ ...manifest, enabled: false, artApproved: true }), false)
if (!readiness) {
  assert.equal(manifest.artApproved, false, 'do not claim artwork approved without QA')
  console.log('[G0-A] visual gate CLOSED; rejected ultra-small sprites:', pending)
} else {
  console.log('[G0-A] sprite byte-size and native geometry safety bounds pass; still require manual visual QA')
}
const exporter = readFileSync('scripts/g0a_export_native_drawer_assets.py','utf8')
assert.match(exporter, /quality=96, method=6, exact=True/)
assert.match(exporter, /G0-A_CANDIDATE_NOT_APPROVED/)
assert.match(exporter, /source hash differs from approved native reference/)
assert.match(exporter, /if "public" in destination\.parts/)
console.log('[G0-A] art activation lock and reproducible pixel-source export: PASS')
