import {writeFile} from 'node:fs/promises'
import {openBrowser,startVite} from './space3d-browser.mjs'
const server=await startVite(),browser=await openBrowser(),errors=[]
browser.onEvent(e=>{if(e.method==='Runtime.exceptionThrown')errors.push(e.params.exceptionDetails.text);if(e.method==='Runtime.consoleAPICalled'&&e.params.type==='error')errors.push(e.params.args.map(x=>x.value||x.description).join(' '))})
try{
 await browser.cdp('Emulation.setDeviceMetricsOverride',{width:390,height:844,deviceScaleFactor:1,mobile:true})
 await browser.cdp('Page.addScriptToEvaluateOnNewDocument',{source:'Object.defineProperty(navigator,"hardwareConcurrency",{get:()=>8})'})
 await browser.cdp('Page.navigate',{url:server.origin+'/tools/space3d-visual/?space3dTest=1&space3dMetrics=1&photos=8'})
 await browser.waitFor('window.__space3dTest?.stats().mapsPending===0&&window.__space3dTest.stats().pageTextures===2&&window.__space3dTest.stats().photosPending===0')
 await browser.evaluate(`window.__space3dTest.beginFrameInjection();window.__space3dTest.maximumDensity();window.__space3dTest.environment({...window.visualFixture.weather,utcTimestamp:window.visualFixture.time,weatherCode:63,cloudcover:75})`)
 await browser.evaluate('new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)))')
 const metrics=await browser.evaluate('window.__space3dTest.stats()')
 const result={fixture:{photos:8,memoryStars:48,letters:5},metrics,errors,source:'SwiftShader; full content and shadows; automatic quality suspended only for diagnostic'}
 await writeFile('docs/space3d-validation/reference-budget.json',JSON.stringify(result,null,2)+'\n')
 console.log(JSON.stringify(result))
 if(errors.length||metrics.calls>99||metrics.triangles>100000)throw Error('Rendering budget, haze headroom or shader failed')
 if(!(metrics.weatherPlaneX>metrics.windowBackdropX&&metrics.weatherPlaneX<metrics.windowGlassX))throw Error('Weather particles must stay outside glass and in front of the sky backdrop')
}finally{server.close();await browser.close()}
