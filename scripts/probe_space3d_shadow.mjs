import { mkdir, writeFile } from 'node:fs/promises'
import { openBrowser, startVite } from './space3d-browser.mjs'
const server=await startVite(),browser=await openBrowser()
try {
  await browser.cdp('Page.navigate',{url:`${server.origin}/tools/space3d-bake/shadow.html`})
  await browser.waitFor('window.shadowReady === true')
  const result=await browser.evaluate('window.shadowProbe()')
  await mkdir('docs/space3d-validation',{recursive:true})
  await writeFile('docs/space3d-validation/shadow-radius.json',JSON.stringify(result,null,2)+'\n')
  if(result.results.soft.differingBytes!==0||result.results.pcf.differingBytes===0)throw new Error('Unexpected radius behavior; inspect before selecting production shadow type')
  console.log(JSON.stringify(result))
} finally {server.close();await browser.close()}
