import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'

const name = 'scripts/g0a_full_scene_preview.py'
const src = readFileSync(name, 'utf8')
execFileSync('python3', ['-c',[
  'import ast,runpy,sys',
  'p=sys.argv[1]',
  'sys.path.insert(0,str(__import__("pathlib").Path(p).parent.resolve()))',
  'ast.parse(open(p,encoding="utf-8").read())',
  'm=runpy.run_path(p,run_name="__g0a_test__")',
  'assert m["drawer"].ASSETS["closed"]=="public/space/layered/room-content-clean-v2.webp"',
  'assert m["drawer"].ASSETS["cavity"]=="public/space/layered/room-content-cavity-v2.webp"',
].join(';'), name])
assert.match(src,/g0a_full_layer_preview as drawer/)
assert.match(src,/drawer\.STAGES=\(0,0\.5,1\.0\)/)
assert.match(src,/drawer\.run_chrome_cli\(root, output\)/)
assert.doesNotMatch(src,/drawContain|objectBoxes/, 'native plate objects may not receive duplicate cutouts')
assert.match(src,/no fabricated photos or user content/i)
assert.match(src,/real user photos, personal memories and live music/)
assert.doesNotMatch(src,/faker|sample-photo|placeholder-image|localStorage|fetch\(/)
const m=JSON.parse(readFileSync('public/space/layered/manifest.json','utf8'))
assert.equal(m.enabled,false)
assert.equal(m.artApproved,false)
console.log('[G0-A] real-object empty-account gallery is isolated from user data: PASS')
