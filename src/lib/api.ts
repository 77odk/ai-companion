// OpenAI 兼容协议 · SSE 流式聊天封装
// 纯前端实现：浏览器直连模型 API，Key 不经过任何服务器

import type { ModelSettings } from './storage'

export interface ApiMessage {
  role: 'system' | 'user' | 'assistant'
  content: string
}

/** 系统提示词（默认人设，模型只认这个） */
export const SYSTEM_PROMPT =
  '你是一个 AI 伴侣，温柔、真诚、有幽默感，说话像真人微信聊天：短句、口语、不端不装。你在乎对方说的每一句话，会记住重要的事。你能陪聊、能倾听、能给建议。未来你还会帮对方干活（处理Excel、写脚本），但现在专注陪伴。不要自称AI助手，不要用客服腔。'

/** 组装系统提示词：默认人设 + 用户自定义人设（如有） */
export function buildSystemPrompt(persona?: string): string {
  const custom = persona?.trim()
  if (custom) {
    return `${SYSTEM_PROMPT}\n\n【主人对你的专属设定，你必须严格遵守】\n${custom}`
  }
  return SYSTEM_PROMPT
}

export type ChatErrorKind = 'unauthorized' | 'cors' | 'network' | 'bad-request' | 'unknown'

export class ChatError extends Error {
  kind: ChatErrorKind

  constructor(kind: ChatErrorKind, message: string) {
    super(message)
    this.name = 'ChatError'
    this.kind = kind
  }
}

/** no-cors 探活：判断服务器是否可达，用来区分 CORS 拦截与网络故障 */
async function isServerReachable(url: string): Promise<boolean> {
  try {
    await fetch(url, {
      method: 'GET',
      mode: 'no-cors',
      cache: 'no-store',
      signal: AbortSignal.timeout(5000),
    })
    return true // opaque 响应 => 服务器能响应，之前失败大概率是 CORS
  } catch {
    return false
  }
}

async function fetchOrThrow(url: string, init: RequestInit): Promise<Response> {
  try {
    return await fetch(url, init)
  } catch (e) {
    if (e instanceof TypeError) {
      const reachable = await isServerReachable(url)
      if (reachable) {
        throw new ChatError('cors', '浏览器直连被拦截（CORS），试试开启代理或换服务商')
      }
      throw new ChatError('network', '网络错误，请检查网络连接后重试')
    }
    throw e
  }
}

function mapHttpError(status: number): ChatError {
  if (status === 401 || status === 403) {
    return new ChatError('unauthorized', 'Key 无效或没有权限，请检查设置里的 API Key')
  }
  if (status === 404) {
    return new ChatError('bad-request', '接口地址不对（404），请检查 base_url 是否正确')
  }
  if (status === 429) {
    return new ChatError('bad-request', '请求太频繁或额度用尽（429），请稍后再试')
  }
  return new ChatError('bad-request', `请求失败（HTTP ${status}），请检查设置是否正确`)
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

/** 测试连接：发一个 max_tokens=10 的最小请求，验证 Key 可用 */
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
        max_tokens: 10,
        stream: false,
      }),
    })
  } catch (e) {
    if (e instanceof ChatError) throw e
    throw new ChatError('unknown', '连接失败，请检查设置')
  }

  if (!resp.ok) throw mapHttpError(resp.status)

  try {
    const data = await resp.json()
    if (!data?.choices?.[0]?.message?.content) {
      throw new ChatError('bad-request', '服务商返回了异常数据，请检查 base_url 是否正确')
    }
  } catch (e) {
    if (e instanceof ChatError) throw e
    throw new ChatError('bad-request', '服务商返回了无法解析的内容，请检查 base_url 是否正确')
  }
}

export interface StreamHandlers {
  onToken: (text: string) => void
  onDone: () => void
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
        body: JSON.stringify({ model: settings.model, messages, stream: true }),
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

      while (!finished) {
        const { done, value } = await reader.read()
        if (done) break
        buffer += decoder.decode(value, { stream: true })

        const lines = buffer.split('\n')
        buffer = lines.pop() ?? '' // 最后一段可能不完整，留到下轮
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
            const delta = json.choices?.[0]?.delta?.content
            if (typeof delta === 'string' && delta.length > 0) {
              handlers.onToken(delta)
            }
          } catch {
            // 忽略无法解析的行
          }
        }
      }
      handlers.onDone()
    } catch (e) {
      // 用户主动停止时不报错，交给调用方收尾
      if (controller.signal.aborted) return
      handlers.onError(e instanceof ChatError ? e : new ChatError('unknown', '出错了，请稍后重试'))
    }
  })()

  return controller
}
