import { mkdir, writeFile } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import { openBrowser, startVite } from './space3d-browser.mjs'

// Explicit PNG gAMA=1.0; strip browser color-profile chunks without changing linear samples.
function crc32(buffer) { let crc=-1;for(const byte of buffer){crc^=byte;for(let i=0;i<8;i++)crc=(crc>>>1)^((crc&1)?0xEDB88320:0)}return (crc^-1)>>>0 }
function linearPng(base64){
  const input=Buffer.from(base64,'base64'),chunks=[input.subarray(0,8)]
  for(let offset=8;offset<input.length;){
    const length=input.readUInt32BE(offset),type=input.toString('ascii',offset+4,offset+8),chunk=input.subarray(offset,offset+length+12)
    if(!['sRGB','gAMA','iCCP','cHRM'].includes(type))chunks.push(chunk)
    if(type==='IHDR'){
      const gamma=Buffer.alloc(16);gamma.writeUInt32BE(4,0);gamma.write('gAMA',4);gamma.writeUInt32BE(100000,8);gamma.writeUInt32BE(crc32(gamma.subarray(4,12)),12);chunks.push(gamma)
    }
    offset+=length+12
  }
  return Buffer.concat(chunks)
}
const server=await startVite(),browser=await openBrowser()
try {
  await browser.cdp('Page.navigate',{url:`${server.origin}/tools/space3d-bake/`})
  await browser.waitFor('window.bakeReady === true')
  console.log('Baking fixed geometry with diffuse aperture illumination…')
  const result=await browser.evaluate('window.bakeSpace()')
  const path='public/space3d/baked';await mkdir(path,{recursive:true})
  const files={}
  for(const mesh of result.results)for(const kind of ['ao','light']){
    if(!mesh[kind])continue
    const name=`${mesh.name}-${kind}.png`,data=linearPng(mesh[kind]);await writeFile(`${path}/${name}`,data)
    files[name]={space:'LinearSRGBColorSpace',pngGamma:1,uv:'uv1',size:[mesh.size,mesh.size],sha256:createHash('sha256').update(data).digest('hex')}
  }
  await writeFile(`${path}/manifest.json`,JSON.stringify({...result.metadata,files},null,2)+'\n')
  console.log(`Wrote ${Object.keys(files).length} linear PNGs; command: node scripts/bake_space3d.mjs`)
} finally {server.close();await browser.close()}
