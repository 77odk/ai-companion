import assert from 'node:assert/strict'
import { mkdir,writeFile } from 'node:fs/promises'
import { openBrowser,startVite } from './space3d-browser.mjs'

const output='docs/space3d-validation/texture-rework'
const browser=await openBrowser(),server=await startVite(),errors=[]
browser.onEvent(e=>{if(e.method==='Runtime.exceptionThrown')errors.push(e.params.exceptionDetails.exception?.description??e.params.exceptionDetails.text)
 if(e.method==='Runtime.consoleAPICalled'&&e.params.type==='error')errors.push(e.params.args.map(x=>x.value||x.description).join(' '))})
try{
 await mkdir(output,{recursive:true})
 await browser.cdp('Emulation.setDeviceMetricsOverride',{width:390,height:844,deviceScaleFactor:1,mobile:true})
 await browser.cdp('Emulation.setEmulatedMedia',{features:[{name:'prefers-reduced-motion',value:'reduce'}]})
 await browser.cdp('Page.navigate',{url:server.origin+'/tools/space3d-visual/?space3dTest=1&space3dMetrics=1'})
 await browser.waitFor('window.__space3dTest?.stats().mapsPending===0&&window.__space3dTest.stats().photosPending===0&&window.__space3dTest.stats().pageTextures===2')
 await browser.evaluate('Date.now=()=>Date.parse("2026-12-21T05:30:00Z");window.__space3dTest.environment({...window.visualFixture.weather,utcTimestamp:Date.now()})')
 await browser.evaluate('new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)))')
 const report=await browser.evaluate(`(()=>{
  const d=window.__space3dTest.debug(),book=d.objects.pages[0].parent,contacts=d.contactDiagnostics[0];
  const initial=contacts.centers.slice(0,2).map(p=>p.toArray());
  window.textureDiagnostic={d,book,position:book.position.clone(),initial};
  book.position.x+=.75;window.__space3dTest.mode('overview');
  return {initial,source:'Chromium SwiftShader; synthetic fixture'};
 })()`)
 await browser.evaluate('new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)))')
 report.contactMove=await browser.evaluate(`(()=>{
  const {d,initial}=window.textureDiagnostic,contacts=d.contactDiagnostics[0];
  const moved=contacts.centers.slice(0,2).map(p=>p.toArray());
  const points=initial.flatMap(p=>[-.05,0,.05].flatMap(x=>[-.08,0,.08].map(z=>({x:p[0]+x,y:.75,z:p[1]+z}))));
  const geometry=d.objects.pages[0].geometry,point=geometry.boundingBox?.min?.clone()||d.camera.position.clone();
  const gl=d.renderer.getContext(),samples=()=>points.map(p=>{point.set(p.x,p.y,p.z).project(d.camera);
   const pixel=new Uint8Array(4);gl.readPixels(Math.floor((point.x+1)*gl.drawingBufferWidth/2),Math.floor((point.y+1)*gl.drawingBufferHeight/2),1,1,gl.RGBA,gl.UNSIGNED_BYTE,pixel);return [...pixel]});
  d.renderer.info.reset();d.renderer.render(d.scene,d.camera);const on=samples();
  const gates=contacts.gates.slice(0,2).map(v=>v.x);contacts.gates.slice(0,2).forEach(v=>v.x=0);
  d.renderer.info.reset();d.renderer.render(d.scene,d.camera);const off=samples();
  contacts.gates.slice(0,2).forEach((v,i)=>v.x=gates[i]);
  return {moved,oldFootprintSamples:points.length,oldFootprintChangedPixels:on.filter((v,i)=>v.some((n,c)=>n!==off[i][c])).length};
 })()`)
 assert.equal(report.contactMove.oldFootprintChangedPixels,0,'moving the book must leave no contact ghost at its old location')
 report.initial.forEach((p,i)=>assert.ok(Math.abs(report.contactMove.moved[i][0]-p[0]-.75)<1e-6))
 await browser.evaluate('window.textureDiagnostic.book.position.y+=.12;window.__space3dTest.mode("overview")')
 await browser.evaluate('new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)))')
 report.liftedContact=await browser.evaluate('window.__space3dTest.debug().contactDiagnostics[0].gates.slice(0,2).map(p=>p.x)')
 assert.deepEqual(report.liftedContact,[0,0])
 await browser.evaluate('const p=window.textureDiagnostic; p.book.position.copy(p.position);window.__space3dTest.mode("overview")')
 await browser.evaluate('new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)))')
 // Same render, once with and once without the cheap finish: evidence that
 // texture detail does not depend on a postprocessing pass or moving noise.
 for(const finish of [true,false]){
  const draw=await browser.evaluate(`(()=>{const d=window.__space3dTest.debug();d.finishSettings.set(${finish?'.075,.024':'0,0'});d.renderer.info.reset();d.renderer.render(d.scene,d.camera);document.querySelector('.space3d-metrics').style.visibility='hidden';return {calls:d.renderer.info.render.calls,triangles:d.renderer.info.render.triangles}})()`)
  report[finish?'withFinish':'withoutFinish']=draw
  const image=await browser.cdp('Page.captureScreenshot',{format:'png',captureBeyondViewport:false})
  await writeFile(output+'/'+(finish?'finish-on.png':'finish-off.png'),Buffer.from(image.data,'base64'))
 }
 assert.deepEqual(report.withFinish,report.withoutFinish,'finish must not add a pass or draw call')
 const wall=await browser.evaluate(`(()=>{
  const d=window.__space3dTest.debug(),saved=[];
  const template=d.objects.root.getObjectByName('windowView')?.material||d.objects.windowView.material;
  d.scene.traverse(o=>{if(!o.material)return;saved.push([o,o.material]);
   const m=template.clone();m.map=null;m.transparent=false;m.opacity=1;m.toneMapped=false;m.color.set(o.name.includes('wall')?'#0000FF':'#000000');o.material=m;
  });
  d.renderer.info.reset();d.renderer.render(d.scene,d.camera);
  const gl=d.renderer.getContext(),pixels=new Uint8Array(gl.drawingBufferWidth*gl.drawingBufferHeight*4);
  gl.readPixels(0,0,gl.drawingBufferWidth,gl.drawingBufferHeight,gl.RGBA,gl.UNSIGNED_BYTE,pixels);
  let count=0;for(let i=0;i<pixels.length;i+=4)if(pixels[i+2]>100&&pixels[i]<50&&pixels[i+1]<50)count++;
  saved.forEach(([o,m])=>{o.material.dispose();o.material=m});
  return {visibleBareWallPercent:count/(pixels.length/4)*100,definition:'visible actual wall solids; photographs and props excluded; canvas pixels'};
 })()`)
 report.wall=wall;report.errors=errors
 assert.equal(errors.length,0)
 assert.ok(wall.visibleBareWallPercent<=30,'bare wall should occupy at most 30% of the close composition')
 await writeFile(output+'/material-runtime.json',JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify(report))
}finally{server.close();await browser.close()}
