/** Local, unapproved art review of the REAL App, including its normal gates.
 * Does not export credentials, alter manifest, or deploy anything.
 * node scripts/space_v2_app_review.mjs [--serve]
 * Always generates a fresh OS temporary directory, never overwrites dist.
 */
import { build, preview } from 'vite'
import { mkdtempSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

if (process.argv.slice(2).some(arg => arg !== '--serve')) {
  throw new Error('Only --serve is supported; output is always a fresh temporary directory')
}
const manifestPath = 'public/space/layered/manifest.json'
const originalManifest = readFileSync(manifestPath, 'utf8')
const manifest = JSON.parse(originalManifest)
if (manifest.enabled || manifest.artApproved) throw new Error('Review requires both production art gates to stay closed')
const reviewDir = mkdtempSync(join(tmpdir(), 'eluvin-space-art-review-'))
await build({
  mode: 'space-art-review',
  build: { outDir: reviewDir, emptyOutDir: false },
  plugins: [{
    name: 'local-unapproved-space-review-label',
    transformIndexHtml(html) {
      return html.replace('</head>', '<meta name="space-art-review" content="UNAPPROVED_LOCAL_REVIEW_ONLY"></head>')
        .replace('<body>', '<body><aside style="position:fixed;top:4px;left:4px;z-index:2147483647;pointer-events:none;padding:3px 7px;border-radius:6px;background:#fff2d9e8;color:#623f26;font:11px sans-serif">本地美术候选 · 未签收</aside>')
    },
  }],
})
if (readFileSync(manifestPath, 'utf8') !== originalManifest
    || readFileSync(join(reviewDir, 'space/layered/manifest.json'), 'utf8') !== originalManifest) {
  throw new Error('Review may not change either source or packaged manifest')
}
console.log(JSON.stringify({ kind: 'UNAPPROVED_LOCAL_APP_ART_REVIEW', reviewDir,
  loginAndConsentRequired: true, productionManifestChanged: false }, null, 2))
if (process.argv.includes('--serve')) {
  const server = await preview({ mode: 'space-art-review', build: { outDir: reviewDir },
    preview: { host: 'localhost', port: 5173, strictPort: true } })
  server.printUrls()
}
