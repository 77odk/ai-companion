import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { execFileSync } from 'node:child_process'

const path = 'scripts/g1_space_mobile_smoke.py'
const source = readFileSync(path, 'utf8')
execFileSync('python3', ['-c', [
  'import ast,runpy,sys',
  'p=sys.argv[1]',
  'ast.parse(open(p, encoding="utf-8").read())',
  'm=runpy.run_path(p,run_name="__g1_test__")',
  'assert m["VIEWPORTS"] == ((390,844),(390,690),(430,932))',
  'assert m["origin_is_safe"]("http://127.0.0.1:4173")',
  'assert m["origin_is_safe"]("http://localhost:5173")',
  'assert not m["origin_is_safe"]("https://eluvin.space")',
  'assert not m["origin_is_safe"]("http://example.com")',
  'assert not m["origin_is_safe"]("file:///tmp/stage.html")',
].join(';'), path], { encoding: 'utf8' })

assert.match(source, /BLOCKED_AUTH_OR_CONSENT/, 'the smoke may not bypass an auth wall')
assert.match(source, /LAYERED_RUNTIME_SMOKE_ONLY/, 'do not equate a paint check with visual signoff')
assert.match(source, /FALLBACK_SMOKE_ONLY/, 'closed art gate is a separate G1 result')
assert.match(source, /G1_BROWSER_PREFLIGHT_NOT_VISUAL_SIGNOFF/)
assert.match(source, /storage_state/, 'test user must provide their own existing auth state')
assert.match(source, /page\.on\("pageerror"/)
assert.match(source, /page\.on\("console"/)
assert.match(source, /drawerVisibleArea/)
assert.match(source, /documentWidth/)
assert.match(source, /brokenBackplates/)
assert.match(source, /if screenshots:/, 'potential user content screenshot only on explicit opt-in')
assert.doesNotMatch(source, /\b(add_local_photo|save_local|deletePhoto|setItem|post\(|put\()\b/)
const manifest = JSON.parse(readFileSync('public/space/layered/manifest.json', 'utf8'))
assert.equal(manifest.enabled, false, 'G1 preflight must not open an unapproved visual gate')
assert.equal(manifest.artApproved, false)
console.log('[Space G1] local-only read-only 3-screen smoke and closed art-gate checks: PASS')
