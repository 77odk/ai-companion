import * as T from 'three'
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js'

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
  body.push(box('drawer-left', [.025, .14, .5], [-.34, .64, 0], materials.wood))
  body.push(box('drawer-right', [.025, .14, .5], [.34, .64, 0], materials.wood))
  body.push(box('drawer-back', [.70, .14, .025], [0, .64, -.25], materials.wood))
  body.forEach(mesh=>{mesh.userData.aoOnly=true;bakeSurfaces.push(mesh)})
  bakeSurfaces.push(box('back-wall', [2.6, 2.6, .14], [0, 1.3, -.56], materials.wall, .002))
  // Left wall at x=-1.0; hole: z=-.35..+.65, y=.9..1.9. Real solids block sun.
  for (const [name, size, position] of [
    ['window-wall-bottom', [.14, .9, 2], [-1, .45, .15]],
    ['window-wall-top', [.14, .7, 2], [-1, 2.25, .15]],
    ['window-wall-back', [.14, 1, .5], [-1, 1.4, -.60]],
    ['window-wall-front', [.14, 1, .5], [-1, 1.4, .90]],
  ]) bakeSurfaces.push(box(name, size, position, materials.wall, .002))
  const floor = box('floor', [2.6, .1, 2], [0, -.05, .15], materials.linen, .002, false)
  bakeSurfaces.push(floor)
  for (const z of [-.35, .65]) box('window-frame', [.05, 1.06, .045], [-.91, 1.4, z], materials.wood, .002)
  for (const y of [.9, 1.9]) box('window-frame', [.05, .045, 1.06], [-.91, y, .15], materials.wood, .002)
  box('window-crossbar', [.04, .025, 1], [-.90, 1.4, .15], materials.wood, .002)
  box('window-sill', [.22, .045, 1.14], [-.91, .8775, .15], materials.wood, .003)
  // No opaque glass shadows; thickness still gives an identifiable edge.
  box('window-glass', [.005, .95, .95], [-.975, 1.4, .15], materials.glass, .001, false)
  root.updateMatrixWorld(true)
  return { root, bakeSurfaces, box }
}

export function buildDeskScene(materials) {
  const fixed = buildFixedScene(materials), { root, box } = fixed
  const anchors = new Map()
  const tag = (mesh, hit) => {
    mesh.userData.hit = hit
    if (mesh.material) mesh.material = Array.isArray(mesh.material)
      ? mesh.material.map(material=>material.clone()) : mesh.material.clone()
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
  for (const x of [-.345, .345]) box('drawer-rail', [.009, .009, .45], [x, .605, .01], materials.dark, .001, false)
  const letters = []
  for (let i = 0; i < 5; i++) {
    const letter=drawerBox('letter', [.21, .002, .13], [-.04 + i * .012, .60 + i * .004, .02 + i * .006], materials.paper, .001)
    letter.castShadow=false;letters.push(letter)
  }
  anchors.set('drawer', new T.Vector3(0, .64, .32))
  const book = new T.Group(); book.position.set(-.08, .767, .03); root.add(book)
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
  anchors.set('book', new T.Vector3(-.08, .78, .03))
  const player = tag(box('player', [.24, .045, .15], [.47, .775, .14], materials.dark), 'player')
  const screen = tag(box('player-screen', [.17, .003, .10], [.47, .800, .14], materials.screen), 'player')
  anchors.set('player', player.position.clone())
  const jar = new T.Group(); jar.position.set(-.50, .75, -.13); root.add(jar)
  // Thick lathed ceramic rim and bottom, transparent double-wall glass body.
  const profile = [[.065,0],[.07,.006],[.078,.03],[.08,.14],[.067,.17],[.066,.177],[.063,.179],[.059,.176],[.06,.169],[.073,.137],[.071,.03],[.063,.012],[0,.012]]
  const body = new T.Mesh(new T.LatheGeometry(profile.map(p => new T.Vector2(...p)), 28), materials.glass)
  body.receiveShadow = true; jar.add(body); tag(body, 'jar')
  for (const [radius, y, material] of [[.065,.006,materials.ceramicBase],[.063,.175,materials.ceramic]]) {
    const ring = new T.Mesh(new T.TorusGeometry(radius, .003, 6, 28), material)
    ring.rotation.x = Math.PI / 2; ring.position.y = y; ring.castShadow = true; jar.add(ring); tag(ring, 'jar')
  }
  const stars = new T.InstancedMesh(new T.OctahedronGeometry(.008), materials.paper, 48)
  const matrix = new T.Matrix4()
  for (let i=0;i<48;i++) { matrix.makeTranslation(Math.sin(i*7)*.045, .018+(i%9)*.013, Math.cos(i*11)*.045); stars.setMatrixAt(i,matrix) }
  jar.add(stars); tag(stars,'jar'); anchors.set('jar', jar.position.clone().add(new T.Vector3(0,.09,0)))
  const board = tag(box('photo-board', [.46, .34, .025], [.38, 1.24, -.465], materials.linen), 'photos')
  const photoPlanes = []
  for (let i=0;i<8;i++) {
    const photo = tag(box('photo-card', [.13,.09,.002], [.225+(i%3)*.15,1.145+Math.floor(i/3)*.102,-.446],materials.paper,.001), 'photos')
    const uv=photo.geometry.attributes.uv
    for(let vertex=0;vertex<uv.count;vertex++)uv.setY(vertex,1-(1-uv.getY(vertex))*354/512)
    photoPlanes.push(photo)
    photo.castShadow=false
  }
  anchors.set('photos', board.position.clone())
  // Desk lamp geometry; its cone light is the only shadow source at night.
  box('lamp-base',[.12,.014,.10],[.52,.757,-.16],materials.ceramic)
  box('lamp-stem',[.015,.36,.015],[.52,.94,-.16],materials.dark,.001)
  const shade = new T.Mesh(new T.ConeGeometry(.08,.10,24,1,true),materials.ceramic)
  shade.position.set(.52,1.13,-.16);shade.castShadow=true;root.add(shade)
  return { ...fixed, anchors, drawer, pages, letters, screen, photoPlanes, stars }
}
