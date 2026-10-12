import { mkdir, writeFile } from 'node:fs/promises'
import { openBrowser, startVite } from './space3d-browser.mjs'

// Independent quality-card fixture: the historical nine-image baseline remains
// comparable at its original June noon; afternoon/night use explicit overrides.
const output=process.env.SPACE3D_TEXTURE_DIR||'docs/space3d-validation/texture-rework'
const probe=process.argv.includes('--probe')
const sizes=probe?[['phone',390,844]]:[['phone',390,844],['small-phone',360,800],['desktop',1280,800]]
const states=probe?[['afternoon','2026-12-21T05:30:00Z']]:[
  ['afternoon','2026-12-21T05:30:00Z'],['night','2026-06-21T14:00:00Z'],
  ['morning','2026-12-21T00:30:00Z'],['golden','2026-12-21T08:00:00Z']]
const modes=probe?[['overview','总览']]:[['overview','总览'],['reading','阅读'],['drawer','抽屉']]
const server=await startVite(),browser=await openBrowser(),errors=[],files=[]
browser.onEvent(event=>{
  if(event.method==='Runtime.exceptionThrown')errors.push(event.params.exceptionDetails.exception?.description??event.params.exceptionDetails.text)
  if(event.method==='Runtime.consoleAPICalled'&&event.params.type==='error')errors.push(event.params.args.map(x=>x.value||x.description).join(' '))
  if(event.method==='Log.entryAdded'&&event.params.entry.level==='error')errors.push(event.params.entry.text)
})
try{
  await mkdir(output,{recursive:true});await browser.cdp('Log.enable')
  await browser.cdp('Emulation.setEmulatedMedia',{features:[{name:'prefers-reduced-motion',value:'reduce'}]})
  await browser.cdp('Page.addScriptToEvaluateOnNewDocument',{source:'Object.defineProperty(navigator,"hardwareConcurrency",{get:()=>8})'})
  for(const [size,width,height] of sizes){
    await browser.cdp('Emulation.setDeviceMetricsOverride',{width,height,deviceScaleFactor:1,mobile:width<500})
    await browser.cdp('Page.navigate',{url:`${server.origin}/tools/space3d-visual/?space3dMetrics=1&space3dTest=1`})
    await browser.waitFor('window.__space3dTest?.stats().mapsPending===0&&window.__space3dTest.stats().photosPending===0&&window.__space3dTest.stats().pageTextures===2')
    for(const [state,time] of states){
      await browser.evaluate(`Date.now=()=>Date.parse(${JSON.stringify(time)});window.__space3dTest.beginFrameInjection();window.__space3dTest.environment({...window.visualFixture.weather,utcTimestamp:Date.now(),cloudcover:15,weatherCode:0})`)
      for(const [mode,label] of modes){
        await browser.evaluate(`[...document.querySelectorAll('button')].find(b=>b.textContent===${JSON.stringify(label)}).click()`)
        await browser.evaluate('new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)))')
        const metrics=await browser.evaluate('window.__space3dTest.stats()')
        if(metrics.mode!==mode||metrics.calls>100||metrics.triangles>100000)throw Error(JSON.stringify(metrics))
        if(state==='night'&&(metrics.direct!==0||metrics.sunShadow||!metrics.lampShadow))throw Error('Night fixture illumination drifted')
        if(mode==='reading'&&(metrics.pageWidth<280||metrics.pageWidth>320))throw Error('Reading projection outside contract')
        if(await browser.evaluate('document.documentElement.scrollWidth>innerWidth'))throw Error('Horizontal overflow')
        await browser.evaluate('document.querySelector(".space3d-metrics").style.visibility="hidden"')
        const file=`${size}-${state}-${mode}.png`,shot=await browser.cdp('Page.captureScreenshot',{format:'png',captureBeyondViewport:false})
        await writeFile(`${output}/${file}`,Buffer.from(shot.data,'base64'))
        files.push({file,width,height,mode,time,weather:'clear, cloud 15%',dpr:1,metrics})
        console.log(file)
      }
    }
  }
  if(errors.length)throw Error(errors.join('\n'))
  await writeFile(`${output}/manifest.json`,JSON.stringify({source:'Chromium SwiftShader',synthetic:true,reducedMotion:true,errors,files},null,2)+'\n')
}finally{server.close();await browser.close()}
