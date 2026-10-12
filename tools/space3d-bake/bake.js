import * as T from 'three'
import { buildFixedScene } from '../../src/lib/space3d/geometry.js'

// Offline environment-only scene. No sun, lamps, movable props or color-texture shadows.
const material = new T.MeshStandardMaterial({ color: '#FFFFFF', side: T.DoubleSide })
const { root, bakeSurfaces } = buildFixedScene({ wood: material, wall: material, linen: material, glass: material })
const scene = new T.Scene(); scene.add(root); scene.add(new T.AmbientLight('#FFFFFF', 1))
root.updateMatrixWorld(true)
// Millimeter bevels do not affect this low-frequency bake; solid proxies retain every seam and hole.
const occluders = root.children.filter(mesh => mesh.name !== 'window-glass').map(mesh => {
  mesh.geometry.computeBoundingBox()
  const bounds=mesh.geometry.boundingBox,size=bounds.getSize(new T.Vector3())
  const proxy=new T.Mesh(new T.BoxGeometry(size.x,size.y,size.z),material)
  proxy.position.copy(bounds.getCenter(new T.Vector3()).applyMatrix4(mesh.matrixWorld))
  proxy.updateMatrixWorld(true);return proxy
})
const ray = new T.Raycaster(), vector = new T.Vector3(), normal = new T.Vector3()
const p = new T.Vector3(), a = new T.Vector3(), b = new T.Vector3(), c = new T.Vector3()
const na = new T.Vector3(), nb = new T.Vector3(), nc = new T.Vector3()
const tangent = new T.Vector3(), bitangent = new T.Vector3(), origin = new T.Vector3()

function bake(mesh) {
  // 128² low-frequency samples, 12 cosine hemisphere rays per sample; smooth 1024² output.
  const n = 128, ao = new Float32Array(n*n).fill(1), light = new Float32Array(n*n).fill(.08)
  const geometry = mesh.geometry, position = geometry.attributes.position, uv = geometry.attributes.uv1
  const normals = geometry.attributes.normal, matrix = new T.Matrix3().getNormalMatrix(mesh.matrixWorld)
  const tested = new Uint8Array(n*n)
  for (let t=0;t<position.count;t+=3) {
    const indices = [t,t+1,t+2]
    const u=indices.map(i=>uv.getX(i)*n),v=indices.map(i=>(1-uv.getY(i))*n)
    const denominator=(v[1]-v[2])*(u[0]-u[2])+(u[2]-u[1])*(v[0]-v[2]);if(Math.abs(denominator)<1e-6)continue
    a.fromBufferAttribute(position,t).applyMatrix4(mesh.matrixWorld)
    b.fromBufferAttribute(position,t+1).applyMatrix4(mesh.matrixWorld)
    c.fromBufferAttribute(position,t+2).applyMatrix4(mesh.matrixWorld)
    na.fromBufferAttribute(normals,t).applyMatrix3(matrix).normalize();nb.fromBufferAttribute(normals,t+1).applyMatrix3(matrix).normalize();nc.fromBufferAttribute(normals,t+2).applyMatrix3(matrix).normalize()
    for(let y=Math.max(0,Math.floor(Math.min(...v)));y<Math.min(n,Math.ceil(Math.max(...v)));y++)
      for(let x=Math.max(0,Math.floor(Math.min(...u)));x<Math.min(n,Math.ceil(Math.max(...u)));x++){
        const index=y*n+x;if(tested[index])continue
        const w0=((v[1]-v[2])*(x+.5-u[2])+(u[2]-u[1])*(y+.5-v[2]))/denominator
        const w1=((v[2]-v[0])*(x+.5-u[2])+(u[0]-u[2])*(y+.5-v[2]))/denominator,w2=1-w0-w1
        if(Math.min(w0,w1,w2)<-.001)continue;tested[index]=1
        p.copy(a).multiplyScalar(w0).addScaledVector(b,w1).addScaledVector(c,w2)
        normal.copy(na).multiplyScalar(w0).addScaledVector(nb,w1).addScaledVector(nc,w2).normalize()
        origin.copy(p).addScaledVector(normal,.004)
        tangent.crossVectors(normal,Math.abs(normal.y)<.9?new T.Vector3(0,1,0):new T.Vector3(1,0,0)).normalize()
        bitangent.crossVectors(normal,tangent)
        let occlusion=0
        for(let sample=0;sample<12;sample++){
          const radius=Math.sqrt((sample+.5)/12),phi=sample*2.399963229728653
          vector.copy(normal).multiplyScalar(Math.sqrt(1-radius*radius)).addScaledVector(tangent,radius*Math.cos(phi)).addScaledVector(bitangent,radius*Math.sin(phi)).normalize()
          ray.set(origin,vector);ray.far=.28
          const hit=ray.intersectObjects(occluders,false)[0]
          if(hit)occlusion+=Math.exp(-hit.distance/.09)
        }
        ao[index]=1-occlusion/12*.8
        let irradiance=0
        // Uniform diffuse aperture integration: no solar direction or hard sun patch.
        for(let sample=0;sample<9;sample++){
          vector.set(-.99,.98+Math.floor(sample/3)*.40,-.27+(sample%3)*.40).sub(origin)
          const distance=vector.length(),cosine=Math.max(0,normal.dot(vector.clone().normalize()))
          ray.set(origin,vector.normalize());ray.far=distance-.02
          if(!ray.intersectObjects(occluders,false).length)irradiance+=cosine/(1+distance*distance)
        }
        light[index]=.08+irradiance/9*.85
      }
  }
  function png(values){
    const low=document.createElement('canvas');low.width=low.height=n;const ctx=low.getContext('2d'),image=ctx.createImageData(n,n)
    values.forEach((value,i)=>{image.data[i*4]=image.data[i*4+1]=image.data[i*4+2]=Math.round(value*255);image.data[i*4+3]=255})
    ctx.putImageData(image,0,0)
    const output=document.createElement('canvas');output.width=output.height=mesh.userData.aoOnly?512:1024
    output.getContext('2d').drawImage(low,0,0,output.width,output.height)
    return output.toDataURL('image/png').split(',')[1]
  }
  return { name: mesh.name, ao: png(ao), light: mesh.userData.aoOnly?null:png(light), size:mesh.userData.aoOnly?512:1024 }
}
window.bakeSpace = async () => {
  const results=[]
  for(const mesh of bakeSurfaces){results.push(bake(mesh));await new Promise(resolve=>setTimeout(resolve,0))}
  return { results, metadata: { three:'0.180.0', resolution:1024, samplingResolution:128, hemisphereRays:12,
    colorSpace:'linear', gamma:1, sunlight:false, movableObjects:false, seed:'deterministic-golden-angle' } }
}
window.bakeReady = true
