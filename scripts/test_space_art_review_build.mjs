import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { build } from 'vite'

const shippedManifest = JSON.parse(readFileSync('public/space/layered/manifest.json', 'utf8'))
let manifest = { ...JSON.parse(readFileSync('public/space/layered/manifest.json', 'utf8')), enabled: false, artApproved: false }
assert.equal(manifest.enabled, false)
assert.equal(manifest.artApproved, false)
const originalFetch = globalThis.fetch
const originalImage = globalThis.Image
let fixtureManifest = structuredClone(manifest)
let broken = false
let loaded = 0
let deferred = null
globalThis.fetch = async () => ({ ok: true, json: async () => fixtureManifest })
// Resource-loader unit doubles only; no auth/user data or visual signoff.
globalThis.Image = class {
  naturalWidth = 941
  naturalHeight = 1672
  set src(value) {
    loaded++
    const complete = () => broken && value.endsWith('foliage-alpha-v2.webp') ? this.onerror() : this.onload()
    if (deferred) deferred.push(complete)
    else queueMicrotask(complete)
  }
}
try {
  for (const mode of ['production', 'space-art-review']) {
    loaded = 0
    fixtureManifest = structuredClone(manifest)
    const output = await build({ configFile: false, publicDir: false, logLevel: 'silent', mode,
      build: { write: false, lib: { entry: 'src/lib/spaceSceneAssets.ts', formats: ['es'] } } })
    const files = Array.isArray(output) ? output.flatMap(item => item.output) : output.output
    const file = files.find(item => item.type === 'chunk')
    const module = await import('data:text/javascript;base64,' + Buffer.from(file.code).toString('base64'))
    assert.equal(module.SPACE_ART_REVIEW_BUILD, mode === 'space-art-review')
    assert.equal(module.getPreloadedSpaceLayerReady(), false, 'cold mounts must not activate unverified art')
    assert.equal(module.isSpaceLayerManifestReady(manifest), false, 'review must never label artwork approved')
    assert.equal(await module.preloadSpaceLayer(), mode === 'space-art-review')
    assert.equal(module.getPreloadedSpaceLayerReady(), mode === 'space-art-review', 'only a verified load warms the remount snapshot')
    if (mode === 'production') {
      assert.equal(loaded, 0, 'normal build must keep unapproved assets inactive')
      // Loader unit input only: this does not change the shipped manifest.
      fixtureManifest = { ...manifest, enabled: true, artApproved: true }
      assert.equal(await module.preloadSpaceLayer(), true)
      assert.equal(module.getPreloadedSpaceLayerReady(), true)
      fixtureManifest = structuredClone(manifest)
      assert.equal(await module.preloadSpaceLayer(), false)
      assert.equal(module.getPreloadedSpaceLayerReady(), false, 'closing either production gate clears previously verified readiness')
    }
    else {
      assert.equal(loaded, module.SPACE_LAYER_REQUIRED.length)
      broken = true
      assert.equal(await module.preloadSpaceLayer(), false, 'review still fails closed on missing real assets')
      assert.equal(module.getPreloadedSpaceLayerReady(), false, 'a failed revalidation invalidates the snapshot')
      broken = false
      fixtureManifest = { ...manifest, version: 'wrong' }
      assert.equal(await module.preloadSpaceLayer(), false)
      fixtureManifest = { ...manifest, assets: [] }
      assert.equal(await module.preloadSpaceLayer(), false)
      fixtureManifest = structuredClone(manifest)
      assert.equal(await module.preloadSpaceLayer(), true)
      module.invalidateSpaceLayerReady()
      assert.equal(module.getPreloadedSpaceLayerReady(), false, 'a rendered image failure also invalidates the snapshot')
      deferred = []
      const oldLoad = module.preloadSpaceLayer()
      await new Promise(resolve => setTimeout(resolve, 0))
      assert.equal(deferred.length, module.SPACE_LAYER_REQUIRED.length)
      fixtureManifest = { ...manifest, assets: [] }
      assert.equal(await module.preloadSpaceLayer(), false)
      for (const complete of deferred) complete()
      deferred = null
      assert.equal(await oldLoad, true)
      assert.equal(module.getPreloadedSpaceLayerReady(), false, 'an older successful decode must not overwrite a newer failed gate')
    }
  }
} finally {
  globalThis.fetch = originalFetch
  globalThis.Image = originalImage
}
// The loader fixture did not modify the actual approved file.
manifest = shippedManifest
assert.deepEqual(JSON.parse(readFileSync('public/space/layered/manifest.json', 'utf8')), manifest)
const builder = readFileSync('scripts/space_v2_app_review.mjs', 'utf8')
assert.match(builder, /mkdtempSync\(join\(tmpdir\(\)/, 'review output always uses a fresh temporary directory')
assert.match(builder, /UNAPPROVED_LOCAL_REVIEW_ONLY/)
assert.match(builder, /strictPort: true/)
console.log('[Space art review] compile-time-only preview, unchanged production gate, and resource failures: PASS')
