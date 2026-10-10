import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { build } from 'vite'

const manifest = JSON.parse(readFileSync('public/space/layered/manifest.json', 'utf8'))
assert.equal(manifest.enabled, false)
assert.equal(manifest.artApproved, false)
const originalFetch = globalThis.fetch
const originalImage = globalThis.Image
let fixtureManifest = structuredClone(manifest)
let broken = false
let loaded = 0
globalThis.fetch = async () => ({ ok: true, json: async () => fixtureManifest })
// Resource-loader unit doubles only; no auth/user data or visual signoff.
globalThis.Image = class {
  naturalWidth = 941
  naturalHeight = 1672
  set src(value) {
    loaded++
    queueMicrotask(() => broken && value.endsWith('foliage-alpha-v2.webp') ? this.onerror() : this.onload())
  }
}
try {
  for (const mode of ['production', 'space-art-review']) {
    const output = await build({ configFile: false, publicDir: false, logLevel: 'silent', mode,
      build: { write: false, lib: { entry: 'src/lib/spaceSceneAssets.ts', formats: ['es'] } } })
    const files = Array.isArray(output) ? output.flatMap(item => item.output) : output.output
    const file = files.find(item => item.type === 'chunk')
    const module = await import('data:text/javascript;base64,' + Buffer.from(file.code).toString('base64'))
    assert.equal(module.SPACE_ART_REVIEW_BUILD, mode === 'space-art-review')
    assert.equal(module.isSpaceLayerManifestReady(manifest), false, 'review must never label artwork approved')
    assert.equal(await module.preloadSpaceLayer(), mode === 'space-art-review')
    if (mode === 'production') assert.equal(loaded, 0, 'normal build must keep unapproved assets inactive')
    else {
      assert.equal(loaded, module.SPACE_LAYER_REQUIRED.length)
      broken = true
      assert.equal(await module.preloadSpaceLayer(), false, 'review still fails closed on missing real assets')
      broken = false
      fixtureManifest = { ...manifest, version: 'wrong' }
      assert.equal(await module.preloadSpaceLayer(), false)
      fixtureManifest = { ...manifest, assets: [] }
      assert.equal(await module.preloadSpaceLayer(), false)
    }
  }
} finally {
  globalThis.fetch = originalFetch
  globalThis.Image = originalImage
}
assert.deepEqual(JSON.parse(readFileSync('public/space/layered/manifest.json', 'utf8')), manifest)
const builder = readFileSync('scripts/space_v2_app_review.mjs', 'utf8')
assert.match(builder, /mkdtempSync\(join\(tmpdir\(\)/, 'review output always uses a fresh temporary directory')
assert.match(builder, /UNAPPROVED_LOCAL_REVIEW_ONLY/)
assert.match(builder, /strictPort: true/)
console.log('[Space art review] compile-time-only preview, unchanged production gate, and resource failures: PASS')
