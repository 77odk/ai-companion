import test from 'node:test'
import assert from 'node:assert/strict'
import * as T from 'three'
import { buildDeskScene } from '../src/lib/space3d/geometry.js'

test('reference desk keeps upright player, separate pinned cards, solid ivy and folded stars in WebGL geometry',()=>{
  const plain=new T.MeshStandardMaterial({roughness:.9,metalness:0})
  const materials=Object.fromEntries(['wood','wall','paper','linen','ceramic','ceramicBase','glass','dark','screen'].map(name=>[name,plain]))
  const scene=buildDeskScene(materials)
  try{
    scene.root.updateMatrixWorld(true)
    const player=scene.root.getObjectByName('player'),bounds=new T.Box3().setFromObject(player),size=bounds.getSize(new T.Vector3())
    assert.ok(size.y>size.z*2,'player has a standing screen, rather than a flat tabletop block')
    const leaves=scene.root.getObjectByName('ivy-and-potted-leaves')
    assert.ok(leaves.isInstancedMesh&&leaves.count>=40)
    leaves.geometry.computeBoundingBox()
    assert.ok(leaves.geometry.boundingBox.max.z-leaves.geometry.boundingBox.min.z>.02,'ivy is a curved thick solid, not an image plane')
    assert.equal(leaves.castShadow,true)
    assert.ok(new Set(scene.photoPlanes.map(photo=>photo.rotation.z)).size>=5)
    assert.ok(scene.photoPlanes.every(photo=>photo.userData.hit==='photos'&&photo.castShadow))
    scene.stars.geometry.computeBoundingBox()
    const starSize=scene.stars.geometry.boundingBox.getSize(new T.Vector3())
    assert.ok(starSize.z>.005&&starSize.x>.025,'each star is a folded volumetric shape')
    assert.ok(scene.stars.instanceColor,'memory stars have individual paper colors')
    const positions=scene.stars.geometry.attributes.position,normals=scene.stars.geometry.attributes.normal
    assert.equal(scene.stars.geometry.attributes.uv.count,positions.count,'paper grain has UVs on every folded face')
    for(let i=0;i<positions.count;i+=3){
      const center=new T.Vector3()
      for(let vertex=0;vertex<3;vertex++)center.add(new T.Vector3().fromBufferAttribute(positions,i+vertex))
      center.multiplyScalar(1/3)
      assert.ok(new T.Vector3().fromBufferAttribute(normals,i).dot(center)>0,'folded paper faces point out of the closed volume')
    }
    assert.equal(scene.pins.isInstancedMesh,true)
    assert.ok(scene.root.getObjectByName('desk-detail-ceramic'))
    assert.ok(!scene.root.getObjectByName('photo-board'),'photos are pinned directly to the existing wall')
  }finally{
    const geometries=new Set(),mats=new Set()
    scene.root.traverse(mesh=>{if(mesh.geometry)geometries.add(mesh.geometry);if(mesh.material)(Array.isArray(mesh.material)?mesh.material:[mesh.material]).forEach(m=>mats.add(m))})
    geometries.forEach(g=>g.dispose());mats.forEach(m=>m.dispose());plain.dispose()
  }
})
