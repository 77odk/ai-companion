import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import {
  SPACE_DRAWER_ART_ROI, paintSpaceDrawer, drawerFrameProgress, spaceDrawerAperture, spaceDrawerCavityAlpha,
} from '../src/lib/spaceDrawerComposite.ts'

const noop = {}
function makeCanvas() {
  let depth = 0
  const calls = []
  const canvas = {
    calls,
    get depth() { return depth },
    globalAlpha: 1,
    save() { depth++ },
    restore() { assert.ok(depth > 0); depth-- },
    beginPath() {}, closePath() {}, clip() {},
    moveTo(x,y) { assert.ok(Number.isFinite(x) && Number.isFinite(y)) },
    lineTo(x,y) { assert.ok(Number.isFinite(x) && Number.isFinite(y)) },
    clearRect(...args) { calls.push(['clear', ...args]) },
    translate(...args) { assert.ok(args.every(Number.isFinite)); calls.push(['shift',...args]) },
    transform(...args) { assert.ok(args.every(Number.isFinite)); calls.push(['matrix',...args]) },
    drawImage(...args) { assert.ok(args.slice(1).every(Number.isFinite)); calls.push(['image',this.globalAlpha,...args.slice(1)]) },
  }
  return canvas
}
const art = { face: noop, interior: noop }
assert.deepEqual(SPACE_DRAWER_ART_ROI, {x:427,y:1309,width:514,height:363})
assert.deepEqual(spaceDrawerAperture(0), {leftTop:1452,rightTop:1546})
assert.deepEqual(spaceDrawerAperture(1), {leftTop:1342,rightTop:1396})
assert.deepEqual(spaceDrawerAperture(Number.NaN), spaceDrawerAperture(0))
assert.equal(spaceDrawerCavityAlpha(0), 0)
assert.equal(spaceDrawerCavityAlpha(0.05), 0.1)
assert.equal(spaceDrawerCavityAlpha(0.25), 0.5)
assert.equal(spaceDrawerCavityAlpha(0.5), 1)
assert.equal(spaceDrawerCavityAlpha(1), 1)
assert.equal(spaceDrawerCavityAlpha(-1), 0)
assert.equal(spaceDrawerCavityAlpha(Number.NaN), 0)
assert.equal(spaceDrawerCavityAlpha(Infinity), 0)
assert.deepEqual(spaceDrawerAperture(200), spaceDrawerAperture(1))
for (const p of [.1,.25,.5,.75,.9]) {
  const { leftTop,rightTop } = spaceDrawerAperture(p)
  assert.ok(leftTop >= 1342 && leftTop <= 1452)
  assert.ok(rightTop >= 1396 && rightTop <= 1546)
  assert.ok(rightTop > leftTop, 'aperture stays aligned with E desktop perspective')
}
for (const t of [-1,0,0.001,.25,.5,.75,1,2,NaN,Infinity]) {
  const c = makeCanvas()
  paintSpaceDrawer(c, art, t)
  assert.equal(c.depth, 0, 'save/restore must always balance')
  assert.deepEqual(c.calls[0], ['clear',0,0,514,363])
  if (!Number.isFinite(t) || t <= 0) {
    assert.equal(c.calls.filter(x=>x[0]==='image').length,0)
  } else {
    assert.equal(c.calls.filter(x=>x[0]==='image').length,33, '1 C depth + 32 E texture strips')
    assert.equal(c.calls.filter(x=>x[0]==='matrix').length,32)
  }
}
// A deliberate reveal curve: early drag shows the cavity before the
// letter stack; halfway exposes most letters; fully open never pops.
const early = makeCanvas(), middle = makeCanvas(), finish = makeCanvas()
paintSpaceDrawer(early, art, .25)
paintSpaceDrawer(middle, art, .5)
paintSpaceDrawer(finish, art, 1)
const contentsAlpha = c => c.calls.find(row=>row[0]==='image')[1]
assert.ok(contentsAlpha(early) > 0.1 && contentsAlpha(early) < .3)
assert.ok(contentsAlpha(middle) > .6 && contentsAlpha(middle) < .8)
assert.equal(contentsAlpha(finish),1)
for (const [ms,lo,hi] of [[0,0,0],[100,.3,.4],[380,.87,.88],[760,1,1],[2000,1,1]]) {
  const p=drawerFrameProgress(ms)
  assert.ok(p>=lo && p<=hi, 'unexpected easing at '+ms+'ms: '+p)
}
assert.ok(drawerFrameProgress(200) < drawerFrameProgress(400))
assert.equal(drawerFrameProgress(400,0),1)
assert.equal(drawerFrameProgress(Number.NaN),0)
const source=readFileSync('src/lib/spaceDrawerComposite.ts','utf8')
assert.doesNotMatch(source,/fetch\(|localStorage|sessionStorage|new Image\(/)
assert.match(source,/const strips = 32/, 'small ROI contains perspective, not the entire desk')
console.log('[Space V2] E face + C inner drawer comp / transform bounds / cubic easing: PASS')
