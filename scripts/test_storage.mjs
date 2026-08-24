// storage.ts 默认服务商（TASK_B）纯逻辑自测
// 直接导入纯逻辑 TS（Node 22+ 原生类型剥离），不依赖任何构建工具。
// 跑法：node scripts/test_storage.mjs
// 覆盖：无设置 → 默认智谱 / 已有设置保持原选择（deepseek、zhipu、custom、openai）/
//       非法 provider 值兜底智谱 / 损坏 JSON 兜底智谱 / v1 单 key 迁移

import { isSlowLetterMode, loadSettings, setSlowLetterMode, DEFAULT_SETTINGS } from '../src/lib/storage.ts'

let passed = 0
let failed = 0

function ok(cond, name) {
  if (cond) {
    passed++
    console.log(`  ✓ ${name}`)
  } else {
    failed++
    console.error(`  ✗ ${name}`)
  }
}

function eq(actual, expected, name) {
  const a = JSON.stringify(actual)
  const b = JSON.stringify(expected)
  ok(a === b, `${name}（得 ${a}，期望 ${b}）`)
}

// 简易 localStorage mock（Node 无 localStorage；各读写函数导入不触发）
const store = new Map()
globalThis.localStorage = {
  getItem: (k) => (store.has(k) ? store.get(k) : null),
  setItem: (k, v) => store.set(k, String(v)),
  removeItem: (k) => store.delete(k),
  clear: () => store.clear(),
}
function resetStore() {
  store.clear()
}

const FOUR_PROVIDERS = {
  deepseek: { apiKey: 'sk-deepseek', baseUrl: 'https://api.deepseek.com/v1', model: 'deepseek-chat' },
  zhipu: { apiKey: '', baseUrl: 'https://open.bigmodel.cn/api/paas/v4', model: 'glm-4.7-flash' },
  openai: { apiKey: '', baseUrl: 'https://api.openai.com/v1', model: 'gpt-4o-mini' },
  custom: { apiKey: '', baseUrl: '', model: 'gpt-4o-mini' },
}

function putSettings(provider, providers) {
  localStorage.setItem('ai_companion_settings', JSON.stringify({ provider, providers }))
}

console.log('\n[1] 无任何设置 → 默认智谱')
resetStore()
const fresh = loadSettings()
eq(fresh.provider, 'zhipu', '全新用户默认 provider = zhipu')
eq(fresh.apiKey, '', '默认 apiKey 为空')
eq(fresh.baseUrl, DEFAULT_SETTINGS.zhipu.baseUrl, '默认 base_url 用智谱地址')
eq(fresh.model, DEFAULT_SETTINGS.zhipu.model, '默认模型用智谱 glm-4.7-flash')

console.log('\n[2] 已有设置：旧用户保持原选择')
resetStore()
putSettings('deepseek', FOUR_PROVIDERS)
eq(loadSettings().provider, 'deepseek', '选过 DeepSeek → 保持 deepseek')
eq(loadSettings().apiKey, 'sk-deepseek', 'deepseek 的 key 原样保留')

resetStore()
putSettings('zhipu', FOUR_PROVIDERS)
eq(loadSettings().provider, 'zhipu', '选过智谱 → 保持 zhipu')

resetStore()
putSettings('custom', { ...FOUR_PROVIDERS, custom: { apiKey: 'ck', baseUrl: 'https://my.example/v1', model: 'my-model' } })
const customLoaded = loadSettings()
eq(customLoaded.provider, 'custom', '选过自定义 → 保持 custom')
eq(customLoaded.apiKey, 'ck', 'custom 的 key 原样保留')
eq(customLoaded.baseUrl, 'https://my.example/v1', 'custom 的 base_url 原样保留')

resetStore()
putSettings('openai', { ...FOUR_PROVIDERS, openai: { apiKey: 'sk-openai', baseUrl: 'https://x.example/v1', model: 'gpt-x' } })
const openaiLoaded = loadSettings()
eq(openaiLoaded.provider, 'openai', '选过 OpenAI → 保持 openai')
eq(openaiLoaded.apiKey, 'sk-openai', 'openai 的 key 原样保留')

console.log('\n[3] 非法 provider 值 → 兜底智谱')
resetStore()
putSettings('foo', FOUR_PROVIDERS)
eq(loadSettings().provider, 'zhipu', '存了未知服务商 → 兜底 zhipu')
putSettings(undefined, FOUR_PROVIDERS)
eq(loadSettings().provider, 'zhipu', '缺 provider 字段 → 兜底 zhipu')

console.log('\n[4] 损坏 JSON → 兜底智谱')
resetStore()
localStorage.setItem('ai_companion_settings', 'not-json{')
eq(loadSettings().provider, 'zhipu', '损坏 JSON → 兜底 zhipu')
eq(loadSettings().baseUrl, DEFAULT_SETTINGS.zhipu.baseUrl, '损坏 JSON 时配置也用智谱默认')

console.log('\n[5b] 全局慢信笔友模式开关读写')
resetStore()
eq(isSlowLetterMode(), false, '默认（未设置）→ 关闭')
setSlowLetterMode(true)
eq(isSlowLetterMode(), true, '开启 → true')
eq(localStorage.getItem('ai_companion_slow_letter_mode'), '1', '写入值为 1')
setSlowLetterMode(false)
eq(isSlowLetterMode(), false, '关闭 → false')
eq(localStorage.getItem('ai_companion_slow_letter_mode'), '0', '写入值为 0')
resetStore()
localStorage.setItem('ai_companion_slow_letter_mode', '1')
eq(isSlowLetterMode(), true, '直接写入 1 → 读回开启')
localStorage.setItem('ai_companion_slow_letter_mode', '0')
eq(isSlowLetterMode(), false, '直接写入 0 → 读回关闭')
localStorage.setItem('ai_companion_slow_letter_mode', 'other')
eq(isSlowLetterMode(), false, '非法值 → 关闭')

console.log('\n[5] v1 旧格式：单 key 归到所选服务商名下')
resetStore()
localStorage.setItem(
  'ai_companion_settings',
  JSON.stringify({ provider: 'deepseek', apiKey: 'sk-old', baseUrl: 'https://api.deepseek.com/v1', model: 'deepseek-chat' }),
)
const migrated = loadSettings()
eq(migrated.provider, 'deepseek', 'v1 选的是 deepseek → 保持')
eq(migrated.apiKey, 'sk-old', 'v1 的 apiKey 归到 deepseek 名下')

console.log(`\n结果：${passed} 通过，${failed} 失败`)
if (failed > 0) process.exit(1)
