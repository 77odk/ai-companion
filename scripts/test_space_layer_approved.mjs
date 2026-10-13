import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { isSpaceLayerManifestReady } from '../src/lib/spaceSceneAssets.ts'

const shipped = JSON.parse(readFileSync('public/space/layered/manifest.json', 'utf8'))
assert.equal(shipped.enabled, true, 'owner approved enabling new art')
assert.equal(shipped.artApproved, true, 'owner art decision is explicit')
assert.equal(isSpaceLayerManifestReady(shipped), true)
assert.equal(isSpaceLayerManifestReady({ ...shipped, enabled: false }), false)
assert.equal(isSpaceLayerManifestReady({ ...shipped, artApproved: false }), false)
console.log('[Space Layer] approved shipped manifest and both fail-closed gates: PASS')
