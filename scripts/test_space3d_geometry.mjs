import test from 'node:test'
import assert from 'node:assert/strict'
import * as T from 'three'
import { buildDeskScene } from '../src/lib/space3d/geometry.js'

test('meter-scale desk, real window opening and paper thickness match the scene contract',()=>{
  const plain=new T.MeshStandardMaterial({color:'#FFFFFF',roughness:.9,metalness:0})
  const materials=Object.fromEntries(['wood','wall','paper','linen','ceramic','ceramicBase','glass','dark','screen'].map(name=>[name,plain]))
  const scene=buildDeskScene(materials)
  scene.root.updateMatrixWorld(true)
  const near=(actual,expected)=>assert.ok(Math.abs(actual-expected)<1e-5,`${actual} vs ${expected}`)
  const top=scene.root.getObjectByName('desktop'),bounds=new T.Box3().setFromObject(top),size=bounds.getSize(new T.Vector3())
  near(size.x,1.4);near(size.y,.03);near(size.z,.6);near(bounds.max.y,.75)
  near(new T.Box3().setFromObject(scene.root.getObjectByName('window-sill')).max.y,.9)
  const ray=new T.Raycaster(new T.Vector3(0,1.6,.15),new T.Vector3(-1,0,0),0,2)
  const solids=[];scene.root.traverse(mesh=>{if(mesh.isMesh&&mesh.castShadow)solids.push(mesh)})
  assert.equal(ray.intersectObjects(solids,false).length,0,'window aperture is not an opaque wall')
  ray.set(new T.Vector3(0,.5,.15),new T.Vector3(-1,0,0))
  assert.ok(ray.intersectObjects(solids,false).some(hit=>hit.object.name==='window-wall-bottom'))
  for(const page of scene.pages){
    page.geometry.computeBoundingBox();near(page.geometry.boundingBox.max.z-page.geometry.boundingBox.min.z,.0015)
    assert.equal(page.geometry.parameters.widthSegments,16)
  }
  assert.equal(scene.photoPlanes.length,8)
  assert.ok(scene.bakeSurfaces.every(mesh=>mesh.geometry.attributes.uv1))
  assert.ok(scene.bakeSurfaces.every(mesh=>!['letter','player','book-cover','drawer-panel','photo-board'].includes(mesh.name)))
  const meshes=[];scene.root.traverse(mesh=>{if(mesh.isMesh)meshes.push(mesh)})
  meshes.forEach(mesh=>{mesh.geometry.dispose();(Array.isArray(mesh.material)?mesh.material:[mesh.material]).forEach(material=>material.dispose())})
  plain.dispose()
})
