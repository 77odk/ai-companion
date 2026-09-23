// 「思考（内心戏）」请求参数测试（2026-09-23 七七要求：所有模型统一带上，不支持就在聊天框灰字说明并降级）
// 覆盖：
//   1. thinkingRequestOpts：默认所有服务商都带上讨思考的参数；智谱例外（它开了正文会空）
//   2. looksLikeThinkingRejection：只有 400/422 才可能是「参数不被接受」
//   3. streamChat 正常路径：请求体带上参数、reasoning / reasoning_content 都能进灰条
//   4. streamChat 降级路径：服务商拒了 → 记一笔 + 发事件 + 去掉参数重试一次，聊天不断
//   5. 静态检查：三处请求都走 thinkingRequestOpts，且都有降级重试

import { thinkingRequestOpts, looksLikeThinkingRejection, isThinkingUnsupported, streamChat } from '../src/lib/modelChat.ts'

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
const ASK_FIELDS = ['reasoning_effort', 'extra_body']

console.log('[1] thinkingRequestOpts：默认全部带上')
const ds = thinkingRequestOpts(s('https://api.deepseek.com/v1', 'deepseek-v4-flash'))
check('DeepSeek 也带（不再按家判断）', ds && ds.reasoning_effort === 'high', JSON.stringify(ds))
const gem = thinkingRequestOpts(s('https://generativelanguage.googleapis.com/v1beta/openai', 'gemini-3.1-pro-preview'))
check('Gemini 带 reasoning_effort', gem && gem.reasoning_effort === 'high')
check('Gemini 带 include_thoughts（外层包 google）', gem && gem.extra_body && gem.extra_body.google && gem.extra_body.google.thinking_config.include_thoughts === true, JSON.stringify(gem))
const relay = thinkingRequestOpts(s('https://api.example-relay.top/v1', 'some-model'))
check('自定义中转也带', relay && relay.reasoning_effort === 'high')
const zp = thinkingRequestOpts(s('https://open.bigmodel.cn/api/paas/v4', 'glm-4.7-flash'))
check('智谱例外：照旧关思考（它开了正文会空）', zp && zp.thinking && zp.thinking.type === 'disabled', JSON.stringify(zp))
check('withThinking=false → 一个字段都不加（降级用）', thinkingRequestOpts(s('https://api.deepseek.com/v1', 'deepseek-v4-flash'), false) === undefined)

console.log('[2] looksLikeThinkingRejection 判定')
check('400 且点名 reasoning_effort → 是', looksLikeThinkingRejection(400, '{"error":{"message":"Unrecognized field: reasoning_effort"}}') === true)
check('422 且提到 thinking → 是', looksLikeThinkingRejection(422, 'unsupported parameter: thinking') === true)
check('400 空响应体 → 当作是（宁可多试一次）', looksLikeThinkingRejection(400, '') === true)
check('500 → 不是（真故障，别掩盖）', looksLikeThinkingRejection(500, 'internal error') === false)
check('401 → 不是（Key 问题）', looksLikeThinkingRejection(401, 'unauthorized') === false)
check('404 → 不是（地址/模型问题）', looksLikeThinkingRejection(404, 'not found') === false)

console.log('[3] streamChat 正常路径')
const sseBody = [
  'data: {"choices":[{"delta":{"content":"你好"}}]}',
  '',
  'data: {"choices":[{"delta":{"reasoning":"想一下"}}]}',
  '',
  'data: {"choices":[{"delta":{"reasoning_content":"再想想"}}]}',
  '',
  'data: [DONE]',
  '',
].join('\n')

async function runStream(settings, responder) {
  const calls = []
  const events = []
  globalThis.window = { dispatchEvent: (e) => events.push(e && e.type ? e.type : 'event') }
  globalThis.fetch = async (url, init) => {
    const body = init && init.body ? JSON.parse(init.body) : null
    calls.push({ url, body })
    return responder(calls.length, body)
  }
  let reasoning
  let text = ''
  let err = null
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
        err = e
        resolve()
      },
    })
  })
  return { calls, events, reasoning, text, err }
}

const okResponder = () => new Response(sseBody, { status: 200, headers: { 'Content-Type': 'text/event-stream' } })
const fine = await runStream(s('https://api.deepseek.com/v1', 'deepseek-v4-flash'), okResponder)
check('请求体带上思考参数', fine.calls[0].body.reasoning_effort === 'high')
check('正文照常收', fine.text === '你好')
check('reasoning + reasoning_content 都进灰条', fine.reasoning === '想一下再想想', String(fine.reasoning))

console.log('[4] streamChat 降级路径（服务商不认参数）')
let secondOk = false
const rejectingResponder = (n) => {
  if (n === 1) return new Response('{"error":{"message":"Unrecognized field: reasoning_effort"}}', { status: 400 })
  secondOk = true
  return new Response(sseBody, { status: 200, headers: { 'Content-Type': 'text/event-stream' } })
}
const settings = s('https://api.example-relay.top/v1', 'weird-model')
const degraded = await runStream(settings, rejectingResponder)
check('被拒后自动重试了一次（共两次请求）', degraded.calls.length === 2, String(degraded.calls.length))
check('第一次带参数、第二次不带（聊天不断）', degraded.calls[0].body.reasoning_effort === 'high' && degraded.calls[1].body.reasoning_effort === undefined && degraded.calls[1].body.extra_body === undefined)
check('重试后拿到正文', secondOk === true && degraded.text === '你好')
check('发出「不支持思考链」事件（界面据此显示灰字）', degraded.events.includes('yiwem:thinking-unsupported'), JSON.stringify(degraded.events))
check('记下了这个模型不支持', isThinkingUnsupported(settings) === true)
const afterMark = thinkingRequestOpts(settings)
check('记住之后不再往上撞（下次直接不带）', afterMark === undefined, JSON.stringify(afterMark))
check('没有报错给用户', degraded.err === null)

console.log('[5] 静态检查')
const fs = await import('node:fs')
const src = fs.readFileSync(new URL('../src/lib/modelChat.ts', import.meta.url), 'utf8')
check('三处请求都走 thinkingRequestOpts', (src.match(/\.\.\.thinkingRequestOpts\(settings, withThinking\)/g) || []).length === 3)
check('三处都有降级重试', (src.match(/markThinkingUnsupported\(settings\)/g) || []).length === 3)
check('解析兼容 reasoning 字段', /delta\?\.reasoning_content \?\? delta\?\.reasoning/.test(src))
check('Gemini 格式走 extra_body.google.thinking_config（Codex P1）', /extra_body: \{ google: \{ thinking_config: \{ include_thoughts: true \} \} \}/.test(src))
const chat = fs.readFileSync(new URL('../src/components/Chat.tsx', import.meta.url), 'utf8')
check('聊天页显示灰字提示', /该模型不支持思考链/.test(chat))
check('聊天页监听不支持事件', /yiwem:thinking-unsupported/.test(chat))

console.log(`\n结果：${passed} passed, ${failed} failed`)
process.exit(failed === 0 ? 0 : 1)
