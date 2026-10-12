import * as T from 'three'
import { buildDeskScene } from './geometry.js'
import { makeMaterials, canvasTexture, disposeMaterials } from './materials.js'

function kelvinColor(kelvin) {
  const temperature=T.MathUtils.clamp(kelvin,1000,40000)/100
  const red=temperature<=66?255:329.698727446*Math.pow(temperature-60,-.1332047592)
  const green=temperature<=66?99.4708025861*Math.log(temperature)-161.1195681661:288.1221695283*Math.pow(temperature-60,-.0755148492)
  const blue=temperature>=66?255:temperature<=19?0:138.5177312231*Math.log(temperature-10)-305.0447927307
  return new T.Color().setRGB(T.MathUtils.clamp(red/255,0,1),T.MathUtils.clamp(green/255,0,1),T.MathUtils.clamp(blue/255,0,1),T.SRGBColorSpace)
}

export function createSpaceScene(canvas, options) {
  const context = canvas.getContext('webgl2', { alpha: false, antialias: true })
  if (!context) throw new Error('WebGL2 unavailable')
  const renderer = new T.WebGLRenderer({ canvas, context, antialias: true })
  // Include shadow passes in per-frame budgets; three resets after shadows by default.
  renderer.info.autoReset = false
  const debugRenderer = context.getExtension('WEBGL_debug_renderer_info')
  const gpu = debugRenderer ? context.getParameter(debugRenderer.UNMASKED_RENDERER_WEBGL) : 'unavailable'
  const renderingSource = /swiftshader|llvmpipe|software/i.test(gpu) ? 'software-rendering' : gpu === 'unavailable' ? 'unverified-rendering' : 'hardware-rendering'
  renderer.outputColorSpace = T.SRGBColorSpace
  renderer.toneMapping = T.ACESFilmicToneMapping; renderer.toneMappingExposure = 1.15
  renderer.shadowMap.enabled = true
  // r180 PCFSoft radius A/B probe is byte-identical; PCF honors radius.
  renderer.shadowMap.type = T.PCFShadowMap
  const scene = new T.Scene(); scene.background = new T.Color('#ADCBDD')
  const materials = makeMaterials(), objects = buildDeskScene(materials); scene.add(objects.root)
  const camera = new T.PerspectiveCamera(38, 1, .02, 30)
  const ambient = new T.AmbientLight('#E5DDCF', .05); scene.add(ambient)
  const sky = new T.HemisphereLight('#ADCBDD', '#69594C', .5); scene.add(sky)
  const sun = new T.DirectionalLight('#FFF3DE', 2); scene.add(sun); scene.add(sun.target)
  sun.target.position.set(0,.85,0); sun.castShadow = true
  const lamp = new T.SpotLight('#FFCF98', 0, 3, 40*Math.PI/180, .6, 2)
  lamp.position.set(.52,1.12,-.16); lamp.target.position.set(-.05,.75,.04)
  lamp.castShadow = false; scene.add(lamp);scene.add(lamp.target)
  for (const light of [sun,lamp]) {
    light.shadow.mapSize.set(1024,1024); light.shadow.bias=-.0001;light.shadow.normalBias=.002
  }
  Object.assign(sun.shadow.camera,{ left:-1.5,right:1.5,top:1.5,bottom:-1.5,near:.1,far:12 })
  sun.shadow.camera.updateProjectionMatrix();sun.shadow.radius=2
  const cold = new T.PointLight('#9FB5D0', .08, 2, 2);cold.position.set(-.9,1.4,.15);scene.add(cold)
  const haze=new T.Mesh(new T.PlaneGeometry(.98,.98),new T.MeshBasicMaterial({color:'#B8C2C8',transparent:true,opacity:0,depthWrite:false,side:T.DoubleSide}))
  haze.position.set(-1.02,1.4,.15);haze.rotation.y=Math.PI/2;scene.add(haze)
  const raycaster = new T.Raycaster(), pointer = new T.Vector2()
  let dirty=true, raf=0, lastFrame=0, transitionUntil=0, disposed=false, reduced=options.reducedMotion
  let mode='overview', orbitX=0,orbitY=0,zoom=1, drawerAmount=0, drawerGoal=0
  let environment=null, quality=options.quality, previousFrameActive=false
  let lastReport=0, renderedFrames=0, totalFrames=0, sumMs=0
  const targetPosition=new T.Vector3(),targetLook=new T.Vector3(),currentLook=new T.Vector3()
  const sunGoal=new T.Vector3(-4,4,0), tintGoal=new T.Color('#FFF3DE'), skyGoal=new T.Color('#ADCBDD')
  let directGoal=.5,diffuseGoal=.3,lampGoal=0,flipStart=0,flipDone=null,flipBase=null
  let photoGeneration=0,playerKey='',flashUntil=0,flashTimer=0
  let mapsPending=objects.bakeSurfaces.reduce((sum,mesh)=>sum+(mesh.userData.aoOnly?1:2),0)
  const pageTextures=[],photoTextures=[], ownedTextures=[]
  const baseEmission=new WeakMap()
  let selectedHit=null
  const rainGeometry=new T.BufferGeometry(),snowGeometry=new T.BufferGeometry()
  const rainPositions=new Float32Array(200*3),snowPositions=new Float32Array(100*3)
  function initParticles(array) {for(let i=0;i<array.length;i+=3){array[i]=-.98;array[i+1]=.91+((i*43)%97)/100;array[i+2]=-.34+((i*17)%97)/100}}
  initParticles(rainPositions);initParticles(snowPositions)
  rainGeometry.setAttribute('position',new T.BufferAttribute(rainPositions,3));snowGeometry.setAttribute('position',new T.BufferAttribute(snowPositions,3))
  const rain=new T.Points(rainGeometry,new T.PointsMaterial({color:'#B9CEDB',size:.005,transparent:true,opacity:.6,depthWrite:false}))
  const snow=new T.Points(snowGeometry,new T.PointsMaterial({color:'#F0F5F3',size:.012,transparent:true,opacity:.8,depthWrite:false}))
  scene.add(rain,snow)
  function targets() {
    const aspect=camera.aspect, overviewDistance=Math.max(2.15,1.58/(2*Math.tan(19*Math.PI/180)*aspect))
    if(mode==='reading') {
      // Width of the current 0.30m page at the target distance is 300 CSS px.
      const cssWidth=canvas.clientWidth||390
      const distance=.30/(2*Math.tan(19*Math.PI/180)*aspect*(Math.min(300,cssWidth-32)/cssWidth))
      targetLook.set(.078,.78,.03);targetPosition.set(.078,.78+distance,.03+distance*.035)
    } else if(mode==='drawer') {targetLook.set(0,.64,.30);targetPosition.set(.50,1.35,1.45)}
    else {targetLook.set(-.08,.97,-.03);targetPosition.set(overviewDistance*.24,1.0+overviewDistance*.32,overviewDistance*.90)}
    const relative=targetPosition.clone().sub(targetLook)
    const spherical=new T.Spherical().setFromVector3(relative)
    spherical.theta+=orbitX;spherical.phi=T.MathUtils.clamp(spherical.phi+orbitY,.06,Math.PI/2-.10)
    spherical.radius/=zoom;targetPosition.copy(targetLook).add(new T.Vector3().setFromSpherical(spherical))
  }
  function invalidate(duration=0) {
    if(disposed)return
    dirty=true;transitionUntil=Math.max(transitionUntil,performance.now()+(reduced?0:duration))
    if(!raf&&!document.hidden)raf=requestAnimationFrame(frame)
  }
  function resize() {
    const rect=canvas.getBoundingClientRect();if(!rect.width||!rect.height)return
    renderer.setPixelRatio(Math.min(window.devicePixelRatio||1,quality.dprLimit))
    renderer.setSize(rect.width,rect.height,false);camera.aspect=rect.width/rect.height;camera.updateProjectionMatrix()
    targets();if(!lastFrame){camera.position.copy(targetPosition);currentLook.copy(targetLook)}invalidate(700)
  }
  function applyQuality(next) {
    quality=next;renderer.shadowMap.enabled=next.shadows
    sun.castShadow=next.shadows&&environment?.isDay!==false
    lamp.castShadow=next.shadows&&environment?.isDay===false
    for(const light of [sun,lamp]){light.shadow.mapSize.set(next.shadowSize,next.shadowSize);if(light.shadow.map){light.shadow.map.dispose();light.shadow.map=null}}
    rainGeometry.setDrawRange(0,next.rainCount);snowGeometry.setDrawRange(0,next.snowCount);resize()
  }
  function setEnvironment(next) {
    environment=next
    const alt=next.solarAltitude*Math.PI/180,az=(next.solarAzimuth-165)*Math.PI/180
    sunGoal.set(-Math.cos(az)*Math.cos(alt)*6,Math.sin(alt)*6+.85,Math.sin(az)*Math.cos(alt)*6)
    directGoal=next.directIntensity*3.2;diffuseGoal=next.diffuseIntensity*2.8
    lampGoal=next.isDay?0:3.0
    // Continuous warm/cool endpoints, interpolated below; no instant daylight colors.
    tintGoal.copy(kelvinColor(next.colorTemperature))
    skyGoal.set(next.skyColor)
    sun.castShadow=quality.shadows&&next.isDay;lamp.castShadow=quality.shadows&&!next.isDay
    clearTimeout(flashTimer)
    if(next.effects.lightning&&!reduced&&quality.particles){
      flashTimer=setTimeout(()=>{if(disposed||document.hidden||reduced)return;flashUntil=performance.now()+900;invalidate(1200)},18000)
    }
    invalidate(1200)
  }
  function particleStep(points,values,speed,dt) {
    for(let i=0;i<values.length;i+=3){values[i+1]-=dt*speed;if(values[i+1]<.91)values[i+1]=1.89}
    points.geometry.attributes.position.needsUpdate=true
  }
  function frame(now) {
    raf=0;if(disposed||document.hidden)return
    const animated=!reduced&&((quality.particles&&environment&&(environment.effects.rain||environment.effects.snow))||now<transitionUntil||!!flipStart)
    const dt=lastFrame?Math.min((now-lastFrame)/1000,.10):.016
    if(previousFrameActive&&lastFrame){const ms=now-lastFrame;options.onFrame(ms);sumMs+=ms;renderedFrames++}
    lastFrame=now;previousFrameActive=animated
    const t=reduced||now>=transitionUntil?1:1-Math.exp(-dt*6)
    camera.position.lerp(targetPosition,t);currentLook.lerp(targetLook,t);camera.lookAt(currentLook)
    drawerAmount=T.MathUtils.lerp(drawerAmount,drawerGoal,t);objects.drawer.position.z=drawerAmount*.32
    sun.position.lerp(sunGoal,t);sun.intensity=T.MathUtils.lerp(sun.intensity,directGoal,t);sun.color.lerp(tintGoal,t)
    sky.intensity=T.MathUtils.lerp(sky.intensity,diffuseGoal,t);sky.color.lerp(skyGoal,t);scene.background.lerp(skyGoal,t)
    ambient.intensity=T.MathUtils.lerp(ambient.intensity,environment?.isDay!==false ? .18 : .05,t)
    lamp.intensity=T.MathUtils.lerp(lamp.intensity,lampGoal,t)
    objects.bakeSurfaces.forEach(mesh=>{if(mesh.material.lightMap)mesh.material.lightMapIntensity=T.MathUtils.lerp(mesh.material.lightMapIntensity,environment?.isDay !== false ? .65 : .06,t)})
    const flash=!reduced&&quality.particles&&now<flashUntil?(environment?.effects.lightning??0)*.08:0
    haze.material.color.lerp(flash?new T.Color('#FFFFFF'):skyGoal,t)
    haze.material.opacity=T.MathUtils.lerp(haze.material.opacity,(environment?.effects.fog??0)*.13+flash,t)
    haze.visible=haze.material.opacity>.001
    rain.visible=!!environment?.effects.rain&&quality.particles&&!reduced
    snow.visible=!!environment?.effects.snow&&quality.particles&&!reduced
    rain.material.opacity=T.MathUtils.lerp(rain.material.opacity,(environment?.effects.rain??0)*.22,t)
    snow.material.opacity=T.MathUtils.lerp(snow.material.opacity,(environment?.effects.snow??0)*.27,t)
    if(rain.visible)particleStep(rain,rainPositions,.4+(environment.effects.rain*.12),dt)
    if(snow.visible)particleStep(snow,snowPositions,.10+(environment.effects.snow*.025),dt)
    if(flipStart){
      const progress=reduced?1:Math.min(1,(now-flipStart)/320)
      const positions=objects.pages[1].geometry.attributes.position
      for(let i=0;i<positions.count;i++){
        const x=flipBase[i*3],u=(x+.15)/.30,theta=progress*Math.PI
        const bend=Math.sin(theta)*Math.sin(u*Math.PI)*.025,z=flipBase[i*3+2]
        positions.setXYZ(i,-.15+u*.30*Math.cos(theta)-(bend+z)*Math.sin(theta),flipBase[i*3+1],u*.30*Math.sin(theta)+(bend+z)*Math.cos(theta))
      }
      positions.needsUpdate=true;objects.pages[1].geometry.computeVertexNormals()
      if(progress>=1){positions.array.set(flipBase);positions.needsUpdate=true;objects.pages[1].geometry.computeVertexNormals();flipStart=0;const done=flipDone;flipDone=null;done?.()}
    }
    if(dirty||animated){renderer.info.reset();renderer.render(scene,camera);dirty=false;totalFrames++}
    if(now-lastReport>1000||!animated){lastReport=now;options.onMetrics({fps:renderedFrames?renderedFrames*1000/sumMs:null,
      calls:renderer.info.render.calls,triangles:renderer.info.render.triangles,dpr:renderer.getPixelRatio(),
      renderedFrames:totalFrames,mode,shadowType:'PCFShadowMap',quality:quality.shadows?'shadow':'no-shadow',
      pageWidth:projectedPageWidth(),source:renderingSource})}
    if(animated)raf=requestAnimationFrame(frame)
  }
  function projectedPageWidth(){
    camera.updateMatrixWorld();const center=new T.Vector3(.078,.78,.03)
    const a=center.clone().add(new T.Vector3(-.15,0,0)).project(camera)
    const b=center.clone().add(new T.Vector3(.15,0,0)).project(camera)
    return Math.abs(b.x-a.x)*(canvas.clientWidth||390)/2
  }
  const visibility=()=>{if(document.hidden){if(raf)cancelAnimationFrame(raf);raf=0;lastFrame=0;previousFrameActive=false;options.onPause()}
    else invalidate(700)}
  document.addEventListener('visibilitychange',visibility)
  const observer=new ResizeObserver(resize);observer.observe(canvas)
  const contextLost=event=>{event.preventDefault();options.onFailure('context-lost')}
  canvas.addEventListener('webglcontextlost',contextLost)
  // Static maps are repository assets, not versioned network material URLs.
  // ImageBitmapLoader forces colorSpaceConversion:none; PNG gamma must not alter data samples.
  const loader=new T.ImageBitmapLoader().setOptions({imageOrientation:'flipY',premultiplyAlpha:'none'})
  for(const mesh of objects.bakeSurfaces){
    mesh.material=mesh.material.clone()
    for(const [kind,key] of [['ao','aoMap'],['light','lightMap']]){
      if(kind==='light'&&mesh.userData.aoOnly)continue
      loader.load(`/space3d/baked/${mesh.name}-${kind}.png`,bitmap=>{
        if(disposed){bitmap.close();return}
        const texture=new T.Texture(bitmap);texture.flipY=false;texture.needsUpdate=true
        texture.colorSpace=T.LinearSRGBColorSpace;texture.channel=1;texture.anisotropy=2
        mesh.material[key]=texture;mesh.material.aoMapIntensity=.55;mesh.material.lightMapIntensity=.65
        mesh.material.needsUpdate=true;ownedTextures.push(texture);mapsPending--;invalidate()
      },undefined,()=>{if(!disposed)options.onFailure('baked-map-unavailable')})
    }
  }
  applyQuality(quality);resize()
  return {
    setEnvironment,
    mode(next){mode=next;orbitX=orbitY=0;zoom=1;drawerGoal=next==='drawer'?1:0;targets();invalidate(900)},
    orbit(dx,dy){if(mode==='reading')return;orbitX=T.MathUtils.clamp(orbitX-dx*.003,-Math.PI/10,Math.PI/10);
      orbitY=T.MathUtils.clamp(orbitY+dy*.002,-8*Math.PI/180,8*Math.PI/180);targets();invalidate(600)},
    zoom(ratio){zoom=T.MathUtils.clamp(zoom*ratio,.9,1.15);targets();invalidate(600)},
    arrange(hit){selectedHit=hit;mode='overview';targets();objects.root.traverse(mesh=>{
      if(!mesh.isMesh||!mesh.material)return
      for(const material of Array.isArray(mesh.material)?mesh.material:[mesh.material]){
        if(!material.emissive)continue
        if(!baseEmission.has(material))baseEmission.set(material,{color:material.emissive.clone(),intensity:material.emissiveIntensity})
        const base=baseEmission.get(material)
        material.emissive.copy(mesh.userData.hit===hit&&hit?new T.Color('#5E4025'):base.color)
        material.emissiveIntensity=mesh.userData.hit===hit && hit ? .12 : base.intensity
      }
    });invalidate(600)},
    hit(x,y){const rect=canvas.getBoundingClientRect();pointer.set((x-rect.left)/rect.width*2-1,-(y-rect.top)/rect.height*2+1);
      raycaster.setFromCamera(pointer,camera);return raycaster.intersectObjects(objects.root.children,true)[0]?.object.userData.hit??null},
    anchor(hit){const p=objects.anchors.get(hit)?.clone();if(!p)return null;if(hit==='drawer')p.z+=objects.drawer.position.z;p.project(camera);return {x:(p.x+1)/2*canvas.clientWidth,y:(1-p.y)/2*canvas.clientHeight}},
    quality:applyQuality,
    reduced(value){reduced=value;if(value&&flipStart)flipStart=performance.now()-320;invalidate(value?0:700)},
    async pages(canvases){
      pageTextures.forEach(t=>t.dispose());pageTextures.length=0
      canvases.forEach((canvas,i)=>{const texture=canvasTexture(canvas,true),material=objects.pages[i].userData.pageMaterial;pageTextures.push(texture);material.map=texture;material.color.set('#FFFFFF');material.needsUpdate=true});invalidate()
    },
    flip(done){if(reduced){done();return}if(flipStart)return;flipBase=objects.pages[1].geometry.attributes.position.array.slice();flipDone=done;flipStart=performance.now();invalidate(350)},
    snapshot(data){
      objects.letters.forEach((letter,i)=>{letter.visible=i<Math.min(5,data.weeklyCount)})
      objects.stars.count=Math.min(48,data.memoryCount)
      const progress=data.listen.duration?Math.round(data.listen.current/data.listen.duration*100)/100:0
      const key=`${data.listen.hasTrack}:${data.listen.title}:${progress}`
      if(key===playerKey){invalidate();return}playerKey=key
      const c=document.createElement('canvas');c.width=512;c.height=256;const ctx=c.getContext('2d')
      ctx.fillStyle='#D9DDC9';ctx.fillRect(0,0,512,256);ctx.fillStyle='#465345';ctx.font='28px sans-serif';ctx.fillText(data.listen.hasTrack?data.listen.title:'接音乐',20,55,470)
      ctx.fillRect(20,200,470*progress,5)
      const previous=objects.screen.material.map;objects.screen.material.map=canvasTexture(c);previous?.dispose();objects.screen.material.needsUpdate=true
      invalidate()
    },
    photos(urls){const generation=++photoGeneration;photoTextures.forEach(t=>t.dispose());photoTextures.length=0
      objects.photoPlanes.forEach((mesh,i)=>{if(mesh.material===materials.paper)mesh.material=mesh.material.clone();mesh.material.map=null;mesh.material.color.set('#F1EBDD');mesh.material.needsUpdate=true
        if(!urls[i])return
        const image=new Image();image.crossOrigin='anonymous';image.onload=()=>{if(disposed||generation!==photoGeneration)return
          try{
            const canvas=document.createElement('canvas');canvas.width=512;canvas.height=512;const ctx=canvas.getContext('2d');ctx.fillStyle='#F1EBDD';ctx.fillRect(0,0,512,512)
            const scale=Math.min(480/image.width,330/image.height);ctx.drawImage(image,(512-image.width*scale)/2,(354-image.height*scale)/2,image.width*scale,image.height*scale)
            const t=canvasTexture(canvas);photoTextures.push(t);mesh.material.map=t;mesh.material.color.set('#FFFFFF');mesh.material.needsUpdate=true;invalidate()
          }catch{/* A denied image stays in the original photo archive; never write or discard it. */}
        };image.src=urls[i]});invalidate()},
    debug(){return { renderer,scene,camera,objects, projectedPageWidth, totalFrames }},
    stats(){return {dpr:renderer.getPixelRatio(),shadows:renderer.shadowMap.enabled,
      rain:rain.visible,snow:snow.visible,rainCount:rainGeometry.drawRange.count,snowCount:snowGeometry.drawRange.count,
      renderedFrames:totalFrames,mode,pageWidth:projectedPageWidth(),calls:renderer.info.render.calls,triangles:renderer.info.render.triangles,
      mapsPending,pageTextures:pageTextures.length,source:renderingSource,gpu,
      sunShadow:sun.castShadow,lampShadow:lamp.castShadow,direct:sun.intensity,lampIntensity:lamp.intensity,
      lightMapIntensity:objects.bakeSurfaces[0].material.lightMapIntensity,ambient:ambient.intensity,
      selected:selectedHit||'none'}},
    resetMetrics(){renderedFrames=sumMs=0;previousFrameActive=false},
    dispose(){disposed=true;clearTimeout(flashTimer);if(raf)cancelAnimationFrame(raf);observer.disconnect();document.removeEventListener('visibilitychange',visibility);canvas.removeEventListener('webglcontextlost',contextLost)
      const geometries=new Set(),mats=new Set();scene.traverse(obj=>{if(obj.geometry)geometries.add(obj.geometry);if(obj.material)(Array.isArray(obj.material)?obj.material:[obj.material]).forEach(m=>mats.add(m))})
      geometries.forEach(g=>g.dispose());mats.forEach(m=>m.dispose());pageTextures.forEach(t=>t.dispose());photoTextures.forEach(t=>t.dispose());ownedTextures.forEach(t=>{t.dispose();t.image.close?.()});objects.screen.material.map?.dispose();disposeMaterials(materials);renderer.dispose()}
  }
}
