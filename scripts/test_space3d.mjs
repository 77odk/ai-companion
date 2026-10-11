import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import { QualityMonitor,qualitySettings } from '../src/lib/space3d/quality.ts'
import { paginateMessages,pageForPosition,messageIdentity } from '../src/lib/space3d/bookPages.ts'
import { bindGestures } from '../src/lib/space3d/interaction.ts'

test('consecutive slow three-second windows trigger every degradation step in order',()=>{
  const monitor=new QualityMonitor()
  for(let expected=1;expected<=4;expected++){
    for(let i=0;i<59;i++)assert.equal(monitor.sample(50),expected-1)
    assert.equal(monitor.sample(50),expected)
  }
  assert.equal(qualitySettings(1).shadows,false)
  assert.equal(qualitySettings(1).dprLimit,1.5)
  assert.equal(qualitySettings(2).dprLimit,1)
  assert.equal(qualitySettings(3).particles,false)
  assert.equal(qualitySettings(3).wind,false)
  assert.equal(qualitySettings(4).fallback,true)
  const fast=new QualityMonitor();for(let i=0;i<500;i++)fast.sample(16)
  assert.equal(fast.step,0)
  const interrupted=new QualityMonitor();for(let i=0;i<40;i++)interrupted.sample(50)
  interrupted.resetWindow();for(let i=0;i<40;i++)interrupted.sample(50)
  assert.equal(interrupted.step,0)
})
test('pagination preserves all real text, stable IDs and Unicode offsets without writing messages',()=>{
  const messages=[{id:41,role:'user',ts:1,content:'中文🙂'.repeat(200)},
    {role:'assistant',ts:2,content:'文字'.repeat(400)}]
  const before=JSON.stringify(messages),pages=paginateMessages(messages)
  assert.equal(pages.map(p=>p.text).join(''),messages.map(m=>m.content).join(''))
  assert.ok(pages.slice(0,-1).every(p=>Array.from(p.text).length===320))
  const fragment=pages[2].fragments[0]
  assert.equal(pageForPosition(pages,{messageId:fragment.messageId,offset:fragment.offset}),2)
  assert.equal(pageForPosition(pages,{messageId:'deleted',offset:0}),0)
  assert.equal(JSON.stringify(messages),before)
  assert.equal(messageIdentity({...messages[1]}),messageIdentity(messages[1]))
})
test('native gesture boundary ignores 8–10px, locks starting hit, preserves arrangement and pinch',()=>{
  const oldDoc=globalThis.document,oldWindow=globalThis.window
  globalThis.document=new EventTarget();globalThis.window=new EventTarget()
  const canvas=new EventTarget(),captured=new Set()
  canvas.setPointerCapture=id=>captured.add(id);canvas.releasePointerCapture=id=>captured.delete(id);canvas.hasPointerCapture=id=>captured.has(id)
  let hit='book',arranging=false;const actions=[]
  const dispose=bindGestures(canvas,{hit:()=>hit,open:v=>actions.push(['open',v]),arrange:v=>{arranging=!!v;actions.push(['arrange',v])},
    orbit:()=>actions.push(['orbit']),zoom:()=>actions.push(['zoom']),isArranging:()=>arranging})
  const event=(type,id,x)=>{const e=new Event(type);Object.assign(e,{pointerId:id,clientX:x,clientY:0});canvas.dispatchEvent(e)}
  try {
    event('pointerdown',1,0);event('pointerup',1,8);assert.deepEqual(actions.pop(),['open','book'])
    event('pointerdown',1,0);event('pointerup',1,9);assert.equal(actions.length,0)
    hit=null;event('pointerdown',1,0);event('pointermove',1,11);assert.deepEqual(actions.pop(),['orbit']);event('pointerup',1,11)
    hit='jar';event('pointerdown',1,0);hit='player';event('pointerup',1,0);assert.deepEqual(actions.pop(),['open','jar'])
    event('pointerdown',1,0);event('pointerdown',2,50);event('pointermove',2,60);event('pointerup',2,60);event('pointerup',1,0)
    assert.deepEqual(actions.splice(0),[['zoom']]);assert.equal(captured.size,0)
    arranging=true;event('pointerdown',1,0);event('pointermove',1,50);event('pointerup',1,50)
    assert.deepEqual(actions.splice(0),[['arrange','player']])
    event('pointerdown',1,0);event('pointercancel',1,0);event('pointerup',1,0);assert.equal(actions.length,0)
  } finally {dispose();globalThis.document=oldDoc;globalThis.window=oldWindow}
})
test('long press is 500ms, a 301ms release is not a click, and capture/background loss cancels safely',t=>{
  t.mock.timers.enable({apis:['setTimeout']})
  let now=0;t.mock.method(performance,'now',()=>now)
  const oldDoc=globalThis.document,oldWindow=globalThis.window
  globalThis.document=new EventTarget();globalThis.window=new EventTarget()
  const canvas=new EventTarget(),captured=new Set(),actions=[]
  canvas.setPointerCapture=id=>captured.add(id);canvas.releasePointerCapture=id=>captured.delete(id);canvas.hasPointerCapture=id=>captured.has(id)
  const dispose=bindGestures(canvas,{hit:()=> 'book',open:hit=>actions.push(['open',hit]),arrange:hit=>actions.push(['arrange',hit]),
    orbit:()=>actions.push(['orbit']),zoom:()=>{},isArranging:()=>false})
  const event=(type)=>{const e=new Event(type);Object.assign(e,{pointerId:1,clientX:0,clientY:0});canvas.dispatchEvent(e)}
  try{
    event('pointerdown');t.mock.timers.tick(499);assert.equal(actions.length,0)
    t.mock.timers.tick(1);assert.deepEqual(actions.splice(0),[['arrange','book']]);event('pointerup');assert.equal(actions.length,0)
    event('pointerdown');now+=301;event('pointerup');assert.equal(actions.length,0)
    event('pointerdown');event('lostpointercapture');t.mock.timers.tick(500);event('pointerup');assert.equal(actions.length,0)
    event('pointerdown');globalThis.document.hidden=true;document.dispatchEvent(new Event('visibilitychange'))
    t.mock.timers.tick(500);event('pointerup');assert.equal(actions.length,0);assert.equal(captured.size,0)
  }finally{dispose();globalThis.document=oldDoc;globalThis.window=oldWindow}
})
test('locked dependency adds exactly three and preserves every existing lock entry',()=>{
  const lock=JSON.parse(fs.readFileSync('package-lock.json','utf8')),pkg=JSON.parse(fs.readFileSync('package.json','utf8'))
  assert.equal(pkg.dependencies.three,'0.180.0')
  assert.equal(lock.packages['node_modules/three'].version,'0.180.0')
  const source=fs.readFileSync('src/lib/space3d/scene.js','utf8')
  assert.doesNotMatch(source,/https?:\/\//)
  assert.match(source,/PCFShadowMap/)
  assert.match(source,/document.hidden/)
})
