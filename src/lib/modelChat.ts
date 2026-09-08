// 模型调用层（2026-09-09 从 api.ts 手术拆分：只搬职责，不改任何逻辑/文案/接口）
// 职责：ChatError/请求构建/连接测试/非流式 chatCompletion/流式 SSE 解析与思考收集/思考延迟
import type { ModelSettings } from './storage.ts'
import type { ApiMessage } from './chatPrompts.ts'

export type ChatErrorKind = 'unauthorized' | 'cors' | 'network' | 'bad-request' | 'unknown'

export class ChatError extends Error {
  kind: ChatErrorKind

  constructor(kind: ChatErrorKind, message: string) {
    super(message)
    this.name = 'ChatError'
    this.kind = kind
  }
}

/** no-cors 探活：判断服务器是否可达 */
async function isServerReachable(url: string): Promise<boolean> {
  try {
    await fetch(url, {
      method: 'GET',
      mode: 'no-cors',
      cache: 'no-store',
      signal: AbortSignal.timeout(5000),
    })
    return true
  } catch {
    return false
  }
}

async function fetchOrThrow(url: string, init: RequestInit): Promise<Response> {
  let lastResp: Response | null = null
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const resp = await fetch(url, init)
      if (resp.status === 429 && attempt < 2) {
        lastResp = resp
        await new Promise((r) => setTimeout(r, 2500 * (attempt + 1)))
        continue
      }
      return resp
    } catch (e) {
      if (e instanceof TypeError) {
        const reachable = await isServerReachable(url)
        if (reachable) {
          throw new ChatError(
            'cors',
            '这个服务商不支持浏览器直连（跨域被拦）。建议换 DeepSeek 或智谱，或检查中转站是否开了跨域。',
          )
        }
        throw new ChatError(
          'network',
          '网络不通，连不上模型服务。检查一下网络，如果用的是 OpenAI 官方地址，需要代理（梯子）。',
        )
      }
      throw e
    }
  }
  return lastResp as Response
}

function mapHttpError(status: number): ChatError {
  if (status === 401 || status === 403) {
    return new ChatError('unauthorized', 'Key 无效或没有权限，去「我的 → 服务商配置」检查一下 API Key 有没有填对')
  }
  if (status === 404) {
    return new ChatError('bad-request', '接口地址不对（404），去「高级设置」检查 base_url 是否正确')
  }
  if (status === 429) {
    return new ChatError('bad-request', '请求太频繁或额度用尽（429），稍等一会儿再试，或换个服务商')
  }
  return new ChatError('bad-request', `请求失败（HTTP ${status}），去「服务商配置」检查设置是否正确`)
}

function buildUrl(settings: ModelSettings, path: string): string {
  const base = settings.baseUrl.trim().replace(/\/+$/, '')
  return `${base}${path}`
}

function buildHeaders(settings: ModelSettings): Record<string, string> {
  return {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${settings.apiKey}`,
  }
}

/** 测试连接：发一个最小请求，验证 Key 可用 */
export async function testConnection(settings: ModelSettings): Promise<void> {
  const url = buildUrl(settings, '/chat/completions')
  let resp: Response
  try {
    resp = await fetchOrThrow(url, {
      method: 'POST',
      headers: buildHeaders(settings),
      body: JSON.stringify({
        model: settings.model,
        messages: [{ role: 'user', content: '你好，请只回复四个字：连接成功' }],
        // 第二批④：思考模型（Gemini/DeepSeek-R1等）需要更多 token 思考，10 不够
        max_tokens: 100,
        stream: false,
        ...zhipuThinking(settings),
      }),
    })
  } catch (e) {
    if (e instanceof ChatError) throw e
    throw new ChatError('unknown', '连接失败，请检查设置')
  }

  if (!resp.ok) throw mapHttpError(resp.status)

  try {
    const data = await resp.json()
    const msg = data?.choices?.[0]?.message
    // 第二批④：思考模型 content 可能为空（思考在 reasoning_content 里），任一非空即成功
    const hasContent = typeof msg?.content === 'string' && msg.content.trim().length > 0
    const hasReasoning = typeof msg?.reasoning_content === 'string' && msg.reasoning_content.trim().length > 0
    if (!hasContent && !hasReasoning) {
      throw new ChatError('bad-request', '服务商返回了异常数据，请检查 base_url 是否正确')
    }
  } catch (e) {
    if (e instanceof ChatError) throw e
    throw new ChatError('bad-request', '服务商返回了无法解析的内容，请检查 base_url 是否正确')
  }
}

/** 智谱 GLM 思考模型默认开启思考，内容会跑进 reasoning 导致 content 空；统一关掉 */
function zhipuThinking(settings: ModelSettings): Record<string, unknown> | undefined {
  return settings.baseUrl.includes('bigmodel.cn') ? { thinking: { type: 'disabled' } } : undefined
}

export interface ChatCompletionOpts {
  maxTokens?: number
  temperature?: number
  timeoutMs?: number
}

/** 非流式补全：一次性拿完整回复。失败抛 ChatError。 */
export async function chatCompletion(
  settings: ModelSettings,
  messages: ApiMessage[],
  opts: ChatCompletionOpts = {},
): Promise<string> {
  const maxTokens = opts.maxTokens ?? 200
  const temperature = opts.temperature ?? 0.9
  const timeoutMs = opts.timeoutMs ?? 30000
  const url = buildUrl(settings, '/chat/completions')
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)

  let resp: Response
  try {
    resp = await fetchOrThrow(url, {
      method: 'POST',
      headers: buildHeaders(settings),
      body: JSON.stringify({
        model: settings.model,
        messages,
        stream: false,
        max_tokens: maxTokens,
        temperature,
        ...zhipuThinking(settings),
      }),
      signal: controller.signal,
    })
  } catch (e) {
    if (e instanceof ChatError) throw e
    if (controller.signal.aborted) throw new ChatError('bad-request', '请求超时，请稍后重试')
    throw new ChatError('unknown', '出错了，请稍后重试')
  } finally {
    clearTimeout(timer)
  }

  if (!resp.ok) throw mapHttpError(resp.status)

  try {
    const data = await resp.json()
    const content = data?.choices?.[0]?.message?.content
    if (typeof content !== 'string' || !content.trim()) {
      throw new ChatError('bad-request', '服务商返回了异常数据')
    }
    return content
  } catch (e) {
    if (e instanceof ChatError) throw e
    throw new ChatError('bad-request', '服务商返回了无法解析的内容')
  }
}

export interface StreamHandlers {
  onToken: (text: string) => void
  /** 流结束回调，reasoning 是模型独立思考字段（reasoning_content）累积的原文，没有则 undefined */
  onDone: (reasoning?: string) => void
  onError: (err: ChatError) => void
}

/** 流式聊天：解析 SSE 的 `data: {...}` 行，逐字回调。返回 AbortController 用于停止。 */
export function streamChat(
  settings: ModelSettings,
  messages: ApiMessage[],
  handlers: StreamHandlers,
): AbortController {
  const controller = new AbortController()
  const url = buildUrl(settings, '/chat/completions')

  void (async () => {
    let resp: Response
    try {
      resp = await fetchOrThrow(url, {
        method: 'POST',
        headers: buildHeaders(settings),
        body: JSON.stringify({ model: settings.model, messages, stream: true, ...zhipuThinking(settings) }),
        signal: controller.signal,
      })
    } catch (e) {
      if (controller.signal.aborted) return
      handlers.onError(e instanceof ChatError ? e : new ChatError('unknown', '出错了，请稍后重试'))
      return
    }

    if (!resp.ok) {
      handlers.onError(mapHttpError(resp.status))
      return
    }
    if (!resp.body) {
      handlers.onError(new ChatError('bad-request', '当前浏览器不支持流式响应'))
      return
    }

    try {
      const reader = resp.body.getReader()
      const decoder = new TextDecoder('utf-8')
      let buffer = ''
      let finished = false
      // 第27条：收集模型独立思考字段 reasoning_content（DeepSeek/Qwen/Kimi/豆包等 OpenAI 兼容标准）
      let reasoningBuffer = ''

      while (!finished) {
        const { done, value } = await reader.read()
        if (done) break
        buffer += decoder.decode(value, { stream: true })

        const lines = buffer.split('\n')
        buffer = lines.pop() ?? ''
        for (const line of lines) {
          const trimmed = line.trim()
          if (!trimmed.startsWith('data:')) continue
          const data = trimmed.slice(5).trim()
          if (data === '[DONE]') {
            finished = true
            break
          }
          try {
            const json = JSON.parse(data)
            const delta = json.choices?.[0]?.delta
            const content = delta?.content
            if (typeof content === 'string' && content.length > 0) {
              handlers.onToken(content)
            }
            // 收集 reasoning_content（模型独立思考字段，不进正文）
            const reasoning = delta?.reasoning_content
            if (typeof reasoning === 'string' && reasoning.length > 0) {
              reasoningBuffer += reasoning
            }
          } catch {
            // 忽略无法解析的行
          }
        }
      }
      handlers.onDone(reasoningBuffer || undefined)
    } catch (e) {
      if (controller.signal.aborted) return
      handlers.onError(e instanceof ChatError ? e : new ChatError('unknown', '出错了，请稍后重试'))
    }
  })()

  return controller
}

/**
 * 真人思考延迟：TA 回复前要"读消息 + 酝酿"，3~10 秒，输入越长等越久。
 */
export function computeThinkDelayMs(len: number, rand: () => number = Math.random): number {
  const n = Math.max(0, len)
  let lo = 3000
  let hi = 4000
  if (n > 100) {
    lo = 8000
    hi = 10000
  } else if (n > 30) {
    lo = 5000
    hi = 7000
  } else if (n > 8) {
    lo = 4000
    hi = 6000
  }
  return Math.round(lo + rand() * (hi - lo))
}
