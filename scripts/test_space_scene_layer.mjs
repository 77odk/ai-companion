import assert from 'node:assert/strict'
import { isSpaceLayerManifestReady, SPACE_LAYER_REQUIRED, SPACE_LAYER_VERSION } from '../src/lib/spaceSceneAssets.ts'
import { readFileSync } from 'node:fs'

const manifest = JSON.parse(readFileSync('public/space/layered/manifest.json', 'utf8'))
assert.equal(manifest.enabled, false, 'incomplete asset set must never become the active scene')
assert.equal(isSpaceLayerManifestReady(manifest), false)
assert.equal(isSpaceLayerManifestReady({ ...manifest, enabled: true }), true)
assert.equal(isSpaceLayerManifestReady({ ...manifest, enabled: true, assets: ['room-closed.webp'] }), false)
assert.equal(isSpaceLayerManifestReady({ ...manifest, enabled: true, version: 'wrong' }), false)
assert.equal(isSpaceLayerManifestReady(null), false)
assert.equal(isSpaceLayerManifestReady({ enabled: true, version: SPACE_LAYER_VERSION, assets: [...SPACE_LAYER_REQUIRED] }), true)
console.log('[Space Layer] the new sprite scene stays off until all assets are confirmed: PASS')
