import { useEffect, useRef } from 'react'
import { spaceObjectPlaneMatrix } from '../lib/spaceObjectFocus'
import { SPACE_DECOR } from './SpaceSceneDecor'

/** A camera projection of the original desk, not a second room illustration.
 * The book occupies the same centered rectangle as its sharp paper surface. */
export default function SpaceBookDeskCamera({ native }: { native: boolean }) {
  const ref=useRef<HTMLCanvasElement>(null)
  useEffect(()=>{
    if(!native)return
    let alive=true,frame=0
    const load=(name:string)=>new Promise<HTMLImageElement>((resolve,reject)=>{
      const img=new Image();img.onload=()=>resolve(img);img.onerror=reject;img.src='/space/layered/'+name
    })
    const files=['room-content-clean-v2.webp',...SPACE_DECOR.map(d=>d.file),'table_lamp.png','amber_flowers.png','origami_coral.png','origami_red_pattern.png']
    void Promise.all(files.map(load)).then(images=>{
      if(!alive)return
      const source=document.createElement('canvas');source.width=941;source.height=1672
      const scene=source.getContext('2d')!;scene.drawImage(images[0],0,0,941,1672)
      SPACE_DECOR.forEach((d,i)=>{scene.save();scene.shadowColor='rgba(72,39,19,.22)';scene.shadowBlur=4;scene.shadowOffsetX=2;scene.shadowOffsetY=4;scene.drawImage(images[i+1],d.x,d.y,d.width,d.height);scene.restore()})
      const extra=1+SPACE_DECOR.length;scene.drawImage(images[extra],443,840,113,158)
      scene.drawImage(images[extra+1],735,206,60,67)
      scene.drawImage(images[extra+2],329,1106,24,28);scene.drawImage(images[extra+3],354,1106,24,28)
      const pixels=scene.getImageData(0,0,941,1672).data
      const render=()=>{
        const canvas=ref.current,parent=canvas?.parentElement;if(!canvas||!parent||!alive)return
        const {width,height}=parent.getBoundingClientRect();if(!width||!height)return
        const dpr=Math.min(window.devicePixelRatio||1,2)
        canvas.width=Math.round(width*dpr);canvas.height=Math.round(height*dpr)
        const ctx=canvas.getContext('2d')!,out=ctx.createImageData(canvas.width,canvas.height)
        const paperW=Math.min(width-64,520),paperH=paperW*480/640,left=(width-paperW)/2,top=(height-paperH)/2
        const m=spaceObjectPlaneMatrix(1,1,{x:0,y:0,width:1,height:1},[[432,1096],[940,1174],[837,1333],[220,1242]])
        for(let y=0;y<canvas.height;y++)for(let x=0;x<canvas.width;x++){
          const u=(x/dpr-left)/paperW,v=(y/dpr-top)/paperH,z=m[3]*u+m[7]*v+1
          const sx=Math.round(Math.max(0,Math.min(940,(m[0]*u+m[4]*v+m[12])/z)))
          const sy=Math.round(Math.max(0,Math.min(1671,(m[1]*u+m[5]*v+m[13])/z)))
          const src=(sy*941+sx)*4,dst=(y*canvas.width+x)*4
          out.data[dst]=pixels[src];out.data[dst+1]=pixels[src+1];out.data[dst+2]=pixels[src+2];out.data[dst+3]=255
        }
        ctx.putImageData(out,0,0)
      }
      frame=requestAnimationFrame(render)
      window.addEventListener('resize',render)
      cleanupResize=()=>window.removeEventListener('resize',render)
    }).catch(()=>{ /* Keep the persistent room beneath if projection is unavailable. */ })
    let cleanupResize=()=>{}
    return()=>{alive=false;cancelAnimationFrame(frame);cleanupResize()}
  },[native])
  return <canvas ref={ref} className="space-book-desk-camera" aria-hidden="true" />
}
