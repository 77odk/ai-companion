import { mkdir, writeFile, readFile, mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createHash } from 'node:crypto'
import { openBrowser, startVite } from './space3d-browser.mjs'

const sizes = [{ name:'phone',width:390,height:844 },{ name:'small-phone',width:360,height:800 },{ name:'desktop',width:1280,height:800 }]
const modes = [{ name:'overview',label:'总览' },{ name:'reading',label:'阅读' },{ name:'drawer',label:'抽屉' }]
const baselinePath='docs/space3d-validation/baselines'
const update=process.argv.includes('--update-baselines')
const existing=await readFile(`${baselinePath}/manifest.json`,'utf8').then(JSON.parse).catch(()=>null)
const path=process.env.SPACE3D_SCREENSHOT_DIR || (update||!existing?baselinePath:await mkdtemp(join(tmpdir(),'space3d-screenshots-')))
const server=await startVite(),browser=await openBrowser()
const errors=[]
browser.onEvent(event=>{if(event.method==='Runtime.exceptionThrown')errors.push(event.params.exceptionDetails.exception?.description ?? event.params.exceptionDetails.text)
  if(event.method==='Log.entryAdded'&&event.params.entry.level==='error')errors.push(event.params.entry.text)})
try {
  await mkdir(path,{recursive:true});await browser.cdp('Log.enable')
  await browser.cdp('Emulation.setEmulatedMedia',{features:[{name:'prefers-reduced-motion',value:'reduce'}]})
  await browser.cdp('Page.addScriptToEvaluateOnNewDocument',{source:'Object.defineProperty(navigator,"hardwareConcurrency",{get:()=>8})'})
  const manifest={time:'2026-06-21T04:00:00Z',city:'北京',timezone:'Asia/Shanghai',cloudcover:15,weatherCode:0,
    dpr:1,shadowSize:1024,hardwareConcurrency:8,reducedMotion:true,syntheticContent:true,source:'Chromium SwiftShader',chromium:(await browser.cdp('Browser.getVersion')).product,files:[]}
  for(const size of sizes){
    await browser.cdp('Emulation.setDeviceMetricsOverride',{width:size.width,height:size.height,deviceScaleFactor:1,mobile:size.width<500})
    await browser.cdp('Page.navigate',{url:`${server.origin}/tools/space3d-visual/?space3dMetrics=1&space3dTest=1`})
    await browser.waitFor('window.visualReady === true && !!document.querySelector("canvas")')
    await browser.waitFor('document.fonts.status === "loaded"')
    await browser.waitFor('window.__space3dTest?.stats().mapsPending === 0 && window.__space3dTest.stats().pageTextures === 2')
    for(const mode of modes){
      await browser.evaluate(`[...document.querySelectorAll('button')].find(b=>b.textContent===${JSON.stringify(mode.label)}).click()`)
      await browser.waitFor(`JSON.parse(document.querySelector('.space3d-metrics').textContent).mode === ${JSON.stringify(mode.name)}`)
      await browser.evaluate('new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))')
      const overflow=await browser.evaluate('document.documentElement.scrollWidth > innerWidth')
      if(overflow)throw new Error(`Horizontal overflow at ${size.name}/${mode.name}`)
      if(await browser.evaluate('window.visualFailure'))throw new Error('Scene fell back during screenshot')
      // Diagnostics remain in JSON; baseline imagery excludes the debug output.
      await browser.evaluate('document.querySelector(".space3d-metrics").style.visibility="hidden"')
      const shot=await browser.cdp('Page.captureScreenshot',{format:'png',captureBeyondViewport:false})
      const file=`${size.name}-${mode.name}.png`,data=Buffer.from(shot.data,'base64');await writeFile(`${path}/${file}`,data)
      const metrics=await browser.evaluate('JSON.parse(document.querySelector(".space3d-metrics").textContent)')
      if(metrics.calls>100||metrics.triangles>100000)throw new Error(`Geometry budget exceeded: ${JSON.stringify(metrics)}`)
      if(mode.name==='reading'&&(metrics.pageWidth<280||metrics.pageWidth>320))throw new Error(`Projected page width outside contract: ${metrics.pageWidth}`)
      manifest.files.push({file,...size,mode:mode.name,sha256:createHash('sha256').update(data).digest('hex'),metrics})
    }
  }
  if(errors.length)throw new Error(errors.join('\n'))
  await writeFile(`${path}/manifest.json`,JSON.stringify(manifest,null,2)+'\n')
  console.log(`Saved ${manifest.files.length} screenshots, no page errors or horizontal overflow.`)
  console.log(`Output: ${path}`)
  if(existing&&!update){
    const differences=manifest.files.filter(file=>existing.files.find(baseline=>baseline.file===file.file)?.sha256!==file.sha256)
    console.log(`Compared to committed baseline: ${differences.length} differing images.`)
    if(differences.length)throw new Error(`Visual differences: ${differences.map(file=>file.file).join(', ')}. Inspect output; only --update-baselines replaces committed assets.`)
  }
} finally {server.close();await browser.close()}
