import { useEffect, useRef, useState } from 'react'
import { paintSpaceDrawerFrontMesh } from '../lib/spaceDrawerFaceMesh'
import { spaceObjectPlaneMatrix } from '../lib/spaceObjectFocus'
import { spacePaperCurl, type SpaceBookLeaf } from '../lib/spaceBookPaper'

const W = 640, H = 480
// The two original E paper surfaces share the actual binding. Rectifying them
// is an overhead camera move; it retains their grain, curves, wear and cover.
const E_BOOK = [[432,1096],[940,1174],[837,1333],[220,1242]] as const
const FALLBACK_PAGES = [
  [[90,8],[228,6],[243,205],[3,177]],
  [[228,6],[421,49],[450,218],[243,205]],
] as const
function rectifiedTexture(image: HTMLImageElement, native: boolean): HTMLCanvasElement {
  const source = document.createElement('canvas'); source.width=image.naturalWidth; source.height=image.naturalHeight
  const sourceCtx=source.getContext('2d')!;sourceCtx.drawImage(image,0,0)
  const pixels=sourceCtx.getImageData(0,0,source.width,source.height).data
  const canvas=document.createElement('canvas');canvas.width=W;canvas.height=H
  const ctx=canvas.getContext('2d')!, output=ctx.createImageData(W,H)
  const pages=native?[E_BOOK]:FALLBACK_PAGES
  const segmentWidth=native?W:W/2
  // Inverse pixel sampling is done once on entry. Unlike individually clipped
  // triangles it cannot leave an antialiased grid across the original paper.
  pages.forEach((corners,side)=>{
    const m=spaceObjectPlaneMatrix(1,1,{x:0,y:0,width:1,height:1},corners)
    for(let y=0;y<H;y++)for(let x=0;x<segmentWidth;x++){
      const u=(x+.5)/segmentWidth,v=(y+.5)/H,z=m[3]*u+m[7]*v+1
      const sx=Math.max(0,Math.min(source.width-1.001,(m[0]*u+m[4]*v+m[12])/z))
      const sy=Math.max(0,Math.min(source.height-1.001,(m[1]*u+m[5]*v+m[13])/z))
      const ix=Math.floor(sx),iy=Math.floor(sy),fx=sx-ix,fy=sy-iy
      const dest=(y*W+side*segmentWidth+x)*4
      for(let c=0;c<4;c++) {
        const a=pixels[(iy*source.width+ix)*4+c],b=pixels[(iy*source.width+ix+1)*4+c]
        const d=pixels[((iy+1)*source.width+ix)*4+c],e=pixels[((iy+1)*source.width+ix+1)*4+c]
        output.data[dest+c]=(a+(b-a)*fx)*(1-fy)+(d+(e-d)*fx)*fy
      }
    }
  })
  ctx.putImageData(output,0,0)
  // Keep the soft leaf outlines and binding instead of a rectangular UI frame.
  if (native) return canvas
  ctx.globalCompositeOperation='destination-in';ctx.beginPath();ctx.moveTo(0,14)
  ctx.quadraticCurveTo(W/4,-5,W/2,9);ctx.quadraticCurveTo(W*.75,-4,W,12)
  ctx.lineTo(W,H-13);ctx.quadraticCurveTo(W*.75,H+6,W/2,H-6)
  ctx.quadraticCurveTo(W/4,H-25,0,H-8);ctx.closePath();ctx.fill()
  return canvas
}
function writeInk(ctx: CanvasRenderingContext2D, leaf: SpaceBookLeaf | undefined, side: number) {
  if (!leaf) return
  const x = (side ? W*.43 : 0)+38
  ctx.save(); ctx.globalCompositeOperation = 'multiply'; ctx.fillStyle = '#74503b'
  ctx.font = '19px "KaiTi", "STKaiti", serif'
  const date = new Date(leaf.date)
  if (Number.isFinite(date.getTime())) ctx.fillText(`${date.getMonth()+1}月${date.getDate()}日`,x,57)
  ctx.font = '24px "KaiTi", "STKaiti", serif'; ctx.fillStyle = '#503b2e'
  leaf.lines.forEach((line,index)=>ctx.fillText(line.replace(/\n$/, ''),x+(index%3)*.3,105+index*34))
  ctx.font = '16px serif'; ctx.fillStyle = '#9c7c5c'; ctx.fillText(String(leaf.number),(side ? W : W*.43)-46,H-38)
  ctx.restore()
}
function inkedSpread(texture: HTMLCanvasElement, left?: SpaceBookLeaf, right?: SpaceBookLeaf): HTMLCanvasElement {
  const canvas=document.createElement('canvas'); canvas.width=W;canvas.height=H
  const ctx=canvas.getContext('2d')!;ctx.drawImage(texture,0,0);writeInk(ctx,left,0);writeInk(ctx,right,1)
  if (!left && !right) { ctx.font='23px "KaiTi", "STKaiti", serif';ctx.fillStyle='#74553f';ctx.fillText('这里还没有长出',W*.43+38,146);ctx.fillText('新的思绪。',W*.43+38,184) }
  return canvas
}

export default function SpaceBookSurface({ native, left, right, front, back, turn, onArtworkError }: {
  native: boolean; left?: SpaceBookLeaf; right?: SpaceBookLeaf; front?: SpaceBookLeaf; back?: SpaceBookLeaf;
  turn: 'next'|'prev'|null; onArtworkError: () => void
}) {
  const errorRef = useRef(onArtworkError)
  useEffect(() => { errorRef.current = onArtworkError }, [onArtworkError])
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const textureRef = useRef<HTMLCanvasElement | null>(null)
  const [version,setVersion]=useState(0)
  useEffect(()=>{
    let alive=true
    const image=new Image()
    image.onload=()=>{ if(alive){textureRef.current=rectifiedTexture(image,native);setVersion(v=>v+1)} }
    image.onerror=()=>{ if(alive&&native) errorRef.current() }
    image.src=native?'/space/layered/room-content-clean-v2.webp':'/space/layered/open_book.png'
    return ()=>{alive=false}
  },[native])
  useEffect(()=>{
    const canvas=canvasRef.current, texture=textureRef.current
    if(!canvas||!texture)return
    const ctx=canvas.getContext('2d');if(!ctx)return
    const dpr=Math.min(window.devicePixelRatio||1,2);canvas.width=W*dpr;canvas.height=H*dpr
    const spread=inkedSpread(texture,left,right)
    const face=inkedSpread(texture,turn==='prev'?front:undefined,turn==='next'?front:undefined)
    const reverse=inkedSpread(texture,turn==='next'?back:undefined,turn==='prev'?back:undefined)
    const draw=(progress:number)=>{
      ctx.setTransform(dpr,0,0,dpr,0,0);ctx.clearRect(0,0,W,H);ctx.drawImage(spread,0,0)
      if(!turn)return
      const curl=spacePaperCurl(progress), sign=turn==='next'?1:-1, hinge=W*.43
      const startWidth=turn==='next'?W-hinge-12:hinge-12
      const endWidth=turn==='next'?hinge-12:W-hinge-12
      const half=startWidth+(endWidth-startWidth)*progress
      const theta=Math.PI*progress
      ctx.save();ctx.globalAlpha=.14*Math.sin(theta);ctx.filter='blur(7px)';ctx.fillStyle='#57391e'
      ctx.beginPath();ctx.ellipse(hinge+sign*half*Math.cos(theta)/2,H/2+9,Math.max(3,half*Math.abs(Math.cos(theta))/2),H/2-24,0,0,Math.PI*2);ctx.fill();ctx.restore()
      for(let i=0;i<curl.length-1;i++){
        const a=curl[i],b=curl[i+1],isBack=a.back
        const column=turn==='next'?(isBack?0:1):(isBack?1:0)
        const sample=(u:number)=>(column ? hinge : 12)+(isBack?1-u:u)*(column ? W-hinge-12 : hinge-12)
        const u0=i/(curl.length-1),u1=(i+1)/(curl.length-1)
        const source=[[sample(u0),20],[sample(u1),20],[sample(u1),H-80],[sample(u0),H-80]] as const
        const point=(c:typeof a, bottom:boolean): readonly[number,number]=>[hinge+sign*half*c.x,(bottom?H-80:20)+half*c.lift*(bottom?-.055:.11)]
        const target=[point(a,false),point(b,false),point(b,true),point(a,true)] as const
        paintSpaceDrawerFrontMesh(ctx,isBack?reverse:face,source,target)
        ctx.save();ctx.globalAlpha=Math.sin(theta)*(.06+.08*i/(curl.length-1));ctx.fillStyle=isBack?'#6d482c':'#d4a766'
        ctx.beginPath();ctx.moveTo(...target[0]);for(const p of target.slice(1))ctx.lineTo(...p);ctx.closePath();ctx.fill();ctx.restore()
      }
    }
    draw(0)
    if(!turn)return
    let frame=0,last=-Infinity;const started=performance.now()
    const animate=(now:number)=>{ const p=Math.min(1,(now-started)/650);if(!document.hidden&&(now-last>=1000/30||p===1)){draw(p);last=now}if(p<1)frame=requestAnimationFrame(animate) }
    frame=requestAnimationFrame(animate)
    return ()=>cancelAnimationFrame(frame)
  },[native,version,left,right,front,back,turn])
  return <canvas ref={canvasRef} className="space-book-paper-canvas" aria-hidden="true" data-paper-source={native?'original-E':'asset-fallback'} />
}
