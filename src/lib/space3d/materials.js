import * as T from 'three'

const cache = new Map()
function randomSeed(seed) { return () => { seed = Math.imul(1664525, seed) + 1013904223 | 0; return (seed >>> 0) / 4294967296 } }
/** Periodic fields give repeatable, tileable color/roughness/normal textures. */
export function procedural(kind, channel) {
  const key = `${kind}:${channel}`
  if (cache.has(key)) return cache.get(key)
  const size = kind === 'wood' ? 1024 : 512
  const canvas = document.createElement('canvas'); canvas.width = canvas.height = size
  const ctx = canvas.getContext('2d'), data = ctx.createImageData(size, size)
  const random = randomSeed(kind === 'wood' ? 37 : kind === 'paper' ? 71 : kind === 'wall' ? 19 : kind==='floor'?109:93)
  const phases = Array.from({ length: 8 }, () => random() * Math.PI * 2)
  const bases = { wood: [169, 116, 79], wall: [242, 234, 220], paper: [245, 240, 228], linen: [182, 155, 116],floor:[150,111,76] }
  const rough = { wood: .58, wall: .94, paper: .93, linen: .90,floor:.86 }
  const variation = { wood: .20, wall: .055, paper: .040, linen: .045,floor:.06 }
  function grain(x, y, cellsX, cellsY) {
    const gx=x/size*cellsX,gy=y/size*cellsY,ix=Math.floor(gx),iy=Math.floor(gy)
    const smooth=value=>value*value*(3-2*value),sx=smooth(gx-ix),sy=smooth(gy-iy)
    const hash=(a,b)=>{let n=Math.imul((a+cellsX)%cellsX+19,(b+cellsY)%cellsY+71)^Math.floor(phases[3]*1e6);n=Math.imul(n^(n>>>16),0x45d9f3b);return (n>>>0)/4294967296*2-1}
    const a=hash(ix,iy)*(1-sx)+hash(ix+1,iy)*sx,b=hash(ix,iy+1)*(1-sx)+hash(ix+1,iy+1)*sx
    return a*(1-sy)+b*sy
  }
  function field(x, y) {
    const a = x / size * Math.PI * 2, b = y / size * Math.PI * 2
    if (kind === 'wood') {
      // Long fine fibres; avoid broad, evenly spaced stripes resembling plywood.
      const warp=Math.sin(a*2+phases[0])*.7+Math.sin(a*5+phases[1])*.2+grain(x,y,4,7)*2.1
      return .36*grain(x,y,6,32)+.34*Math.sin(b*41+warp*2)
        +.20*Math.sin(b*147+warp*1.7)+.10*Math.sin(b*311+warp*.5)
    }
    if (kind === 'linen') return (Math.sin(a * 128) + Math.sin(b * 128)) / 2
    if(kind==='floor')return .75*grain(x,y,8,48)+.25*Math.sin(b*113+Math.sin(a*3)*.6)
    return kind==='wall'?grain(x,y,96,96):grain(x,y,96,256)
  }
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const i = (y * size + x) * 4, f = field(x, y)
    if (channel === 'color') {
      for (let c = 0; c < 3; c++) data.data[i + c] = bases[kind][c] * (1 + f * variation[kind])
    } else if (channel === 'roughness') {
      data.data[i] = data.data[i + 1] = data.data[i + 2] = 255 * (rough[kind] + f * (kind === 'wood' ? .05 : .025))
    } else {
      data.data[i] = 128 + (field((x + 1) % size, y) - f) * 45
      data.data[i + 1] = 128 + (field(x, (y + 1) % size) - f) * 45
      data.data[i + 2] = 255
    }
    data.data[i + 3] = 255
  }
  ctx.putImageData(data, 0, 0)
  const texture = new T.CanvasTexture(canvas)
  texture.colorSpace = channel === 'color' ? T.SRGBColorSpace : T.NoColorSpace
  texture.wrapS = texture.wrapT = T.RepeatWrapping
  texture.anisotropy = kind === 'wood' || kind === 'paper' ? 4 : 2
  cache.set(key, texture); return texture
}
export function makeMaterials() {
  const make = (kind, roughness, strength) => new T.MeshStandardMaterial({
    color: '#FFFFFF', map: procedural(kind, 'color'), roughness,
    roughnessMap: procedural(kind, 'roughness'), normalMap: procedural(kind, 'normal'),
    normalScale: new T.Vector2(strength, strength), metalness: 0, aoMapIntensity: .55,
  })
  const materials = {
    wood: make('wood', 1, .16), wall: make('wall', 1, .065), paper: make('paper', 1, .045),
    linen: make('linen', 1, .045),floor:make('floor',1,.04),
    ceramic: new T.MeshStandardMaterial({ color: '#E5DED0', roughness: .32, metalness: 0 }),
    ceramicBase: new T.MeshStandardMaterial({ color: '#E5DED0', roughness: .72, metalness: 0 }),
    glass: new T.MeshPhysicalMaterial({ color: '#F0F5F3', roughness: .12, metalness: 0,
      transmission: 0, thickness: .005, ior: 1.45, clearcoat: 1, clearcoatRoughness: .12,
      transparent: true, opacity: .14, depthWrite: false }),
    dark: new T.MeshStandardMaterial({ color: '#4E453C', roughness: .9, metalness: 0 }),
    screen: new T.MeshStandardMaterial({ color: '#D9DDC9', roughness: .6, emissive: '#718270', emissiveIntensity: .12, metalness: 0 }),
  }
  // Clear centre, reflective edges: thickness stays visible without a white glass slab.
  materials.glass.onBeforeCompile=shader=>{
    shader.fragmentShader=shader.fragmentShader.replace('#include <opaque_fragment>',
      'diffuseColor.a = mix(0.045, 0.42, pow(1.0 - abs(dot(normalize(normal), normalize(vViewPosition))), 3.0));\n#include <opaque_fragment>')
  }
  materials.glass.customProgramCacheKey=()=> 'space-glass-edge-v1'
  return materials
}
export function canvasTexture(canvas, page = false) {
  const texture = new T.CanvasTexture(canvas)
  texture.colorSpace = T.SRGBColorSpace
  texture.generateMipmaps = true; texture.minFilter = T.LinearMipmapLinearFilter
  texture.anisotropy = page ? 4 : 2
  return texture
}
/** Cached indirect reflection source: no sun, no direct-light shadow or network asset. */
export function reflectionCanvas() {
  if(cache.has('reflection-source'))return cache.get('reflection-source')
  const canvas=document.createElement('canvas');canvas.width=1024;canvas.height=512
  const ctx=canvas.getContext('2d'),gradient=ctx.createLinearGradient(0,0,0,512)
  gradient.addColorStop(0,'#D8C5A4');gradient.addColorStop(.42,'#F2DCC0')
  gradient.addColorStop(.65,'#C29868');gradient.addColorStop(1,'#634B36')
  ctx.fillStyle=gradient;ctx.fillRect(0,0,1024,512)
  // A soft opening supplies edge reflections to glass and ceramic, not a second light.
  const opening=ctx.createRadialGradient(235,180,12,235,180,180)
  opening.addColorStop(0,'rgba(250,248,235,.7)');opening.addColorStop(1,'rgba(250,248,235,0)')
  ctx.fillStyle=opening;ctx.fillRect(0,0,1024,512)
  cache.set('reflection-source',canvas);return canvas
}
export function disposeMaterials(materials) {
  Object.values(materials).forEach(material => material.dispose())
  // Canvas sources stay cached; GPU objects are re-uploaded only for a new scene.
  cache.forEach(texture => texture.dispose?.())
}
