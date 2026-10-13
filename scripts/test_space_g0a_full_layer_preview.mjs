import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { execFileSync } from 'node:child_process'

const path='scripts/g0a_full_layer_preview.py'
const source=readFileSync(path,'utf8')
execFileSync('python3',['-c',
  "import ast,sys;ast.parse(open(sys.argv[1],encoding='utf-8').read())",path])
assert.match(source,/public\/space\/layered\/room-content-clean-v2\.webp/)
assert.match(source,/public\/space\/layered\/room-content-cavity-v2\.webp/)
assert.match(source,/public\/space\/layered\/e_drawer_hq_v2\.webp/)
assert.match(source,/public\/space\/layered\/c_drawer_inner_hq_v3\.webp/)
assert.match(source,/spaceDrawerComposite\.ts/)
assert.match(source,/spaceDrawerFaceMesh\.ts/)
assert.match(source,/window\.G0A\.paintSpaceDrawer/)
assert.match(source,/window\.G0A\.spaceDrawerCavityAlpha/)
assert.match(source,/Math\.max\(width\/W,height\/H\)/)
assert.match(source,/WORLD = \(941, 1672\)/)
assert.match(source,/STAGES = \(0, 0\.25, 0\.5, 0\.75, 1\.0\)/)
assert.match(source,/VIEWPORTS = \(\(390, 844\), \(390, 690\), \(430, 932\)\)/)
assert.match(source,/manifest\.get\('enabled'\) or manifest\.get\('artApproved'\)/)
assert.doesNotMatch(source,/http[s]?:\/\/|localStorage|fetch\(|deletePhoto|api\/state/)
const css=readFileSync('src/styles/space.css','utf8')
assert.match(css,/clip-path: polygon\(44% 77%, 100% 77%, 100% 100%, 44% 100%\)/)
assert.match(css,/clip-path: polygon\(52\.0723% 85\.6459%, 100% 90\.7919%, 100% 95\.8732%, 52\.0723% 89\.8923%\)/)
console.log('[G0-A] real-repo 3x5 browser renderer uses the actual E/C TS painter and scoped cavity: PASS')
