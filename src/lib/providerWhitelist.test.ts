// 服务商白名单一致性自测（2026-10-04 回归测试）
// 起因：MiMo 上线时漏改白名单，用户表现是「测试连接通过 → 保存 → 退出再进，key 空了、聊天用不了」
// —— 存进去的 provider:'mimo' 在读出来时被当非法值兜底成 'zhipu'，于是拿到智谱那个空 key。
// 这个测试同时盯两处：① 每个服务商都能存进去再读回来 ② sync.ts 的服务商清单不许漏。
// 跑法：node src/lib/providerWhitelist.test.ts（或 npm test）
// 注意：本文件会被 tsc -b 扫到，不许 import 任何 node: 内置模块（缺 @types/node 会报 TS2591）。

import { loadSettings, saveSettings, type Provider } from './storage.ts'
import { ALL_PROVIDERS as SYNC_PROVIDERS } from './sync.ts'

// 服务商全集（跟 storage.ts 的 Provider 联合类型一致；新增服务商时这里也要加）
const EXPECTED_PROVIDERS: Provider[] = ['deepseek', 'zhipu', 'openai', 'custom', 'volcengine', 'mimo']

// 简易 localStorage mock（storage 的读写都在函数内，导入不触发）
const store = new Map<string, string>()
globalThis.localStorage = {
  getItem: (k: string) => (store.has(k) ? store.get(k) : null),
  setItem: (k: string, v: string) => {
    store.set(k, String(v))
  },
  removeItem: (k: string) => {
    store.delete(k)
  },
  clear: () => {
    store.clear()
  },
} as unknown as Storage

let failed = 0

function eq(actual: unknown, expected: unknown, msg: string): void {
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    failed += 1
    console.error(`  ✗ ${msg}：期望 ${JSON.stringify(expected)}，实际 ${JSON.stringify(actual)}`)
    return
  }
  console.log(`  ✓ ${msg}`)
}

console.log('\n[1] 每个服务商：存进去 → 读出来，provider 与 key 都不能丢')
for (const provider of EXPECTED_PROVIDERS) {
  store.clear()
  const key = `sk-test-${provider}-key`
  saveSettings({ provider, apiKey: key, baseUrl: `https://api.example.com/${provider}/v1`, model: `${provider}-model-1` })
  const back = loadSettings()
  eq(back.provider, provider, `${provider}：读回来 provider 还得是自己（漏白名单会兜底成 zhipu）`)
  eq(back.apiKey, key, `${provider}：读回来 key 还在`)
  eq(back.model, `${provider}-model-1`, `${provider}：读回来 model 还在`)
  eq(back.providers[provider].apiKey, key, `${provider}：providers 槽位里的 key 也在`)
}

console.log('\n[2] 多服务商并存：切换服务商不会互相清 key')
store.clear()
for (const provider of EXPECTED_PROVIDERS) {
  saveSettings({ provider, apiKey: `sk-${provider}`, baseUrl: `https://api.example.com/${provider}/v1`, model: `${provider}-model-1` })
}
const all = loadSettings()
for (const provider of EXPECTED_PROVIDERS) {
  eq(all.providers[provider].apiKey, `sk-${provider}`, `${provider}：并存时 key 不被别的服务商覆盖`)
}

console.log('\n[3] sync.ts 的服务商清单不许漏（跨设备同步要用它）')
for (const provider of EXPECTED_PROVIDERS) {
  eq(SYNC_PROVIDERS.includes(provider), true, `sync 清单包含 ${provider}`)
}

console.log('\n[4] 未知服务商仍兜底到 zhipu（旧行为不能被破坏）')
store.clear()
localStorage.setItem('ai_companion_settings', JSON.stringify({ provider: 'not-a-provider', providers: {} }))
eq(loadSettings().provider, 'zhipu', '非法 provider 仍兜底成 zhipu')

if (failed > 0) {
  throw new Error(`provider whitelist: FAIL（${failed} 项）`)
}
console.log('\nprovider whitelist: PASS')
