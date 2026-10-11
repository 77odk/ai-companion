import assert from 'node:assert/strict'
import { paginateSpaceThoughts, spacePaperCurl } from '../src/lib/spaceBookPaper.ts'

const thoughts = [
  {id:'long',createdAt:1,text:'纸上的思绪。'.repeat(50)+'\n\n下一段🙂\n最后一行'},
  {id:'mixed',createdAt:2,text:'ASCII words 123 / 中文组合\n  空格也保留。'},
  {id:'empty',createdAt:3,text:''},
]
const before=structuredClone(thoughts),pages=paginateSpaceThoughts(thoughts)
for(const thought of thoughts) {
  const own=pages.filter(p=>p.thoughtId===thought.id)
  assert.equal(own.map(p=>p.text).join(''),thought.text,'Every character and newline survives pagination')
  assert.ok(own.every(p=>p.lines.length<=8))
  assert.ok(own.every(p=>p.lines.every(line=>Array.from(line.replace(/\n$/,'')).reduce((n,c)=>n+(c.charCodeAt(0)<128?.55:1),0)<=10+1e-9)))
}
assert.deepEqual(thoughts,before,'Pagination never writes or mutates thoughts')
assert.deepEqual(pages.map(p=>p.number),pages.map((_,i)=>i+1))
assert.deepEqual(paginateSpaceThoughts([]),[])
for (const [cols,rows] of [[0,9],[10,0],[NaN,9],[10,1.5]]) assert.throws(()=>paginateSpaceThoughts(thoughts,cols,rows),RangeError)
for(let i=0;i<=100;i++) {
  const strip=spacePaperCurl(i/100)
  assert.equal(strip.length,25)
  assert.deepEqual(strip[0].x,0)
  assert.ok(strip.every(p=>Number.isFinite(p.x)&&Number.isFinite(p.lift)))
}
assert.ok(Math.abs(spacePaperCurl(0).at(-1).x-1)<1e-9)
assert.ok(Math.abs(spacePaperCurl(1).at(-1).x+1)<1e-9)
const mid=spacePaperCurl(.35)
assert.ok(Math.abs(mid[6].x*2-mid[12].x)>.001,'The leaf bends instead of rotating as one rigid card')
console.log('[Space paper] exact content preservation, bounded leaves, immutable inputs and flexible curl: PASS')
