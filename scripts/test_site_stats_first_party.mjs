// 站点访问统计：第一方契约（2026-09-21 替代第三方脚本）
// 为什么要有这条测试：第三方统计脚本与忆文自身代码共享页面权限，而同源 localStorage 里有
// token / 用户模型 key / 聊天与记忆。这条测试保证「全站不再加载任何第三方 JS」且
// 「访问数字只来自我们自己的后端」，避免以后又被顺手加回来。
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'

const html = fs.readFileSync(path.join(process.cwd(), 'index.html'), 'utf8')

console.log('\n[1] 全站不加载第三方脚本')
assert.equal(html.includes('busuanzi'), false, '不再引用不蒜子')
const externalScripts = [...html.matchAll(/<script[^>]+src="(https?:)?\/\/[^"]+"/g)].map((m) => m[0])
assert.deepEqual(externalScripts, [], 'index.html 不允许任何外链脚本：' + externalScripts.join(' | '))

console.log('\n[2] 源码里没有任何第三方统计残留')
const srcFiles = []
const walk = (dir) => {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) walk(full)
    else if (/\.(ts|tsx|js|jsx|html)$/.test(entry.name)) srcFiles.push(full)
  }
}
walk(path.join(process.cwd(), 'src'))
for (const file of srcFiles) {
  const text = fs.readFileSync(file, 'utf8')
  assert.equal(/busuanzi/i.test(text), false, `${path.relative(process.cwd(), file)} 仍引用不蒜子`)
}

console.log('\n[3] 数字只来自我们自己的后端，且用第一方 Cookie（不落 localStorage）')
const statsSrc = fs.readFileSync(path.join(process.cwd(), 'src/lib/siteStats.ts'), 'utf8')
assert.match(statsSrc, /\/api\/hit/, '打点走 /api/hit')
assert.match(statsSrc, /\/api\/site-stats/, '读数走 /api/site-stats')
assert.match(statsSrc, /credentials: 'include'/, '带第一方 Cookie')
assert.equal(/localStorage\.(set|get|remove)Item/.test(statsSrc), false, '不新增 / 不读写任何 localStorage key')
assert.equal(/document\.cookie/.test(statsSrc), false, '前端不碰 Cookie（服务端 HttpOnly）')

console.log('\n[4] Consent 完成后才允许打点，且 light consent 未完成时继续阻断')
const appSrc = fs.readFileSync(path.join(process.cwd(), 'src/App.tsx'), 'utf8')
assert.match(appSrc, /if \(!firstConsentDone \|\| needLightConsent\) return/, 'Consent 未完成时必须直接 return')
assert.match(appSrc, /pingSiteHit\(API_BASE\)/, 'Consent 通过后才调用第一方打点')
assert.match(appSrc, /\[firstConsentDone, needLightConsent\]/, 'Consent 状态变化后应重新判定是否可打点')

console.log('\n[5] 欢迎页显示第一方数字；取不到就不显示（不填 0，不编数字）')
const welcomeSrc = fs.readFileSync(path.join(process.cwd(), 'src/components/Welcome.tsx'), 'utf8')
assert.match(welcomeSrc, /fetchSiteStats\(API_BASE\)/)
assert.match(welcomeSrc, /visitors !== null &&/)
assert.match(welcomeSrc, /已有 \{visitors\} 人访问/)
assert.doesNotMatch(welcomeSrc, /busuanzi_value_site_uv/)

console.log('\n[6] 行为：解析数字；失败返回 null；仅正式域名打点且单页防重')
const { fetchSiteStats, pingSiteHit, isOfficialFrontendHost } = await import('../src/lib/siteStats.ts')

const okFetch = async () => new Response(JSON.stringify({ pv: 12, uv: 7, todayPv: 3, todayUv: 2 }), { status: 200 })
// 直接调 fetchSiteStats（Node 下没有 location，打点会被跳过；读数不受影响）
const realFetch = globalThis.fetch
globalThis.fetch = okFetch
const parsed = await fetchSiteStats('https://api.example')
globalThis.fetch = realFetch
assert.deepEqual(parsed, { pv: 12, uv: 7, todayPv: 3, todayUv: 2 })

globalThis.fetch = async () => new Response('nope', { status: 500 })
const failed = await fetchSiteStats('https://api.example')
globalThis.fetch = realFetch
assert.equal(failed, null, '取不到返回 null，不显示假数字')

assert.equal(isOfficialFrontendHost('eluvin.space'), true, '正式站允许写统计')
assert.equal(isOfficialFrontendHost('preview.eluvin.space'), false, 'preview 不允许写正式统计')
assert.equal(isOfficialFrontendHost('localhost'), false, 'localhost 不允许写正式统计')
assert.equal(isOfficialFrontendHost('192.168.1.8'), false, 'LAN 不允许写正式统计')

let pinged = 0
globalThis.fetch = async () => { pinged += 1; return new Response('{}', { status: 200 }) }
Object.defineProperty(globalThis, 'location', {
  configurable: true,
  value: { hostname: 'preview.eluvin.space' },
})
pingSiteHit('https://api.example')
await new Promise((r) => setTimeout(r, 20))
assert.equal(pinged, 0, 'preview 不打点，避免污染正式站')

Object.defineProperty(globalThis, 'location', {
  configurable: true,
  value: { hostname: 'eluvin.space' },
})
pingSiteHit('https://api.example')
pingSiteHit('https://api.example')
await new Promise((r) => setTimeout(r, 20))
globalThis.fetch = realFetch
assert.equal(pinged, 1, '正式站同一页面生命周期最多打一次，防 StrictMode 双跑')

console.log('\nsite stats first party: all passed')
