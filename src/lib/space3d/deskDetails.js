import * as T from 'three'
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js'
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js'

// Real geometry, assembled once. Decorative batches have no content/data state.
export function addDeskDetails(root, materials) {
  const batches = { ceramic: [], wood: [], cloth: [], stems: [], petals: [] }
  const transform = new T.Object3D()
  function piece(batch, geometry, position, scale, color, rotation = [0, 0, 0]) {
    const g = geometry.index ? geometry.toNonIndexed() : geometry.clone()
    transform.position.set(...position); transform.scale.set(...scale); transform.rotation.set(...rotation); transform.updateMatrix()
    g.applyMatrix4(transform.matrix); g.clearGroups()
    g.deleteAttribute('uv1')
    // Independent world projection for the merged wood/cloth textures.
    const positions=g.attributes.position,uv=new Float32Array(positions.count*2)
    for(let i=0;i<positions.count;i++){uv[i*2]=positions.getX(i)*2;uv[i*2+1]=(positions.getZ(i)+positions.getY(i))*2}
    g.setAttribute('uv',new T.BufferAttribute(uv,2))
    const c = new T.Color(color), colors = new Float32Array(g.attributes.position.count * 3)
    if(batch==='wood'||batch==='cloth'){
      const base=new T.Color(batch==='wood'?'#A9744F':'#B69B74')
      c.r/=base.r;c.g/=base.g;c.b/=base.b
    }
    for (let i = 0; i < colors.length; i += 3) c.toArray(colors, i)
    g.setAttribute('color', new T.BufferAttribute(colors, 3)); batches[batch].push(g)
    geometry.dispose()
  }
  const cylinder = (r, height) => new T.CylinderGeometry(r, r, height, 12)
  // Open ceramic pots and a pencil cup, with a rounded lip and a visible bottom.
  function pot(x, z, radius, height, color, baseY=.752) {
    const profile = [[0,0],[radius*.8,0],[radius,.015],[radius*.96,height-.004],
      [radius*.92,height],[radius*.86,height-.004],[radius*.87,.018],[0,.018]]
    piece('ceramic', new T.LatheGeometry(profile.map(p=>new T.Vector2(...p)),20), [x,baseY,z],[1,1,1],color)
  }
  pot(-.46,-.05,.055,.11,'#E5DED0')
  for(let i=0;i<6;i++)piece('wood',cylinder(.003,.16+i%3*.012),
    [-.48+(i%3)*.015,.87,-.06+Math.floor(i/3)*.024],[1,1,1],i%2?'#4E453C':'#9C6540',[.09*(i-2),0,.08*(i-3)])
  pot(.48,.08,.06,.095,'#E5DED0')
  pot(-.53,-.39,.05,.12,'#E5DED0',1.925)
  // Flowers stand on the desk; ivy hangs from the upper shelf and casts leaf shadows.
  piece('ceramic',new T.LatheGeometry([[0,0],[.065,0],[.075,.08],[.051,.14],[.027,.18],[.023,.19],[.020,.187],[.024,.145],[0,.012]].map(p=>new T.Vector2(...p)),20),
    [-.48,.752,-.19],[1,1,1],'#E5DED0')
  piece('wood',new RoundedBoxGeometry(1.15,.034,.11,2,.003),[-.10,1.91,-.39],[1,1,1],'#9C6540')
  // A small real ribbon, draped over the book edge.
  const ribbon = new T.CatmullRomCurve3([new T.Vector3(-.08,.795,.105),new T.Vector3(-.08,.79,.30),new T.Vector3(-.07,.756,.37)])
  piece('cloth',new T.TubeGeometry(ribbon,12,.004,4,false),[0,0,0],[1,1,1],'#BE8F83')

  const shape = new T.Shape()
  shape.moveTo(0,0);shape.bezierCurveTo(-.56,.25,-.70,.75,-.29,.94)
  shape.bezierCurveTo(-.12,1.06,0,.92,0,.88)
  shape.bezierCurveTo(.13,1.08,.52,1.03,.57,.65);shape.bezierCurveTo(.56,.37,.14,.12,0,0)
  const leafGeometry = new T.ExtrudeGeometry(shape,{depth:.018,bevelEnabled:true,bevelThickness:.008,bevelSize:.008,bevelSegments:1,steps:1,curveSegments:5})
  leafGeometry.clearGroups()
  // Convex rib and curved blade, rather than transparent billboards.
  const p=leafGeometry.attributes.position
  for(let i=0;i<p.count;i++)p.setZ(i,p.getZ(i)+Math.sin(p.getY(i)*Math.PI)*.10-Math.abs(p.getX(i))*.13)
  leafGeometry.computeVertexNormals()
  const leafColors=new Float32Array(p.count*3)
  for(let i=0;i<p.count;i++){
    const rib=Math.abs(p.getX(i))<.018?1.16:.84+p.getY(i)*.12
    leafColors.set([rib,rib,rib],i*3)
  }
  leafGeometry.setAttribute('color',new T.BufferAttribute(leafColors,3))
  // Attach the petiole at the heart-shaped base; the pointed end hangs down.
  leafGeometry.translate(0,-.88,0)
  const leafMaterial=new T.MeshStandardMaterial({color:'#FFFFFF',vertexColors:true,roughness:.82,metalness:0,side:T.DoubleSide})
  const leaves=new T.InstancedMesh(leafGeometry,leafMaterial,80)
  leaves.name='ivy-and-potted-leaves';leaves.castShadow=true;leaves.receiveShadow=true
  const palette=['#426D21','#5B7D28','#6E9033','#35541E']
  let leafIndex=0
  function leaf(position,size,rotation,index) {
    transform.position.set(...position);transform.scale.set(size,size,size);transform.rotation.set(...rotation);transform.updateMatrix()
    leaves.setMatrixAt(leafIndex,transform.matrix);leaves.setColorAt(leafIndex,new T.Color(palette[index%palette.length]));leafIndex++
  }
  for(let vine=0;vine<3;vine++) {
    const nodes=[]
    for(let i=0;i<15;i++) {
      const y=1.98-i*.068, x=-.55+vine*.06+Math.sin(i*.65+vine)*.036, z=-.28+vine*.055+Math.cos(i*.53)*.025
      nodes.push(new T.Vector3(x,y,z))
      if(i<14)leaf([x,y,z],.10+(i%4)*.013,[.10+vine*.18,-.3+vine*.27,i%2?-.6:.6],i+vine)
    }
    piece('stems',new T.TubeGeometry(new T.CatmullRomCurve3(nodes),32,.0025,4,false),[0,0,0],[1,1,1],'#667B35')
  }
  for(let i=0;i<18;i++) {
    const side=i<9?-1:1, j=i%9, x=side<0?-.48:.48, z=side<0?-.19:.08
    const tip=[x+Math.sin(j*2.4)*.075,(side<0?1.0:.89)+(j%4)*.038,z+Math.cos(j*2.4)*.055]
    const curve=new T.CatmullRomCurve3([new T.Vector3(x,.81,z),new T.Vector3(x,.88,z),new T.Vector3(...tip)])
    piece('stems',new T.TubeGeometry(curve,8,.0018,3,false),[0,0,0],[1,1,1],'#668044')
    leaf(tip,.075,[.35,j*.9,Math.PI/2+j*.6],j)
  }
  // Daisies: each petal is a small thick curved solid; all blossoms share one batch.
  for(let i=0;i<7;i++) {
    const tip=[-.46+Math.sin(i*2.4)*.065,1.06+(i%3)*.035,-.17+Math.cos(i*2.4)*.045]
    piece('stems',new T.TubeGeometry(new T.CatmullRomCurve3([new T.Vector3(-.48,.92,-.19),new T.Vector3(...tip)]),5,.0013,3,false),[0,0,0],[1,1,1],'#6E8739')
    for(let j=0;j<8;j++){
      const a=j*Math.PI/4
      piece('petals',new T.SphereGeometry(1,6,4),[tip[0]+Math.cos(a)*.012,tip[1]+Math.sin(a)*.012,tip[2]],[.006,.014,.0035],'#F1EBDD',[0,0,a-Math.PI/2])
    }
    piece('petals',new T.SphereGeometry(.005,8,5),tip,[1,1,.7],'#CCA85B')
  }
  leaves.count=leafIndex;root.add(leaves)
  for(const [name,geometries] of Object.entries(batches)) {
    const g=mergeGeometries(geometries,false)
    const source=name==='wood'?materials.wood:name==='cloth'?materials.linen:null
    const m=source?source.clone():new T.MeshStandardMaterial({roughness:({ceramic:.32,stems:.85,petals:.93})[name],metalness:0})
    m.vertexColors=true
    const mesh=new T.Mesh(g,m);mesh.name=`desk-detail-${name}`;mesh.receiveShadow=true;mesh.castShadow=false;root.add(mesh)
    geometries.forEach(g=>g.dispose())
  }
  return leaves
}

/** Faceted, puffed folded-paper star; ten alternating perimeter vertices. */
export function foldedStarGeometry(radius) {
  const vertices=[]
  for(let face=0;face<2;face++)for(let i=0;i<10;i++) {
    const j=(i+1)%10,a=i*Math.PI/5,b=j*Math.PI/5,r=i%2?radius*.48:radius,s=j%2?radius*.48:radius
    const edgeA=[Math.sin(a)*r,Math.cos(a)*r,0],edgeB=[Math.sin(b)*s,Math.cos(b)*s,0],center=[0,0,(face?-.36:.36)*radius]
    vertices.push(...center,...(face?edgeA:edgeB),...(face?edgeB:edgeA))
  }
  const uv=[]
  for(let i=0;i<vertices.length;i+=3)uv.push(.5+vertices[i]/(radius*2),.5+vertices[i+1]/(radius*2))
  const g=new T.BufferGeometry();g.setAttribute('position',new T.Float32BufferAttribute(vertices,3))
  g.setAttribute('uv',new T.Float32BufferAttribute(uv,2));g.computeVertexNormals();return g
}
