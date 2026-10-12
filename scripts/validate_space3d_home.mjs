import assert from 'node:assert/strict'
import {writeFile} from 'node:fs/promises'
import {openBrowser,startVite} from './space3d-browser.mjs'
const server=await startVite(),browser=await openBrowser(),errors=[]
browser.onEvent(event=>{if(event.method==='Runtime.exceptionThrown')errors.push(event.params.exceptionDetails.text)})
try {
  await browser.cdp('Emulation.setDeviceMetricsOverride',{width:390,height:844,deviceScaleFactor:1,mobile:true})
  await browser.cdp('Page.navigate',{url:`${server.origin}/tools/space3d-visual/home.html`})
  await browser.waitFor('!!document.querySelector(".environment-feedback-toggle")')
  const bounds=await browser.evaluate(`(()=>{const toggle=document.querySelector('.environment-feedback-toggle'),inbox=document.querySelector('.home-inbox-button'),a=toggle.getBoundingClientRect(),b=inbox.getBoundingClientRect();return {overlap:a.left<b.right&&a.right>b.left&&a.top<b.bottom&&a.bottom>b.top,clickable:document.elementFromPoint(a.left+a.width/2,a.top+a.height/2)===toggle,toggle:{left:a.left,right:a.right},inbox:{left:b.left,right:b.right}}})()`)
  assert.equal(bounds.overlap,false);assert.equal(bounds.clickable,true)
  await browser.evaluate('document.querySelector(".environment-feedback-toggle").click()')
  await browser.waitFor('document.querySelector(".environment-feedback-toggle").getAttribute("aria-pressed")==="true"')
  await browser.evaluate('document.querySelector(".environment-feedback-toggle").click()')
  await browser.waitFor('document.querySelector(".environment-feedback-toggle").getAttribute("aria-pressed")==="false"')
  await browser.evaluate('document.querySelector(".home-inbox-button").click()')
  assert.deepEqual(await browser.evaluate('window.visualEvents'),['notifications'])
  await browser.cdp('Page.navigate',{url:`${server.origin}/tools/space3d-visual/home.html?invalid=1`})
  await browser.waitFor('!!document.querySelector(".home-time") && !!document.querySelector(".home-weather-copy")')
  assert.equal(await browser.evaluate('!!document.querySelector(".environment-feedback-toggle")'),false)
  assert.equal(errors.length,0,errors.join('\n'))
  await writeFile('docs/space3d-validation/home-feedback.json',JSON.stringify({width:390,height:844,...bounds,toggleOnOff:true,originalInboxCallback:true,invalidTimezoneDoesNotCrash:true,errors},null,2)+'\n')
  console.log('Actual Home: toggle/inbox do not overlap; on/off + inbox callback + malformed timezone passed.')
} finally {server.close();await browser.close()}
