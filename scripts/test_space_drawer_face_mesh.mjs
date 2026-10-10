import assert from 'node:assert/strict'
import { paintSpaceDrawerFrontMesh } from '../src/lib/spaceDrawerFaceMesh.ts'
const source=[[6,71],[480,157],[480,242],[6,142]]
const destination=[[0,0],[498,98],[498,229],[0,172]]
const transforms=[]
let depth=0,drawn=0
const ctx={
  save(){depth++},restore(){depth--},
  beginPath(){},moveTo(){},lineTo(){},closePath(){},clip(){},
  transform(...m){transforms.push(m)},
  drawImage(){drawn++},
}
paintSpaceDrawerFrontMesh(ctx,{},source,destination)
assert.equal(depth,0)
assert.equal(transforms.length,2,'only two triangles should be painted')
assert.equal(drawn,2,'source texture is reused, not duplicated as different art')
for(let i=0;i<2;i++){
  const ids=i===0?[0,1,2]:[0,2,3]
  const [a,b,c,d,e,f]=transforms[i]
  for(const id of ids){
    const [x,y]=source[id],actual=[a*x+c*y+e,b*x+d*y+f]
    assert.ok(Math.abs(actual[0]-destination[id][0])<1e-8)
    assert.ok(Math.abs(actual[1]-destination[id][1])<1e-8)
  }
}
console.log('[Space G0-B] two affine triangles map all six source corners exactly: PASS')
