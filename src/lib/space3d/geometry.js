import * as T from 'three'
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js'
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js'
import { addDeskDetails, foldedStarGeometry } from './deskDetails.js'
import { PRINT_SIZES } from './legacyPrints.js'

/** Shared fixed geometry is the only geometry supplied to the offline baker. */
export function buildFixedScene(materials) {
  const root = new T.Group(), bakeSurfaces = []
  function box(name, size, position, material, bevel = .003, shadow = true) {
    const geometry = new RoundedBoxGeometry(...size, 2, bevel)
    // AO/lightMap use independent uv1, never color UV channels.
    const uv1 = geometry.getAttribute('uv').clone()
    geometry.groups.forEach((group, face) => {
      for (let i = group.start; i < group.start + group.count; i++) {
        const index = geometry.index ? geometry.index.getX(i) : i
        uv1.setXY(index, (face % 3 + uv1.getX(index)) / 3,
          (Math.floor(face / 3) + uv1.getY(index)) / 2)
      }
    })
    geometry.setAttribute('uv1', uv1)
    let surface = material
    if (name === 'desktop' || name === 'drawer-panel' || name === 'drawer-handle') {
      // Subtle 1mm wear only on the exposed, regularly touched front edge.
      const positions=geometry.attributes.position,colors=new Float32Array(positions.count*3)
      for(let i=0;i<positions.count;i++){
        const edge=positions.getZ(i)>size[2]/2-.001 && (name!=='desktop'||positions.getY(i)>size[1]/2-.001)
        const factor=edge?1.03:1;colors.set([factor,factor,factor],i*3)
      }
      geometry.setAttribute('color',new T.BufferAttribute(colors,3));surface=material.clone();surface.vertexColors=true
    }
    const mesh = new T.Mesh(geometry, surface); mesh.name = name
    mesh.position.set(...position); mesh.castShadow = shadow; mesh.receiveShadow = true
    root.add(mesh); return mesh
  }
  const top = box('desktop', [1.4, .03, .6], [0, .735, 0], materials.wood)
  bakeSurfaces.push(top)
  const body = []
  for (const x of [-.64, .64]) body.push(box(`desk-leg-front-${x<0?'left':'right'}`, [.065, .72, .065], [x, .36, .23], materials.wood))
  for (const x of [-.64, .64]) body.push(box(`desk-leg-back-${x<0?'left':'right'}`, [.065, .72, .065], [x, .36, -.23], materials.wood))
  body.push(box('drawer-left', [.025, .14, .5], [-.09, .64, 0], materials.wood))
  body.push(box('drawer-right', [.025, .14, .5], [.59, .64, 0], materials.wood))
  body.push(box('drawer-back', [.70, .14, .025], [.25, .64, -.25], materials.wood))
  body.push(box('desk-front-apron',[.64,.16,.025],[-.37,.635,.28],materials.wood))
  body.forEach(mesh=>{mesh.castShadow=false;mesh.userData.aoOnly=true;bakeSurfaces.push(mesh)})
  bakeSurfaces.push(box('back-wall', [2.6, 2.6, .14], [0, 1.3, -.42], materials.wall, .002))
  // Left wall at x=-.8; hole: z=-.35..+.65, y=.9..1.9. Real solids block sun.
  for (const [name, size, position] of [
    ['window-wall-bottom', [.14, .9, 2], [-.80, .45, .15]],
    ['window-wall-top', [.14, .7, 2], [-.80, 2.25, .15]],
    ['window-wall-back', [.14, 1, .5], [-.80, 1.4, -.60]],
    ['window-wall-front', [.14, 1, .5], [-.80, 1.4, .90]],
  ]) bakeSurfaces.push(box(name, size, position, materials.wall, .002))
  const floor = box('floor', [2.6, .1, 2], [0, -.05, .15], materials.floor??materials.linen, .002, false)
  bakeSurfaces.push(floor)
  for (const z of [-.35, .65]) box('window-frame', [.05, 1.06, .045], [-.71, 1.4, z], materials.wood, .002)
  for (const y of [.9, 1.9]) box('window-frame', [.05, .045, 1.06], [-.71, y, .15], materials.wood, .002)
  box('window-crossbar', [.04, .025, 1], [-.70, 1.4, .15], materials.wood, .002)
  box('window-sill', [.22, .045, 1.14], [-.71, .8775, .15], materials.wood, .003)
  // No opaque glass shadows; thickness still gives an identifiable edge.
  box('window-glass', [.005, .95, .95], [-.775, 1.4, .15], materials.glass, .001, false)
  root.updateMatrixWorld(true)
  return { root, bakeSurfaces, box }
}

export function buildDeskScene(materials) {
  const fixed = buildFixedScene(materials), { root, box } = fixed
  // Runtime batch of the five frame solids. Offline baking still sees each solid.
  const frameParts=root.children.filter(mesh=>['window-frame','window-crossbar'].includes(mesh.name))
  const frameGeometries=frameParts.map(mesh=>mesh.geometry.clone().applyMatrix4(mesh.matrixWorld))
  const frame=new T.Mesh(mergeGeometries(frameGeometries,false),materials.wood)
  frame.name='window-frame-batch';frame.castShadow=frame.receiveShadow=true;root.add(frame)
  frameParts.forEach(mesh=>{root.remove(mesh);mesh.geometry.dispose()});frameGeometries.forEach(g=>g.dispose())
  const anchors = new Map()
  const cloneMaterial=material=>{const clone=material.clone();clone.onBeforeCompile=material.onBeforeCompile;clone.customProgramCacheKey=material.customProgramCacheKey;return clone}
  const tag = (mesh, hit) => {
    mesh.userData.hit = hit
    if (mesh.material) mesh.material = Array.isArray(mesh.material)
      ? mesh.material.map(cloneMaterial) : cloneMaterial(mesh.material)
    return mesh
  }
  const drawer = new T.Group(); root.add(drawer)
  function drawerBox(name, size, position, material, bevel = .0015) {
    const mesh = box(name, size, position, material, bevel); drawer.attach(mesh); tag(mesh, 'drawer'); return mesh
  }
  drawerBox('drawer-panel', [.69, .12, .022], [0, .64, .29], materials.wood)
  drawerBox('drawer-base', [.64, .014, .46], [0, .585, .03], materials.wood)
  for (const x of [-.32, .32]) drawerBox('drawer-side', [.014, .11, .46], [x, .64, .03], materials.wood)
  drawerBox('drawer-handle', [.15, .014, .025], [0, .64, .316], materials.dark).castShadow=false
  for (const x of [-.095, .595]) box('drawer-rail', [.009, .009, .45], [x, .605, .01], materials.dark, .001, false)
  const letters = []
  for (let i = 0; i < 5; i++) {
    const letter=drawerBox('letter', [.21, .002, .13], [-.04 + i * .012, .60 + i * .004, .02 + i * .006], materials.paper, .001)
    letter.castShadow=false;letters.push(letter)
  }
  drawer.position.x=.25
  anchors.set('drawer', new T.Vector3(.25, .64, .32))
  const book = new T.Group(); book.position.set(-.08, .767, .03); root.add(book)
  const spine=tag(box('book-spine',[.014,.018,.44],[-.08,.761,.03],materials.linen,.0015,false),'book')
  book.attach(spine)
  const bookParts = []
  for (const x of [-.158, .158]) {
    const cover = box('book-cover', [.312, .006, .446], [x - .08, .758, .03], materials.linen, .0015)
    book.attach(cover); tag(cover, 'book'); bookParts.push(cover)
    const paper = box('book-paper-edge', [.302, .012, .432], [x - .08, .767, .03], materials.paper, .001)
    book.attach(paper); tag(paper, 'book'); bookParts.push(paper)
  }
  const pages = []
  for (const x of [-.158, .158]) {
    const geometry=new T.BoxGeometry(.30,.43,.0015,16,1,1)
    const front={...geometry.groups[4]},back={...geometry.groups[5]}
    geometry.clearGroups();geometry.addGroup(0,front.start,0)
    geometry.addGroup(front.start,front.count,1);geometry.addGroup(back.start,back.count,0)
    const page = new T.Mesh(geometry, [materials.paper.clone(),materials.paper.clone()])
    page.rotation.x = -Math.PI / 2; page.position.set(x, .009, 0)
    // The lower unused texture area is cropped; no page-ratio stretching.
    const uv = page.geometry.getAttribute('uv')
    for (let i = 0; i < uv.count; i++) uv.setY(i, 1 - (1 - uv.getY(i)) * 1468 / 2048)
    tag(page, 'book');page.userData.pageMaterial=page.material[1]
    page.receiveShadow = true; book.add(page); pages.push(page)
  }
  book.position.z=.105
  anchors.set('book', new T.Vector3(-.08, .78, .105))
  const player = tag(box('player', [.29, .18, .018], [.30, .85, -.20], materials.dark), 'player')
  player.rotation.x=-.18
  const screen = tag(box('player-screen', [.257, .145, .003], [.30, .85, -.189], materials.screen), 'player')
  screen.rotation.x=-.18;screen.castShadow=false
  anchors.set('player', player.position.clone())
  const jar = new T.Group(); jar.position.set(-.37, .75, -.22); root.add(jar)
  // Thick lathed ceramic rim and bottom, transparent double-wall glass body.
  const profile = [[.065,0],[.07,.006],[.078,.03],[.08,.14],[.067,.17],[.066,.177],[.063,.179],[.059,.176],[.06,.169],[.073,.137],[.071,.03],[.063,.012],[0,.012]]
  const body = new T.Mesh(new T.LatheGeometry(profile.map(p => new T.Vector2(...p)), 28), materials.glass)
  body.receiveShadow = true; jar.add(body); tag(body, 'jar')
  const jarBase=tag(new T.Mesh(new T.CylinderGeometry(.063,.064,.008,28),materials.ceramicBase),'jar')
  jarBase.position.y=.007;jarBase.receiveShadow=true;jar.add(jarBase)
  for (const [radius, y, material] of [[.065,.006,materials.ceramicBase],[.063,.175,materials.ceramic]]) {
    const ring = new T.Mesh(new T.TorusGeometry(radius, .003, 6, 28), material)
    ring.rotation.x = Math.PI / 2; ring.position.y = y; ring.castShadow = false; jar.add(ring); tag(ring, 'jar')
  }
  const stars = new T.InstancedMesh(new T.OctahedronGeometry(.008), materials.paper, 48)
  const matrix = new T.Matrix4()
  for (let i=0;i<48;i++) { matrix.makeTranslation(Math.sin(i*7)*.045, .018+(i%9)*.013, Math.cos(i*11)*.045); stars.setMatrixAt(i,matrix) }
  jar.add(stars); tag(stars,'jar'); anchors.set('jar', jar.position.clone().add(new T.Vector3(0,.09,0)))
  jar.scale.set(1.35,1.35,1.35)
  const lid=tag(new T.Mesh(new T.CylinderGeometry(.067,.067,.012,28),materials.wood),'jar')
  lid.position.y=.187;lid.castShadow=true;lid.receiveShadow=true;jar.add(lid)
  stars.geometry.dispose();stars.geometry=foldedStarGeometry(.020)
  const starColors=['#DFA28C','#E6BD6A','#A7BFBB','#AEB7CC','#D5AAC1','#E3D9B9']
  const starTransform=new T.Object3D()
  for(let i=0;i<48;i++){
    const layer=Math.floor(i/9),angle=i*2.3999632297
    starTransform.position.set(Math.cos(angle)*(.020+i%3*.013),.023+layer*.024,Math.sin(angle)*(.020+i%3*.013))
    starTransform.rotation.set(i*.73,i*.37,i*.97);starTransform.scale.setScalar(.9+i%3*.06);starTransform.updateMatrix()
    stars.setMatrixAt(i,starTransform.matrix);stars.setColorAt(i,new T.Color(starColors[i%starColors.length]))
  }
  stars.instanceMatrix.needsUpdate=true
  const board=new T.Group();board.position.set(0,1.4,-.335);root.add(board)
  const photoPlanes = []
  for (let i=0;i<8;i++) {
    const slots=[[-.29,1.58,-.13],[.015,1.53,.06],[.32,1.68,-.05],[-.31,1.25,.07],[.01,1.21,-.06],[.31,1.36,.10],[-.24,1.02,-.09],[.36,1.05,-.08]]
    const [x,y,angle]=slots[i]
    const [width,height]=PRINT_SIZES[i]
    const photo = tag(box('photo-card', [width,height,.002], [x,y,-.347+i*.0004],materials.paper,.001), 'photos')
    photo.userData.paperWidth=width;photo.userData.paperHeight=height
    photo.rotation.z=angle
    photoPlanes.push(photo)
    photo.castShadow=true
  }
  anchors.set('photos', board.position.clone())
  const pinGeometry=new T.CylinderGeometry(.011,.011,.008,12)
  pinGeometry.rotateX(Math.PI/2)
  const pins=tag(new T.InstancedMesh(pinGeometry,materials.wood,8),'photos')
  photoPlanes.forEach((photo,i)=>{photo.updateMatrix();const matrix=photo.matrix.clone().multiply(new T.Matrix4().makeTranslation(0,photo.userData.paperHeight/2-.008,.006));pins.setMatrixAt(i,matrix)})
  pins.name='photo-pins';root.add(pins)
  addDeskDetails(root,materials)
  // Desk lamp geometry; its cone light is the only shadow source at night.
  box('lamp-base',[.12,.014,.10],[.52,.757,-.16],materials.ceramic)
  box('lamp-stem',[.015,.36,.015],[.52,.94,-.16],materials.dark,.001)
  const shade = new T.Mesh(new T.ConeGeometry(.08,.10,24,1,true),materials.ceramic)
  shade.material=shade.material.clone();shade.material.side=T.DoubleSide
  shade.material.emissive=new T.Color('#FFC28A');shade.material.emissiveIntensity=0
  shade.position.set(.52,1.13,-.16);shade.castShadow=true;root.add(shade)
  // A single distant backdrop behind the real aperture; never casts an opaque shadow.
  const windowView=new T.Mesh(new T.PlaneGeometry(1,1),new T.MeshBasicMaterial({color:'#C4D5DF',side:T.DoubleSide}))
  windowView.position.set(-.93,1.4,.15);windowView.rotation.y=Math.PI/2;root.add(windowView)
  return { ...fixed, anchors, drawer, pages, letters, screen, photoPlanes, pins, stars, lampShade:shade, windowView }
}
