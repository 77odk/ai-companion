// #21 · PWA build version notice：纯逻辑 + 构建/挂载契约。
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'

const {
  fetchDeployedBuildVersion,
  getCurrentBuildVersion,
  shouldShowBuildUpdate,
} = await import('../src/lib/appVersion.ts')

console.log('\n[1] 版本比较：相同不提示，不同才提示')
assert.equal(shouldShowBuildUpdate('abc', 'abc'), false)
assert.equal(shouldShowBuildUpdate('abc', 'def'), true)
assert.equal(shouldShowBuildUpdate('', 'def'), false)
assert.equal(shouldShowBuildUpdate('abc', ''), false)
assert.equal(shouldShowBuildUpdate(' abc ', 'abc'), false)

console.log('\n[2] Node 测试环境没有 Vite define 时安全返回空版本')
assert.equal(getCurrentBuildVersion(), '')

console.log('\n[3] version.json 成功解析；异常/坏响应静默返回 null')
let seenUrl = ''
let seenCache = ''
const okFetch = async (url, init) => {
  seenUrl = String(url)
  seenCache = init?.cache ?? ''
  return new Response(JSON.stringify({ version: '  sha-123  ' }), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  })
}
assert.equal(await fetchDeployedBuildVersion(okFetch, './version.json'), 'sha-123')
assert.match(seenUrl, /^\.\/version\.json\?t=\d+$/)
assert.equal(seenCache, 'no-store')

const missingFetch = async () => new Response('no', { status: 404 })
assert.equal(await fetchDeployedBuildVersion(missingFetch), null)

const badJsonFetch = async () => new Response('{bad', { status: 200 })
assert.equal(await fetchDeployedBuildVersion(badJsonFetch), null)

const networkFail = async () => { throw new Error('offline') }
assert.equal(await fetchDeployedBuildVersion(networkFail), null)

console.log('\n[4] Vite 构建同时注入当前版本并产出 version.json')
const vite = fs.readFileSync(path.join(process.cwd(), 'vite.config.ts'), 'utf8')
assert.match(vite, /__ELUVIN_BUILD_VERSION__/)
assert.match(vite, /fileName: 'version\.json'/)
assert.match(vite, /execFileSync\('git', \['rev-parse', 'HEAD'\]/)
assert.ok(!vite.includes("**/*.{js,css,html,svg,ico,png,json}"), 'version.json 不应进 Workbox precache')

console.log('\n[5] App 只在版本不一致时展示固定文案，并复用 forceRefresh')
const app = fs.readFileSync(path.join(process.cwd(), 'src/App.tsx'), 'utf8')
assert.match(app, /checkDeployedBuild/)
assert.match(app, /subscribeDeployedBuild/)
assert.match(app, /发现新版本，刷新后即可使用/)
assert.match(app, /立即刷新/)
assert.match(app, /稍后/)
assert.ok(app.includes('void forceRefresh()'), '立即刷新复用现有 forceRefresh')
assert.match(app, /dismissedUpdateVersionRef/)
assert.equal(app.includes('localStorage.setItem('), false)

console.log('\n[7] 统一探测入口：判定与通知同一处，设置页复用，不再盲目 reload')
const versionModule = fs.readFileSync(path.join(process.cwd(), 'src/lib/appVersion.ts'), 'utf8')
assert.match(versionModule, /export async function checkDeployedBuild/)
assert.match(versionModule, /export function subscribeDeployedBuild/)
assert.match(versionModule, /emitDeployedBuild/)

const previousBuild = globalThis.__ELUVIN_BUILD_VERSION__
globalThis.__ELUVIN_BUILD_VERSION__ = 'sha-current'
const { checkDeployedBuild, subscribeDeployedBuild } = await import('../src/lib/appVersion.ts')
assert.equal(getCurrentBuildVersion(), 'sha-current')
const emitted = []
const off = subscribeDeployedBuild((version) => emitted.push(version))
const say = (version) => async () => new Response(JSON.stringify({ version }), { status: 200 })
assert.equal(await checkDeployedBuild(say('sha-current')), 'current')
assert.deepEqual(emitted, [null], '已是最新：通知 null（顶部提示条收起）')
assert.equal(await checkDeployedBuild(say('sha-new')), 'updated')
assert.deepEqual(emitted, [null, 'sha-new'], '有新版本：通知新版本号')
assert.equal(await checkDeployedBuild(async () => { throw new Error('offline') }), 'unknown')
off()
assert.equal(await checkDeployedBuild(say('sha-new')), 'updated')
assert.deepEqual(emitted, [null, 'sha-new'], '退订后不再收到通知')
if (previousBuild === undefined) delete globalThis.__ELUVIN_BUILD_VERSION__
else globalThis.__ELUVIN_BUILD_VERSION__ = previousBuild

const settings = fs.readFileSync(path.join(process.cwd(), 'src/components/Settings.tsx'), 'utf8')
assert.match(settings, /checkDeployedBuild/)
assert.match(settings, /已经是最新版本/)
assert.match(settings, /发现新版本，看页面顶部的提示刷新一下/)
assert.match(settings, /暂时检查不了，过会儿再试/)
assert.equal(settings.includes('location.reload()'), false, '检查更新不再直接 reload')
const cssCheck = fs.readFileSync(path.join(process.cwd(), 'src/styles/updateControls.css'), 'utf8')
assert.match(cssCheck, /\.update-check-hint \{/)

console.log('\n[6] 样式是应用流内顶部细条，390 宽不依赖固定像素宽度')
const css = fs.readFileSync(path.join(process.cwd(), 'src/styles/updateControls.css'), 'utf8')
assert.match(css, /\.version-update-notice \{/)
assert.match(css, /width: 100%/)
assert.match(css, /flex-shrink: 0/)
assert.match(css, /safe-area-inset-top/)

console.log('\npwa version notice: all passed')
