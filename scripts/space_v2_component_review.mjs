/** Build an isolated, EMPTY-account review of the actual Space components.
 * This never loads App, LoginGate or ConsentGate, never seeds user content,
 * and does not change the product manifest. It is NOT authenticated App QA.
 * Usage: node scripts/space_v2_component_review.mjs /tmp/space-review.html
 */
import { build } from 'vite'
import react from '@vitejs/plugin-react'
import { readFileSync, writeFileSync, readdirSync, mkdirSync } from 'node:fs'
import { resolve } from 'node:path'

const output = process.argv[2]
if (!output) throw new Error('Provide a local output HTML path')
const root = process.cwd()
const scratch = resolve(root, '.space-review.local')
mkdirSync(scratch, { recursive: true })
const importFile = name => JSON.stringify(resolve(root, name))
const entry = `
import React, {useState} from 'react';
import {createRoot} from 'react-dom/client';
import AISpace from ${importFile('src/components/AISpace.tsx')};
import StarJar from ${importFile('src/components/StarJar.tsx')};
import ThoughtBook from ${importFile('src/components/ThoughtBook.tsx')};
import ListenTogether from ${importFile('src/components/ListenTogether.tsx')};
import WeeklyPage from ${importFile('src/components/WeeklyPage.tsx')};
${['src/styles/tokens.css','src/index.css','src/styles/primitives.css','src/styles/ui2.css','src/styles/ui204MobileClosure.css','src/styles/space.css'].map(p => 'import '+importFile(p)+';').join('\n')}
window.__spaceReview = {kind:'ISOLATED_EMPTY_ACCOUNT_COMPONENT_REVIEW',events:[]};
function Review() {
 const [view,setView]=useState('space');
 const open=kind=>{window.__spaceReview.events.push(kind);setView(kind)};
 window.__spaceReview.view=view;
 const back=()=>setView('space');
 return view==='jar'?<StarJar onBack={back}/>:view==='book'?<ThoughtBook onBack={back}/>:
 view==='player'?<ListenTogether onBack={back}/>:view==='weekly'?<WeeklyPage onBack={back} onGoSettings={()=>{}}/>:
 <AISpace onOpenStarJar={()=>open('jar')} onOpenThoughts={()=>open('book')}
 onOpenListen={()=>open('player')} onOpenWeekly={()=>open('weekly')}/>;
}
createRoot(document.getElementById('root')).render(<Review/>);
`
const entryPath = resolve(scratch, 'entry.tsx')
writeFileSync(entryPath, entry)
const built = await build({
  configFile: false, root, logLevel: 'error', publicDir: false,
  define: { __ELUVIN_BUILD_VERSION__: JSON.stringify('isolated-space-review'), 'process.env.NODE_ENV': JSON.stringify('production') },
  plugins: [react()],
  build: { write: false, minify: true, lib: { entry: entryPath, name: 'SpaceReview', formats: ['iife'] } },
})
const files = Array.isArray(built) ? built.flatMap(b => b.output) : built.output
const js = files.filter(p => p.type === 'chunk').map(p => p.code).join('\n')
const css = files.filter(p => p.type === 'asset' && p.fileName.endsWith('.css')).map(p => p.source).join('\n')
const assets = {}
for (const dir of ['layered', 'cutouts']) for (const name of readdirSync(`public/space/${dir}`)) {
  if (!/\.(png|webp)$/.test(name)) continue
  const mime = name.endsWith('.png') ? 'image/png' : 'image/webp'
  assets[`/space/${dir}/${name}`] = `data:${mime};base64,${readFileSync(`public/space/${dir}/${name}`).toString('base64')}`
}
const manifest = JSON.parse(readFileSync('public/space/layered/manifest.json','utf8'))
if (manifest.enabled || manifest.artApproved) throw new Error('Product artwork gates must stay closed during this review')
// Only fixture resource loading is inlined. No login/session/account/storage
// is created. This isolates artwork review from network and private content.
const setup = `
const assets=${JSON.stringify(assets)};
const mapped=src=>assets[src]||src;
const srcProperty=Object.getOwnPropertyDescriptor(HTMLImageElement.prototype,'src');
Object.defineProperty(HTMLImageElement.prototype,'src',{...srcProperty,set(value){srcProperty.set.call(this,mapped(value))}});
const originalAttribute=Element.prototype.setAttribute;
Element.prototype.setAttribute=function(name,value){return originalAttribute.call(this,name,this instanceof HTMLImageElement&&name==='src'?mapped(value):value)};
const reviewManifest=${JSON.stringify({ ...manifest, enabled: true, artApproved: true })};
window.fetch=async url=>{
 if(String(url)==='/space/layered/manifest.json') return new Response(JSON.stringify(reviewManifest),{status:200,headers:{'Content-Type':'application/json'}});
 throw new Error('Network request is not permitted in the isolated art review: '+url);
};
`
writeFileSync(output, `<!doctype html><html lang="zh"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><style>${css}\nhtml,body,#root{margin:0;width:100%;height:100%;min-height:0;overflow:hidden}#root{display:flex;flex-direction:column}.page{width:100%;max-width:none}</style></head><body><div id="root"></div><script>${setup}</script><script>${js.replaceAll('</script','<\\/script')}</script></body></html>`)
console.log('Built isolated empty-account review:', output)
