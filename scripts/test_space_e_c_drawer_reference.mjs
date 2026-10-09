import assert from 'node:assert/strict'
import { readFileSync, statSync } from 'node:fs'
import { Script } from 'node:vm'
const lab = readFileSync('docs/space/G0B_motion_lab_20261009.html', 'utf8')
const app = readFileSync('src/components/AISpace.tsx', 'utf8')
const manifest = readFileSync('public/space/layered/manifest.json', 'utf8')
const extractor = readFileSync('scripts/g0a_extract_c_drawer_depth.py', 'utf8')
const asset = 'public/space/layered/e_drawer_pixel_trial_v1.webp'
const size = statSync(asset).size
assert.ok(size > 2500 && size < 300000, 'staged E source cutout must be nonempty and within budget')
const binary = readFileSync(asset)
assert.equal(binary.toString('ascii', 0, 4), 'RIFF')
assert.equal(binary.toString('ascii', 8, 12), 'WEBP')
assert.match(lab, /e_drawer_pixel_trial_v1\.webp/)
assert.match(lab, /id="use-c-drawer"/)
assert.match(lab, /id="c-source"/)
assert.match(lab, /const C_CROP = \{ x: 435, y: 1325, width: 506, height: 347 \}/)
assert.match(lab, /const C_POLY =/)
assert.match(lab, /c\.translate\(E_CROP\.x - 24\*drawerProgress,E_CROP\.y - 45\*drawerProgress\)/,
  'E wooden front moves in native perspective without changing the fixed desk')
assert.match(lab, /c\.scale\(1,1 \+ \.10\*drawerProgress\)/,
  'E drawer face has mild depth scaling')
assert.match(lab, /c\.globalAlpha=Math\.min\(1,drawerProgress\*3\)/,
  'drawer inner depth must fade, not appear at once')
assert.match(lab, /c\.moveTo\(441,1423\)/, 'C inner clip is separate from E wooden front')
assert.match(lab, /c\.moveTo\(4,34\)/, 'wood-only clip prevents duplicate wax seal')
assert.match(lab, /c\.translate\(0,drawerProgress\*119\)/,
  'E original motion comparison remains separate')
assert.match(lab, /URL\.revokeObjectURL\(url\)/, 'local image URLs are released')
assert.match(extractor, /EXPERIMENT_ONLY_NOT_VISUALLY_APPROVED/)
assert.match(extractor, /if destination\.exists\(\):/)
assert.match(extractor, /if "public" in destination\.parts:/)
assert.doesNotMatch(app, /e_drawer_pixel_trial_v1|nativeCDrawer|c_drawer_fullopen/)
assert.doesNotMatch(manifest, /e_drawer_pixel_trial_v1|c_drawer_fullopen/)
assert.doesNotMatch(lab, /fetch\(|localStorage|sessionStorage|api\.eluvin|https?:\/\//)
const inline = lab.match(/<script type="module">([\s\S]*?)<\/script>/)
assert.ok(inline)
new Script(inline[1])
console.log('[G0 A/B] E sprite and C hidden depth are staged but not active: PASS')
