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

function mapHttpError(status: number, bodyText = ''): ChatError {
  // 有些服务商（New API 类中转站）把「模型不存在/没开」也返回 404，
  // 和「地址填错」的 404 长得一样——读一下响应体，给用户说准原因。
  const body = bodyText.toLowerCase()
  const modelMissing =
    body.includes('model_not_found') ||
    body.includes('not supported') ||
    body.includes('model not found') ||
    (body.includes('模型') && body.includes('不存在'))
  if (status === 404 && modelMissing) {
    return new ChatError(
      'bad-request',
      '服务商说没有这个模型（404）：检查「模型名称」有没有填对，或者你的 Key 分组里没有开这个模型',
    )
  }
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
  const send = (withThinking: boolean) =>
    fetchOrThrow(url, {
      method: 'POST',
      headers: buildHeaders(settings),
      body: JSON.stringify({
        model: settings.model,
        messages: [{ role: 'user', content: '你好，请只回复四个字：连接成功' }],
        // 第二批④：思考模型（Gemini/DeepSeek-R1等）需要更多 token 思考，10 不够
        max_tokens: 100,
        stream: false,
        ...thinkingRequestOpts(settings, withThinking),
      }),
    })
  let resp: Response
  try {
    resp = await send(true)
    if (!resp.ok) {
      const bodyText = await resp.text().catch(() => '')
      if (looksLikeThinkingRejection(resp.status, bodyText)) {
        markThinkingUnsupported(settings)
        resp = await send(false)
      } else {
        throw mapHttpError(resp.status, bodyText)
      }
    }
  } catch (e) {
    if (e instanceof ChatError) throw e
    throw new ChatError('unknown', '连接失败，请检查设置')
  }

  if (!resp.ok) throw mapHttpError(resp.status, await resp.text().catch(() => ''))

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

/** 讨思考的通用参数：默认所有服务商都带上（2026-09-23 七七要求），不支持的靠降级兜底 */
const ASK_THINKING_OPTS: Record<string, unknown> = {
  // OpenAI 标准字段，控制思考力度（Gemini 兼容层认）
  reasoning_effort: 'high',
  // Gemini 官方兼容层的线上格式是 extra_body.google.thinking_config（外层必须包 google，不能直接放 thinking_config）
  extra_body: { google: { thinking_config: { include_thoughts: true } } },
}

/** 本次打开期间，哪些「地址 + 模型」已经退回过思考参数（不支持思考链） */
const thinkingUnsupportedKeys = new Set<string>()

function modelKey(settings: ModelSettings): string {
  return `${(settings.baseUrl || '').trim()}|${(settings.model || '').trim()}`
}

/** 这个模型是不是已被判定不支持思考链（聊天页据此显示灰色小字） */
export function isThinkingUnsupported(settings: ModelSettings): boolean {
  return thinkingUnsupportedKeys.has(modelKey(settings))
}

/** 标记「该模型不支持思考链」+ 通知界面显示灰色小字 */
function markThinkingUnsupported(settings: ModelSettings): void {
  const key = modelKey(settings)
  if (thinkingUnsupportedKeys.has(key)) return
  thinkingUnsupportedKeys.add(key)
  try {
    if (typeof window !== 'undefined') {
      window.dispatchEvent(new CustomEvent('yiwem:thinking-unsupported'))
    }
  } catch {
    // 非浏览器环境（单测）忽略
  }
}

/** 服务商是不是在拒绝我们加的思考字段（只有 400/422 才可能是这个原因） */
export function looksLikeThinkingRejection(status: number, bodyText = ''): boolean {
  if (status !== 400 && status !== 422) return false
  const body = bodyText.toLowerCase()
  if (!body) return true
  return (
    body.includes('reasoning_effort') ||
    body.includes('extra_body') ||
    body.includes('thinking') ||
    body.includes('unknown') ||
    body.includes('unrecognized') ||
    body.includes('unsupported') ||
    body.includes('invalid') ||
    body.includes('unexpected')
  )
}

/**
 * 思考（内心戏）请求参数。默认所有服务商都带上（带不动就降级，见各请求处）。
 * - 智谱是例外：它开了思考正文会变空（历史坑），只能关着
 * - 已被判定不支持思考链的模型：不带，免得每次都多撞一次错误
 */
export function thinkingRequestOpts(settings: ModelSettings, withThinking = true): Record<string, unknown> | undefined {
  const zhipu = zhipuThinking(settings)
  if (zhipu) return zhipu
  if (!withThinking) return undefined
  if (isThinkingUnsupported(settings)) return undefined
  return ASK_THINKING_OPTS
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

  const send = (withThinking: boolean) =>
    fetchOrThrow(url, {
      method: 'POST',
      headers: buildHeaders(settings),
      body: JSON.stringify({
        model: settings.model,
        messages,
        stream: false,
        max_tokens: maxTokens,
        temperature,
        ...thinkingRequestOpts(settings, withThinking),
      }),
      signal: controller.signal,
    })
  let resp: Response
  try {
    resp = await send(true)
    if (!resp.ok) {
      const bodyText = await resp.text().catch(() => '')
      if (looksLikeThinkingRejection(resp.status, bodyText)) {
        markThinkingUnsupported(settings)
        resp = await send(false)
      } else {
        throw mapHttpError(resp.status, bodyText)
      }
    }
  } catch (e) {
    if (e instanceof ChatError) throw e
    if (controller.signal.aborted) throw new ChatError('bad-request', '请求超时，请稍后重试')
    throw new ChatError('unknown', '出错了，请稍后重试')
  } finally {
    clearTimeout(timer)
  }

  if (!resp.ok) throw mapHttpError(resp.status, await resp.text().catch(() => ''))

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
    const send = (withThinking: boolean) =>
      fetchOrThrow(url, {
        method: 'POST',
        headers: buildHeaders(settings),
        body: JSON.stringify({
          model: settings.model,
          messages,
          stream: true,
          ...thinkingRequestOpts(settings, withThinking),
        }),
        signal: controller.signal,
      })
    let resp: Response
    try {
      resp = await send(true)
      // 该模型不吃思考参数 → 记一笔、通知界面显示灰色小字，去掉参数再发一次（聊天绝不能断）
      if (!resp.ok) {
        const bodyText = await resp.text().catch(() => '')
        if (looksLikeThinkingRejection(resp.status, bodyText)) {
          markThinkingUnsupported(settings)
          resp = await send(false)
        } else {
          handlers.onError(mapHttpError(resp.status, bodyText))
          return
        }
      }
    } catch (e) {
      if (controller.signal.aborted) return
      handlers.onError(e instanceof ChatError ? e : new ChatError('unknown', '出错了，请稍后重试'))
      return
    }

    if (!resp.ok) {
      const bodyText = await resp.text().catch(() => '')
      handlers.onError(mapHttpError(resp.status, bodyText))
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
            // 收集思考内容（标准字段 reasoning_content；少数网关用 reasoning）
            const reasoning = delta?.reasoning_content ?? delta?.reasoning
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
