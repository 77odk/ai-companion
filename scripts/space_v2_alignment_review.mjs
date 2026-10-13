/** Repeatable local component QA. Synthetic disposable browser data only;
 * not authenticated App or physical-phone acceptance. No production bundle.
 * node scripts/space_v2_alignment_review.mjs /tmp/space261-review
 * Requires the existing QA Python Playwright + system Chromium, no npm deps.
 */
import { build } from 'vite'
import react from '@vitejs/plugin-react'
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs'
import { resolve, join } from 'node:path'
import { spawnSync } from 'node:child_process'

const output = resolve(process.argv[2] || '/tmp/space261-review')
mkdirSync(output, { recursive: true })
const scratch = mkdtempSync(resolve('.space261-build-'))
const source = file => JSON.stringify(resolve(file))
try {
  const entry = `
import React,{useState} from 'react'; import {createRoot} from 'react-dom/client';
import AISpace from ${source('src/components/AISpace.tsx')};
${['StarJar','ThoughtBook','ListenTogether','WeeklyPage'].map(name=>`import ${name} from ${source('src/components/'+name+'.tsx')};`).join('\n')}
import {chooseListenTogetherTracks,seekListenTogether,toggleListenTogether,getListenTogetherSnapshot} from ${source('src/lib/listenTogetherState.ts')};
import ${source('src/index.css')};
${['tokens','primitives','ui2','spaceLetter','ui204MobileClosure','space'].map(name => `import ${source('src/styles/'+name+'.css')};`).join('\n')}
window.__alignmentReview={kind:'SYNTHETIC_COMPONENT_QA',events:[],snapshot:getListenTogetherSnapshot,seek:seekListenTogether,toggle:toggleListenTogether};
// Isolated origin/browser context; no auth token, real account or remote API.
const canvas=document.createElement('canvas');canvas.width=canvas.height=64;
const ctx=canvas.getContext('2d');ctx.fillStyle='#b78354';ctx.fillRect(0,0,64,64);ctx.fillStyle='#87a26f';ctx.fillRect(8,8,48,32);
const photoCount=Number(new URLSearchParams(location.search).get('photos')??1);
localStorage.setItem('ai_space_photos_global',JSON.stringify(Array.from({length:photoCount},(_,i)=>({id:'alignment-photo-'+i,width:64,height:64,createdAt:1791849600000,dataUrl:canvas.toDataURL()}))));
localStorage.setItem('ai_companion_memory',JSON.stringify(Array.from({length:12},(_,i)=>({id:'alignment-memory-'+i,text:'隔离验收星星 '+i,explicit:true,createdAt:'2026-10-13T00:00:00Z'}))));
const wav=new ArrayBuffer(44+16000*2*30),v=new DataView(wav);
const str=(o,s)=>[...s].forEach((c,i)=>v.setUint8(o+i,c.charCodeAt(0)));
str(0,'RIFF');v.setUint32(4,wav.byteLength-8,true);str(8,'WAVE');str(12,'fmt ');v.setUint32(16,16,true);v.setUint16(20,1,true);v.setUint16(22,1,true);v.setUint32(24,16000,true);v.setUint32(28,32000,true);v.setUint16(32,2,true);v.setUint16(34,16,true);str(36,'data');v.setUint32(40,wav.byteLength-44,true);
chooseListenTogetherTracks('',[new File([wav],'隔离验收音乐.wav',{type:'audio/wav'})]);
function Review(){const [view,setView]=useState('space');window.__alignmentReview.view=view;const open=kind=>{window.__alignmentReview.events.push(kind);setView(kind)};const back=()=>setView('space');return view==='jar'?<StarJar onBack={back}/>:view==='book'?<ThoughtBook onBack={back}/>:view==='player'?<ListenTogether onBack={back}/>:view==='weekly'?<WeeklyPage onBack={back} onGoSettings={()=>{}}/>:<AISpace onOpenStarJar={()=>open('jar')} onOpenThoughts={()=>open('book')} onOpenListen={()=>open('player')} onOpenWeekly={()=>open('weekly')}/>;}
createRoot(document.getElementById('root')).render(<Review/>);
`
  const entryPath = join(scratch, 'entry.tsx')
  writeFileSync(entryPath, entry)
  const result = await build({ configFile: false, plugins: [react()], publicDir: false, logLevel: 'error',
    define: { __ELUVIN_BUILD_VERSION__: JSON.stringify('space261-isolated-qa'), 'process.env.NODE_ENV': JSON.stringify('production') },
    build: { write: false, lib: { entry: entryPath, name: 'Space261Review', formats: ['iife'] } } })
  const files = (Array.isArray(result) ? result : [result]).flatMap(item => item.output)
  const js = files.filter(f => f.type === 'chunk').map(f => f.code).join('\n')
  const css = files.filter(f => f.type === 'asset' && f.fileName.endsWith('.css')).map(f => f.source).join('\n')
  writeFileSync(join(output, 'fixture.html'), `<!doctype html><html lang="zh"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><style>${css}\nhtml,body,#root{margin:0;width:100%;height:100%;min-height:0;overflow:hidden}#root{display:flex;flex-direction:column}.page{width:100%;max-width:none}</style><div id="root"></div><script>${js.replaceAll('</script', '<\\/script')}</script></html>`)
  const run = spawnSync('python3', ['scripts/space_v2_alignment_review.py', '--out', output], { stdio: 'inherit' })
  if (run.status !== 0) throw new Error(`Browser QA failed (${run.status})`)
} finally { rmSync(scratch, { recursive: true, force: true }) }
