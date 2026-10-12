import assert from 'node:assert/strict'
import { mkdir,writeFile } from 'node:fs/promises'
import { openBrowser,startVite } from './space3d-browser.mjs'

const server=await startVite(),browser=await openBrowser(),report={source:'Chromium SwiftShader',realDevice:'待七七真机验收',cpu6xSimulation:'由项目方执行',fallbacks:[],performance:[],checks:[]}
const errors=[];browser.onEvent(event=>{if(event.method==='Runtime.exceptionThrown')errors.push(event.params.exceptionDetails.exception?.description??event.params.exceptionDetails.text)})
try {
  await browser.cdp('Emulation.setDeviceMetricsOverride',{width:390,height:844,deviceScaleFactor:1.5,mobile:true})
  await browser.cdp('Emulation.setEmulatedMedia',{features:[{name:'prefers-reduced-motion',value:'reduce'}]})
  // Gate is tested through the actual AISpace component, retaining all existing callbacks and 2D DOM.
  for(const failure of ['webgl2-unavailable','initialization-failed','context-lost']){
    const injection=failure==='context-lost'?'':`const original=HTMLCanvasElement.prototype.getContext;
      HTMLCanvasElement.prototype.getContext=function(type,...args){if(type==='webgl2'){${failure==='webgl2-unavailable'?'return null':'throw new Error("Injected initialization failure")'}}return original.call(this,type,...args)}`
    let script
    if(injection)script=await browser.cdp('Page.addScriptToEvaluateOnNewDocument',{source:injection})
    await browser.cdp('Page.navigate',{url:`${server.origin}/tools/space3d-visual/?integrated=1&space3d=1&space3dTest=1`})
    if(failure==='context-lost'){
      await browser.waitFor('!!window.__space3dTest && !!document.querySelector(".space3d-ready")')
      await browser.evaluate('document.querySelector("canvas").getContext("webgl2").getExtension("WEBGL_lose_context").loseContext()')
    }
    await browser.waitFor('!!document.querySelector("[data-fallback]") && !document.querySelector(".space3d-ready")')
    const state=await browser.evaluate(`({reason:document.querySelector('[data-fallback]').dataset.fallback,
      sceneVisible:getComputedStyle(document.querySelector('.space-scene-shell')).display!=='none',
      entrances:[...document.querySelectorAll('.space-scene-hotspot')].map(b=>({label:b.getAttribute('aria-label'),disabled:b.disabled}))})`)
    assert.equal(state.sceneVisible,true);assert.equal(state.entrances.length,5);assert.ok(state.entrances.every(x=>!x.disabled))
    // Verify the original navigation callbacks still fire after each fault.
    for(const [selector,expected] of [['.is-star-jar','jar'],['.is-thought-book','book'],['.is-player','player'],['.is-weekly-letter','drawer']]){
      await browser.evaluate(`document.querySelector(${JSON.stringify(selector)}).click()`)
      await browser.waitFor(`window.visualEvents.includes(${JSON.stringify(expected)})`)
    }
    await browser.evaluate('document.querySelector(".is-photo-wall").click()')
    await browser.waitFor('!!document.querySelector(".photo-archive-page[role=dialog]")')
    report.fallbacks.push({failure,...state,originalNavigationCallbacks:['jar','book','player','drawer'],photoButtonAvailable:true})
    if(script)await browser.cdp('Page.removeScriptToEvaluateOnNewDocument',{identifier:script.identifier})
  }
  const highTier = await browser.cdp('Page.addScriptToEvaluateOnNewDocument',{source:'Object.defineProperty(navigator,"hardwareConcurrency",{get:()=>8})'})
  await browser.cdp('Page.navigate',{url:`${server.origin}/tools/space3d-visual/?integrated=1&space3d=1&space3dTest=1`})
  await browser.waitFor('!!window.__space3dTest && !!document.querySelector(".space3d-ready")')
  const steps=[]
  await browser.cdp('Emulation.setEmulatedMedia',{features:[]})
  await browser.waitFor('window.__space3dTest.stats().mapsPending === 0')
  await browser.evaluate(`window.__space3dTest.beginFrameInjection();window.__space3dTest.environment({utcTimestamp:Date.parse('2026-06-21T04:00:00Z'),latitude:39.9042,longitude:116.4074,timezone:'Asia/Shanghai',cloudcover:75,weatherCode:63})`)
  await browser.evaluate('new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))')
  assert.equal(await browser.evaluate('window.__space3dTest.stats().rain'),true)
  for(let step=1;step<=4;step++){
    await browser.evaluate('for(let i=0;i<60;i++)window.__space3dTest.sampleFrame(50)')
    if(step<4){await browser.evaluate('new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))');const stats=await browser.evaluate('window.__space3dTest.stats()');assert.equal(await browser.evaluate('window.__space3dTest.step()'),step);steps.push({step,...stats})}
  }
  await browser.waitFor('document.querySelector("[data-fallback]")?.dataset.fallback === "low-fps"')
  assert.equal(steps[0].shadows,false);assert.equal(steps[1].dpr,1);assert.equal(steps[2].rain,false)
  report.checks.push({name:'full-degradation-ladder',steps,final:'original 2D'})
  await browser.cdp('Page.removeScriptToEvaluateOnNewDocument',{identifier:highTier.identifier})
  await browser.cdp('Emulation.setEmulatedMedia',{features:[]})
  // Software-rendered scene and full-page rAF timings. Deliberate camera changes sustain rendering.
  for(const [name,width,height] of [['phone',390,844],['desktop',1280,800],['integrated-phone',390,844]]){
    await browser.cdp('Emulation.setDeviceMetricsOverride',{width,height,deviceScaleFactor:1,mobile:width<500})
    console.log(`Sampling ${name}`)
    const integrated=name==='integrated-phone'
    await browser.cdp('Page.navigate',{url:`${server.origin}/tools/space3d-visual/?space3dTest=1&space3dMetrics=1${integrated?'&integrated=1&space3d=1':''}`})
    await browser.waitFor(integrated?'!!document.querySelector(".space3d-ready") && !!window.__space3dTest':'window.visualReady === true && !!window.__space3dTest')
    await browser.waitFor('window.__space3dTest.stats().mapsPending === 0 && window.__space3dTest.stats().pageTextures === 2')
    await browser.evaluate(`window.__space3dTest.beginFrameInjection();window.__space3dTest.environment({utcTimestamp:Date.parse('2026-06-21T04:00:00Z'),latitude:39.9042,longitude:116.4074,timezone:'Asia/Shanghai',cloudcover:75,weatherCode:63});window.__space3dTest.beginMetrics()`)
    const result=await browser.evaluate(`new Promise(resolve=>{
      let frames=0,last=performance.now(),start=last,initialSceneFrames=window.__space3dTest.stats().renderedFrames,intervals=[];
      const tick=now=>{intervals.push(now-last);last=now;frames++;window.__space3dTest.mode(frames%60<30?'overview':'drawer');
        if(now-start<12000 || frames<12)requestAnimationFrame(tick);else resolve({wholePageFps:frames*1000/(now-start),sceneFps:(window.__space3dTest.stats().renderedFrames-initialSceneFrames)*1000/(now-start),durationMs:now-start,
          frames,scene:JSON.parse(document.querySelector('.space3d-metrics').textContent),stats:window.__space3dTest.stats(),step:window.__space3dTest.step()})};requestAnimationFrame(tick)
    })`)
    assert.ok(result.stats.triangles<=100000,JSON.stringify(result));assert.ok(result.stats.calls<=100,JSON.stringify(result))
    assert.ok(Number.isFinite(result.sceneFps));assert.ok(result.frames>=12);console.log(`${name}: scene=${result.sceneFps.toFixed(2)}fps / page=${result.wholePageFps.toFixed(2)}fps`)
    report.performance.push({name,width,height,dpr:1,activity:'rain + controlled camera; quality tier 0 held for raw FPS; complete ladder verified separately',mounted:integrated?'AISpace + existing photo archive service':'Space3DCanvas synthetic content fixture',...result})
    await browser.cdp('Emulation.setEmulatedMedia',{features:[{name:'prefers-reduced-motion',value:'reduce'}]})
    await browser.evaluate('window.__space3dTest.mode("reading")')
    await browser.evaluate('new Promise(resolve=>setTimeout(resolve,1200))')
    // SwiftShader can spend longer than 1200 ms rendering one frame. Drain the
    // camera update and React's subsequent page-texture effect before sampling
    // idleness; elapsed timers alone do not establish that those frames ran.
    await browser.evaluate('new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))')
    const count=await browser.evaluate('window.__space3dTest.stats().renderedFrames')
    await browser.evaluate('new Promise(resolve=>setTimeout(resolve,1200))')
    assert.equal(await browser.evaluate('window.__space3dTest.stats().renderedFrames'),count)
    report.checks.push({name:`${name}-idle-stops`,frames:count})
    await browser.evaluate(`[...document.querySelectorAll('button')].find(b=>b.textContent==='聊天记录').click()`)
    await browser.waitFor('!!document.querySelector(".space3d-reader")')
    assert.equal(await browser.evaluate('document.querySelectorAll("[data-message-id]").length'),integrated?0:12)
    if(!integrated){
      const search=await browser.evaluate(`(()=>{const input=document.querySelector('.space3d-reader input');const setter=Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set;
        setter.call(input,'不存在的固定验收词');input.dispatchEvent(new Event('input',{bubbles:true}));return true})()`)
      assert.equal(search,true)
      await browser.waitFor('document.querySelectorAll("[data-message-id]").length === 0')
      await browser.evaluate(`(()=>{const input=document.querySelector('.space3d-reader input');Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(input,'');input.dispatchEvent(new Event('input',{bubbles:true}))})()`)
      await browser.waitFor('document.querySelectorAll("[data-message-id]").length === 12')
      const before=await browser.evaluate('getComputedStyle(document.querySelector(".space3d-reader-content")).fontSize')
      await browser.evaluate('document.querySelector("button[aria-label=放大字号]").click()')
      assert.notEqual(await browser.evaluate('getComputedStyle(document.querySelector(".space3d-reader-content")).fontSize'),before)
      await browser.evaluate('new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))')
      await browser.evaluate('const area=document.querySelector(".space3d-reader-content");area.scrollTop=900;area.dispatchEvent(new Event("scroll",{bubbles:true}))')
      await browser.waitFor('!!JSON.parse(localStorage.getItem("ai_companion_settings") ?? "null")?.spaceEnvironment?.reading?.["visual-only"]')
      const saved=await browser.evaluate('JSON.parse(localStorage.getItem("ai_companion_settings")).spaceEnvironment.reading["visual-only"]')
      assert.ok(saved.messageId);assert.ok(saved.offset>=0)
      report.checks.push({name:`${name}-dom-reading`,search:true,fontSize:true,position:saved})
    }
    await browser.cdp('Emulation.setEmulatedMedia',{features:[]})
  }
  await browser.cdp('Emulation.setEmulatedMedia',{features:[{name:'prefers-reduced-motion',value:'reduce'}]})
  await browser.cdp('Page.navigate',{url:`${server.origin}/tools/space3d-visual/?space3dTest=1&space3dMetrics=1`})
  await browser.waitFor('window.visualReady === true && window.__space3dTest?.stats().mapsPending===0')
  await browser.evaluate('window.__space3dTest.quality(0)')
  const night={utcTimestamp:Date.parse('2026-06-21T16:00:00Z'),latitude:39.9042,longitude:116.4074,timezone:'Asia/Shanghai',cloudcover:80,weatherCode:95}
  await browser.evaluate(`window.__space3dTest.environment(${JSON.stringify(night)})`)
  await browser.evaluate('new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))')
  const dark=await browser.evaluate('window.__space3dTest.stats()')
  assert.equal(dark.direct,0);assert.equal(dark.sunShadow,false);assert.equal(dark.lampShadow,true)
  assert.equal(dark.ambient,.05);assert.equal(dark.lightMapIntensity,.06);assert.equal(dark.rain,false)
  const back={...night,utcTimestamp:Date.parse('2026-06-21T04:00:00Z'),windowAzimuth:0,weatherCode:0}
  await browser.evaluate(`window.__space3dTest.environment(${JSON.stringify(back)})`)
  await browser.evaluate('new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))')
  const away=await browser.evaluate('window.__space3dTest.stats()');assert.equal(away.direct,0)
  report.checks.push({name:'night-and-back-facing-window',night:dark,backFacing:away})
  // Arrangement changes selection/view only; message/photo/memory keys remain untouched.
  await browser.cdp('Emulation.setEmulatedMedia',{features:[]})
  await browser.evaluate(`window.__space3dTest.beginFrameInjection();window.__space3dTest.maximumDensity();window.__space3dTest.environment(${JSON.stringify({...back,windowAzimuth:165,weatherCode:63,cloudcover:75})})`)
  await browser.evaluate('new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))')
  const density=await browser.evaluate('window.__space3dTest.stats()');assert.ok(density.calls<=100);assert.ok(density.triangles<=100000)
  report.checks.push({name:'maximum-content-shadow-budget',memoryStars:48,letters:5,...density})
  await browser.cdp('Emulation.setEmulatedMedia',{features:[{name:'prefers-reduced-motion',value:'reduce'}]})
  const contentKeys=await browser.evaluate('Object.keys(localStorage).filter(key=>/msgs|memory|photos/.test(key)).map(key=>[key,localStorage.getItem(key)])')
  await browser.evaluate('[...document.querySelectorAll("button")].find(button=>button.textContent==="布置").click()')
  await browser.waitFor('!!document.querySelector(".space3d-selection")')
  assert.equal(await browser.evaluate('window.__space3dTest.stats().selected'),'book')
  await browser.evaluate('[...document.querySelectorAll("button")].find(button=>button.textContent==="完成").click()')
  await browser.waitFor('!document.querySelector(".space3d-selection")')
  assert.deepEqual(await browser.evaluate('Object.keys(localStorage).filter(key=>/msgs|memory|photos/.test(key)).map(key=>[key,localStorage.getItem(key)])'),contentKeys)
  report.checks.push({name:'arrangement-skeleton',enter:true,exit:true,selection:true,contentWrites:0})
  assert.equal(errors.length,0,errors.join('\n'))
  await mkdir('docs/space3d-validation',{recursive:true})
  await writeFile('docs/space3d-validation/reference-runtime.json',JSON.stringify(report,null,2)+'\n')
  console.log(JSON.stringify(report))
} finally {server.close();await browser.close()}
