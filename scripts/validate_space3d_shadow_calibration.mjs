import assert from 'node:assert/strict'
import { mkdir,writeFile,readFile } from 'node:fs/promises'
import { openBrowser,startVite } from './space3d-browser.mjs'
import { qualitySettings } from '../src/lib/space3d/quality.ts'

const server=await startVite(),browser=await openBrowser(),path='docs/space3d-validation/shadow-calibration'
try{
 await mkdir(path,{recursive:true})
 await browser.cdp('Emulation.setDeviceMetricsOverride',{width:390,height:844,deviceScaleFactor:1,mobile:true})
 await browser.cdp('Emulation.setEmulatedMedia',{features:[{name:'prefers-reduced-motion',value:'reduce'}]})
 await browser.cdp('Page.navigate',{url:server.origin+'/tools/space3d-visual/?space3dTest=1'})
 await browser.waitFor('window.__space3dTest?.stats().mapsPending===0&&window.__space3dTest.stats().photosPending===0&&window.__space3dTest.stats().pageTextures===2')
 await browser.evaluate(`window.__space3dTest.environment({...window.visualFixture.weather,utcTimestamp:Date.parse('2026-12-21T05:30:00Z')})`)
 const hardwareConcurrency=await browser.evaluate('navigator.hardwareConcurrency')
 const source=await readFile('src/lib/space3d/scene.js','utf8'),report={source:'Chromium SwiftShader',time:'2026-12-21T05:30:00Z',timezone:'Asia/Shanghai',width:390,height:844,dpr:1,hardwareConcurrency,
  shadowSize:qualitySettings(0,hardwareConcurrency<=4,hardwareConcurrency>=8).shadowSize,
  bias:Number(source.match(/shadow\.bias=([^;]+)/)[1]),normalBias:Number(source.match(/shadow\.normalBias=([^\n]+)/)[1]),radius:Number(source.match(/sun\.shadow\.radius=([^\n]+)/)[1]),captures:[]}
 for(const [file,step]of[['shadow-on-390.png',0],['shadow-off-390.png',1]]){
  await browser.evaluate(`window.__space3dTest.quality(${step})`)
  await browser.evaluate('new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)))')
  const metrics=await browser.evaluate('window.__space3dTest.stats()')
  assert.equal(metrics.shadows,step===0);assert.ok(metrics.calls<=100);assert.ok(metrics.triangles<=100000)
  const shot=await browser.cdp('Page.captureScreenshot',{format:'png'});await writeFile(path+'/'+file,Buffer.from(shot.data,'base64'))
  report.captures.push({file,metrics})
 }
 await writeFile(path+'/report.json',JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify(report))
}finally{server.close();await browser.close()}
