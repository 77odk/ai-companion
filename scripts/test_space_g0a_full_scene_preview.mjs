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
  'assert set(m["OBJECTS"])=={"book","jar","player","earphones"}',
  'assert set(m["BOXES"])==set(m["OBJECTS"])',
].join(';'), name])
assert.match(src,/g0a_full_layer_preview as drawer/)
assert.match(src,/open_book\.png/)
assert.match(src,/glass_memory_jar\.png/)
assert.match(src,/tablet_player\.png/)
assert.match(src,/wired_earphones\.png/)
assert.match(src,/drawer\.STAGES=\(0,0\.5,1\.0\)/)
assert.match(src,/drawContain\(ctx,imgs\[k\],objectBoxes\[k\]\)/)
assert.match(src,/\['book','jar','player','earphones'\]/)
assert.match(src,/no fabricated photos or user content/i)
assert.match(src,/real user photos, personal memories and live music/)
assert.doesNotMatch(src,/faker|sample-photo|placeholder-image|localStorage|fetch\(/)
const m=JSON.parse(readFileSync('public/space/layered/manifest.json','utf8'))
assert.equal(m.enabled,false)
assert.equal(m.artApproved,false)
console.log('[G0-A] real-object empty-account gallery is isolated from user data: PASS')
