import {readFile,writeFile,mkdir} from 'node:fs/promises'
import {dirname,extname} from 'node:path'
import {openBrowser} from './space3d-browser.mjs'

// Node + the already approved local Chromium only. No npm or Python package.
const args=process.argv.slice(2),index=args.indexOf('--output')
const output=index<0?null:args.splice(index,2)[1]
const compare=args.includes('--comparisons');if(compare)args.splice(args.indexOf('--comparisons'),1)
const browser=await openBrowser()
try{
 await browser.evaluate(`window.measureSpaceTexture=async source=>{
  const image=new Image();image.src=source;await image.decode();
  const width=image.naturalWidth,height=image.naturalHeight,canvas=document.createElement('canvas');canvas.width=width;canvas.height=height;
  const ctx=canvas.getContext('2d',{willReadFrequently:true});ctx.drawImage(image,0,0);
  const rgba=ctx.getImageData(0,0,width,height).data,lum=new Float64Array(width*height),colors=new Set(),samples=new Set();
  let brightness=0,saturation=0,detail=0,flat=0,topFlat=0;
  for(let y=0;y<height;y++)for(let x=0;x<width;x++){
   const i=y*width+x,p=i*4,r=rgba[p],g=rgba[p+1],b=rgba[p+2],max=Math.max(r,g,b);
   lum[i]=.299*r+.587*g+.114*b;brightness+=lum[i];saturation+=max?(max-Math.min(r,g,b))/max:0;
   const key=((r>>5)<<6)|((g>>5)<<3)|(b>>5);colors.add(key);if(x%5===0&&y%5===0)samples.add(key);
  }
  const reflected=(n,size)=>n<0?-n:n>=size?2*size-2-n:n;
  for(let y=0;y<height;y++)for(let x=0;x<width;x++){
   const i=y*width+x,dx=x===0?lum[i+1]-lum[i]:x===width-1?lum[i]-lum[i-1]:(lum[i+1]-lum[i-1])/2;
   const dy=y===0?lum[i+width]-lum[i]:y===height-1?lum[i]-lum[i-width]:(lum[i+width]-lum[i-width])/2;
   if(Math.hypot(dx,dy)>8)detail++;
   let mean=0,variance=0;
   for(let oy=-1;oy<=1;oy++)for(let ox=-1;ox<=1;ox++)mean+=lum[reflected(y+oy,height)*width+reflected(x+ox,width)];mean/=9;
   for(let oy=-1;oy<=1;oy++)for(let ox=-1;ox<=1;ox++){const d=lum[reflected(y+oy,height)*width+reflected(x+ox,width)]-mean;variance+=d*d;}
   if(Math.sqrt(variance/9)<1.2){flat++;if(y<Math.floor(height*.4))topFlat++;}
  }
  return {width,height,brightness:brightness/(width*height),saturation:saturation/(width*height),detailPercent:detail/(width*height)*100,
   flatPercent:flat/(width*height)*100,top40FlatPercent:topFlat/(width*Math.floor(height*.4))*100,
   quantizedColorsFull:colors.size,quantizedColorsSample5:samples.size};
 }`)
 const source=async file=>'data:image/'+(extname(file)==='.webp'?'webp':'png')+';base64,'+(await readFile(file)).toString('base64')
 const images=[]
 for(const file of new Set(args.filter(file=>!file.endsWith('-comparison.png'))))images.push({file,...await browser.evaluate(`window.measureSpaceTexture(${JSON.stringify(await source(file))})`)})
 const result={definition:{brightness:'0.299R+0.587G+0.114B; native uint8 RGB',saturation:'(max-min)/max; black=0',
  detail:'centered luminance gradient magnitude >8; one-sided boundary differences',flat:'3x3 population std <1.2; reflect padding',
  scope:'whole native image, including existing UI; no resizing or crop',quantization:'RGB >>5; full pixels and auxiliary regular 5x5 samples. Project sampling step is unconfirmed; color counts are not claimed identical.'},
  decoder:(await browser.cdp('Browser.getVersion')).product,images}
 if(output){await mkdir(dirname(output),{recursive:true});await writeFile(output,JSON.stringify(result,null,2)+'\n')}
 if(compare){
  for(const mode of ['overview','reading','drawer']){
   const files=['public/space/space-desk.webp',`docs/space3d-validation/texture-rework/before/phone-${mode}.png`,`docs/space3d-validation/baselines/phone-${mode}.png`]
   const sources=await Promise.all(files.map(source))
   const png=await browser.evaluate(`(async()=>{
    const images=await Promise.all(${JSON.stringify(sources)}.map(async src=>{const i=new Image();i.src=src;await i.decode();return i}));
    const canvas=document.createElement('canvas');canvas.width=images.reduce((sum,i)=>sum+i.width,0)+64;canvas.height=Math.max(...images.map(i=>i.height))+64;
    const ctx=canvas.getContext('2d');ctx.fillStyle='#E5DDCF';ctx.fillRect(0,0,canvas.width,canvas.height);ctx.fillStyle='#30271D';ctx.font='20px sans-serif';
    let x=16;images.forEach((i,n)=>{ctx.fillText(['Reference','Before','Reworked'][n],x,30);ctx.drawImage(i,x,48);x+=i.width+16});
    return canvas.toDataURL('image/png').split(',')[1];
   })()`)
   await writeFile(`docs/space3d-validation/texture-rework/phone-${mode}-comparison.png`,Buffer.from(png,'base64'))
  }
 }
 console.log(JSON.stringify({measured:images.length,output,comparisons:compare,
  summary:images.filter(image=>image.file.includes('baselines/phone-')||image.file.endsWith('finish-off.png'))},null,2))
}finally{await browser.close()}
