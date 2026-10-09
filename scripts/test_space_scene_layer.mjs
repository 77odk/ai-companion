import assert from 'node:assert/strict'
import { isSpaceLayerManifestReady, SPACE_LAYER_REQUIRED, SPACE_LAYER_VERSION } from '../src/lib/spaceSceneAssets.ts'
import { readFileSync, statSync, existsSync } from 'node:fs'

const manifest = JSON.parse(readFileSync('public/space/layered/manifest.json', 'utf8'))
if (manifest.enabled) {
  assert.equal(isSpaceLayerManifestReady(manifest), true, 'enabled sprite scene must declare all assets')
  for (const filename of SPACE_LAYER_REQUIRED) {
    const path = 'public/space/layered/' + filename
    assert.ok(existsSync(path), 'asset must exist before enabling: ' + path)
    assert.ok(statSync(path).size < 300_000, 'asset exceeds 300KB: ' + path)
    const data = readFileSync(path)
    if (filename.endsWith('.png')) {
      assert.deepEqual([...data.subarray(0, 8)], [137, 80, 78, 71, 13, 10, 26, 10])
      assert.equal(data[25], 6, 'physical sprite requires true RGBA: ' + filename)
    } else {
      assert.equal(data.toString('ascii', 0, 4), 'RIFF')
      assert.equal(data.toString('ascii', 8, 12), 'WEBP')
    }
  }
} else {
  assert.equal(isSpaceLayerManifestReady(manifest), false, 'staging is fail-closed')
}
assert.equal(isSpaceLayerManifestReady({ ...manifest, enabled: true }), true)
assert.equal(isSpaceLayerManifestReady({ ...manifest, enabled: true, assets: ['room-closed.webp'] }), false)
assert.equal(isSpaceLayerManifestReady({ ...manifest, enabled: true, version: 'wrong' }), false)
assert.equal(isSpaceLayerManifestReady(null), false)
assert.equal(isSpaceLayerManifestReady({ enabled: true, version: SPACE_LAYER_VERSION, assets: [...SPACE_LAYER_REQUIRED] }), true)
console.log('[Space Layer] the new sprite scene stays off until all assets are confirmed: PASS')
