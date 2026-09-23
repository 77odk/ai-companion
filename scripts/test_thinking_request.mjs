// 「思考（内心戏）」请求参数测试（2026-09-23 七七要求：各模型都默认带上，Gemini 也要能出灰条）
// 覆盖：
//   1. 智谱照旧关思考（行为不变，它开了正文会空）
//   2. Gemini 官方兼容层：带上讨思考摘要的参数
//   3. Gemini 走中转站：只带标准字段 reasoning_effort，不塞官方私有字段（免被 400）
//   4. 其它服务商（DeepSeek / OpenAI）：一个字段都不加（行为不变）
//   5. streamChat 真正发出去的 body 带上参数，且 reasoning / reasoning_content 两种字段都能收进灰条
//   6. 静态检查：三处请求（测试连接 / 非流式 / 流式）都走 thinkingRequestOpts

import { thinkingRequestOpts, isGeminiProvider, streamChat } from '../src/lib/modelChat.ts'

let passed = 0
let failed = 0
function check(name, cond, detail = '') {
  if (cond) {
    passed++
    console.log('  [ok]', name)
  } else {
    failed++
    console.log('  [x]', name, detail)
  }
}

const s = (baseUrl, model) => ({ baseUrl, model, apiKey: 'test-key' })

console.log('[1] thinkingRequestOpts：各家分开处理')
const zhipu = thinkingRequestOpts(s('https://open.bigmodel.cn/api/paas/v4', 'glm-4.7-flash'))
check('智谱 → 照旧关思考', zhipu && zhipu.thinking && zhipu.thinking.type === 'disabled', JSON.stringify(zhipu))

const google = thinkingRequestOpts(s('https://generativelanguage.googleapis.com/v1beta/openai', 'gemini-3.1-pro-preview'))
check('Gemini 官方 → 带 reasoning_effort', google && google.reasoning_effort === 'high', JSON.stringify(google))
check(
  'Gemini 官方 → 明确讨思考摘要（include_thoughts）',
  google && google.extra_body && google.extra_body.thinking_config && google.extra_body.thinking_config.include_thoughts === true,
  JSON.stringify(google),
)

const relay = thinkingRequestOpts(s('https://api.example-relay.top/v1', 'gemini-3.1-pro-high'))
check('Gemini 走中转 → 带 reasoning_effort', relay && relay.reasoning_effort === 'high', JSON.stringify(relay))
check('Gemini 走中转 → 不塞官方私有字段', relay && relay.extra_body === undefined, JSON.stringify(relay))

check('DeepSeek → 不加任何字段（本来就回 reasoning_content）', thinkingRequestOpts(s('https://api.deepseek.com/v1', 'deepseek-v4-flash')) === undefined)
check('OpenAI 官方 → 不加任何字段', thinkingRequestOpts(s('https://api.openai.com/v1', 'gpt-4o')) === undefined)
check('自定义中转其它模型 → 不加任何字段', thinkingRequestOpts(s('https://api.example-relay.top/v1', 'some-model')) === undefined)

console.log('[2] isGeminiProvider 判定')
check('官方域名认得出', isGeminiProvider(s('https://generativelanguage.googleapis.com/v1beta/openai', 'x')) === true)
check('模型名以 gemini 开头认得出', isGeminiProvider(s('https://api.example-relay.top/v1', 'Gemini-3-flash')) === true)
check('普通模型不误判', isGeminiProvider(s('https://api.deepseek.com/v1', 'deepseek-v4-flash')) === false)

console.log('[3] streamChat：真发出去的 body + 两种思考字段都能收')
const sse = [
  'data: {"choices":[{"delta":{"content":"你好"}}]}',
  '',
  'data: {"choices":[{"delta":{"reasoning":"想一下"}}]}',
  '',
  'data: {"choices":[{"delta":{"reasoning_content":"再想想"}}]}',
  '',
  'data: [DONE]',
  '',
].join('\n')

async function runStream(settings) {
  let captured = null
  globalThis.fetch = async (url, init) => {
    captured = { url, body: init && init.body ? JSON.parse(init.body) : null }
    return new Response(sse, { status: 200, headers: { 'Content-Type': 'text/event-stream' } })
  }
  let reasoning
  let text = ''
  await new Promise((resolve) => {
    streamChat(settings, [{ role: 'user', content: '在吗' }], {
      onToken: (t) => {
        text += t
      },
      onDone: (r) => {
        reasoning = r
        resolve()
      },
      onError: (e) => {
        resolve()
        throw e
      },
    })
  })
  return { captured, reasoning, text }
}

const ds = await runStream(s('https://api.deepseek.com/v1', 'deepseek-v4-flash'))
check('DeepSeek 请求体不含思考参数（行为不变）', ds.captured.body && ds.captured.body.thinking === undefined && ds.captured.body.reasoning_effort === undefined)
check('正文照常收', ds.text === '你好')
check('reasoning + reasoning_content 都进灰条', ds.reasoning === '想一下再想想', String(ds.reasoning))

const gem = await runStream(s('https://generativelanguage.googleapis.com/v1beta/openai', 'gemini-3.1-pro-preview'))
check('Gemini 请求体带上 reasoning_effort', gem.captured.body && gem.captured.body.reasoning_effort === 'high')
check(
  'Gemini 请求体带上 include_thoughts',
  gem.captured.body && gem.captured.body.extra_body && gem.captured.body.extra_body.thinking_config.include_thoughts === true,
)

console.log('[4] 静态检查：三处请求都走 thinkingRequestOpts')
const fs = await import('node:fs')
const src = fs.readFileSync(new URL('../src/lib/modelChat.ts', import.meta.url), 'utf8')
check('三处调用点都在', (src.match(/\.\.\.thinkingRequestOpts\(settings\)/g) || []).length === 3)
check('解析兼容 reasoning 字段', /delta\?\.reasoning_content \?\? delta\?\.reasoning/.test(src))
check('智谱原逻辑仍在', /bigmodel\.cn.*thinking.*disabled/.test(src))

console.log(`\n结果：${passed} passed, ${failed} failed`)
process.exit(failed === 0 ? 0 : 1)
