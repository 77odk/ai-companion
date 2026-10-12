// Only the printed photographs from the existing 2D content are sampled.
// No wall, table, plant, jar, book, shadow or whole-scene image becomes a texture.
export const PRINT_SIZES=[[.24,.29],[.24,.27],[.23,.29],[.23,.27],[.30,.27],[.25,.28],[.23,.25],[.24,.28]]
const quads=[
  [[179,134],[248,120],[253,197],[185,211]],
  [[282,136],[349,137],[343,220],[276,217]],
  [[372,94],[449,90],[443,192],[369,192]],
  [[168,243],[227,237],[234,297],[172,304]],
  [[245,257],[345,257],[337,340],[238,334]],
  [[367,288],[446,294],[433,354],[354,350]],
  [[175,328],[235,324],[241,389],[181,395]],
  [[400,370],[465,376],[460,446],[388,436]],
]
let cached
const point=(q,u,v)=>[0,1].map(axis=>(1-u)*(1-v)*q[0][axis]+u*(1-v)*q[1][axis]+u*v*q[2][axis]+(1-u)*v*q[3][axis])
const distance=(a,b)=>Math.hypot(a[0]-b[0],a[1]-b[1])
function triangle(ctx,image,s,d) {
  const denominator=s[0][0]*(s[1][1]-s[2][1])+s[1][0]*(s[2][1]-s[0][1])+s[2][0]*(s[0][1]-s[1][1])
  const row=axis=>[
    (d[0][axis]*(s[1][1]-s[2][1])+d[1][axis]*(s[2][1]-s[0][1])+d[2][axis]*(s[0][1]-s[1][1]))/denominator,
    (d[0][axis]*(s[2][0]-s[1][0])+d[1][axis]*(s[0][0]-s[2][0])+d[2][axis]*(s[1][0]-s[0][0]))/denominator,
    (d[0][axis]*(s[1][0]*s[2][1]-s[2][0]*s[1][1])+d[1][axis]*(s[2][0]*s[0][1]-s[0][0]*s[2][1])+d[2][axis]*(s[0][0]*s[1][1]-s[1][0]*s[0][1]))/denominator,
  ]
  const x=row(0),y=row(1)
  // Slightly overlap adjacent clips: two half-covered antialiased edges would
  // otherwise reveal the paper between warp cells, especially in dark prints.
  const center=[0,1].map(axis=>d.reduce((sum,p)=>sum+p[axis],0)/3)
  const clip=d.map(p=>{const dx=p[0]-center[0],dy=p[1]-center[1],length=Math.hypot(dx,dy);return [p[0]+dx/length*.85,p[1]+dy/length*.85]})
  ctx.save();ctx.beginPath();clip.forEach((p,i)=>i?ctx.lineTo(...p):ctx.moveTo(...p));ctx.closePath();ctx.clip()
  ctx.setTransform(x[0],y[0],x[1],y[1],x[2],y[2]);ctx.drawImage(image,0,0);ctx.restore()
}
/** One cached, perspective-rectified canvas per printed photo, not a background. */
export function legacyPrintCanvases() {
  if(cached)return cached
  cached=new Promise((resolve,reject)=>{
    const image=new Image()
    image.onerror=()=>{cached=null;reject(new Error('Original printed-photo content unavailable'))}
    image.onload=()=>{
      const result=quads.map((q,index)=>{
        const canvas=document.createElement('canvas');canvas.width=canvas.height=512
        const ctx=canvas.getContext('2d');ctx.fillStyle='#F1EBDD';ctx.fillRect(0,0,512,512)
        const sourceWidth=(distance(q[0],q[1])+distance(q[3],q[2]))/2
        const sourceHeight=(distance(q[0],q[3])+distance(q[1],q[2]))/2
        const [paperWidth,paperHeight]=PRINT_SIZES[index]
        const fit=Math.min(paperWidth*456/512/sourceWidth,paperHeight*400/512/sourceHeight)
        const width=sourceWidth*fit/paperWidth*512,height=sourceHeight*fit/paperHeight*512
        const left=(512-width)/2,top=20+(400-height)/2,n=8
        ctx.save();ctx.beginPath();ctx.rect(left,top,width,height);ctx.clip()
        for(let y=0;y<n;y++)for(let x=0;x<n;x++){
          const uv=[[x/n,y/n],[(x+1)/n,y/n],[(x+1)/n,(y+1)/n],[x/n,(y+1)/n]]
          const source=uv.map(([u,v])=>point(q,u,v)),dest=uv.map(([u,v])=>[left+u*width,top+v*height])
          for(const indices of [[0,1,2],[0,2,3]])triangle(ctx,image,indices.map(i=>source[i]),indices.map(i=>dest[i]))
        }
        ctx.restore();return canvas
      })
      resolve(result)
    }
    // Original repository file stays byte-for-byte unchanged; only its eight
    // existing photo interiors are read into separate offscreen canvases.
    image.src='/space/space-desk.webp'
  })
  return cached
}
