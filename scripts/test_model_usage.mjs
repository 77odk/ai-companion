import assert from 'node:assert/strict'
import { streamChat } from '../src/lib/modelChat.ts'

const encoder = new TextEncoder()
let lastBody = null

function sseResponse(lines) {
  const body = new ReadableStream({
    start(controller) {
      controller.enqueue(encoder.encode(lines.join('\n') + '\n'))
      controller.close()
    },
  })
  return new Response(body, { status: 200, headers: { 'content-type': 'text/event-stream' } })
}

function runStream(settings, lines) {
  return new Promise((resolve, reject) => {
    let text = ''
    streamChat(settings, [{ role: 'user', content: '在吗' }], {
      onToken: (chunk) => { text += chunk },
      onDone: (reasoning, usage) => resolve({ text, reasoning, usage }),
      onError: reject,
    })
  })
}

globalThis.fetch = async (_url, init) => {
  lastBody = JSON.parse(String(init?.body || '{}'))
  return sseResponse([
    'data: {"choices":[{"delta":{"content":"在"}}]}',
    'data: {"choices":[{"delta":{"content":"。","reasoning_content":"想一下"}}]}',
    'data: {"choices":[],"usage":{"prompt_tokens":1234,"completion_tokens":12,"total_tokens":1246,"prompt_cache_hit_tokens":900}}',
    'data: [DONE]',
    '',
  ])
}

console.log('\n[1] DeepSeek 官方：请求 usage + 读取最后流式包真实 token')
const official = await runStream(
  { apiKey: 'x', baseUrl: 'https://api.deepseek.com', model: 'deepseek-chat' },
  [],
)
assert.equal(official.text, '在。')
assert.equal(official.reasoning, '想一下')
assert.equal(official.usage?.promptTokens, 1234)
assert.equal(official.usage?.completionTokens, 12)
assert.equal(official.usage?.totalTokens, 1246)
assert.equal(official.usage?.cachedPromptTokens, 900)
assert.deepEqual(lastBody?.stream_options, { include_usage: true }, '官方 DeepSeek 请求最后 usage 包')

console.log('\n[2] 中转站：不强塞 stream_options，但如果它自己回 usage 仍正常读取')
globalThis.fetch = async (_url, init) => {
  lastBody = JSON.parse(String(init?.body || '{}'))
  return sseResponse([
    'data: {"choices":[{"delta":{"content":"好"}}]}',
    'data: {"choices":[],"usage":{"prompt_tokens":2222,"total_tokens":2230}}',
    'data: [DONE]',
    '',
  ])
}
const relay = await runStream(
  { apiKey: 'x', baseUrl: 'https://relay.example.com/v1', model: 'deepseek-chat' },
  [],
)
assert.equal(relay.text, '好')
assert.equal(relay.usage?.promptTokens, 2222)
assert.equal(lastBody?.stream_options, undefined, '未知中转站不增加兼容性风险')

console.log('\n[3] 服务商不回 usage：onDone 明确得到 undefined，UI 可退回估算')
globalThis.fetch = async () => sseResponse([
  'data: {"choices":[{"delta":{"content":"嗯"}}]}',
  'data: [DONE]',
  '',
])
const noUsage = await runStream(
  { apiKey: 'x', baseUrl: 'https://relay.example.com/v1', model: 'test' },
  [],
)
assert.equal(noUsage.text, '嗯')
assert.equal(noUsage.usage, undefined)

console.log('\nmodel usage：全部通过')
