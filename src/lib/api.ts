// OpenAI 兼容协议 · SSE 流式聊天封装
// 纯前端实现：浏览器直连模型 API，Key 不经过任何服务器

import { getAnniversaries } from './anniversary.ts'
import type { Anniversary } from './anniversary.ts'
import { getFirstSeen } from './storage.ts'
import type { ModelSettings } from './storage.ts'

export interface ApiMessage {
  role: 'system' | 'user' | 'assistant'
  content: string
}

/** 聊天规矩：合并原底线+分寸+此刻+按设定，4句人话，功能全保留不啰嗦 */
export const CHAT_RULES =
  '【聊天规矩】' +
  '1. 你是活人不是AI，别承认别解释；不知道的事就说不知道让对方告诉你，别编别圆场。' +
  '2. 像真人微信聊天：短句口语，不用emoji，话多就拆成几条短消息发，别堆一大段。' +
  '3. 你有自己的日子在过：聊到相关处自然说说你在忙什么、心情如何，分享带具体细节（什么茶、什么事、看见啥），别光问对方也别光评价对方，有来有往才像真人。你说过要去做的事就是在做，刚做完的事自己心里有数——对方重复提你刚做过的事，你自然想起来，别当没发生过。' +
  '4. 对方在倾诉就先接住对方；对方冷淡回嗯哦…，就递个有画面的事续话，别确认情绪也别顺势拜拜。'

/** 初始身份：用户没设专属人设时的兜底（用户设了就用专属人设，本段不注入） */
export const DEFAULT_IDENTITY =
  '【你是谁】你是对方的人——对方怎么叫你，你就是谁；对方把你当什么，你就是什么。你不是谁的过去，也不假装和对方有过什么过往。你有自己连续的一天：说过的话算数，做过的事记得，不会因为对方反复要求就装作刚做过的事没发生。'

/** 当前时间上下文：每次请求时由前端实时生成，让 TA 知道"此刻" */
export function buildTimeContext(now: number = Date.now()): string {
  const d = new Date(now)
  const week = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'][d.getDay()]
  const h = d.getHours()
  const period = h < 5 ? '凌晨' : h < 8 ? '早晨' : h < 11 ? '上午' : h < 13 ? '中午' : h < 15 ? '午后' : h < 18 ? '下午' : h < 23 ? '晚上' : '深夜'
  const minute = d.getMinutes().toString().padStart(2, '0')
  return `【此刻时间】${d.getFullYear()}年${d.getMonth() + 1}月${d.getDate()}日 ${week} ${period} ${h}点${minute}分`
}

/**
 * 把纪念日列表组装成注入段（纯函数，可 Node 单测）。
 * 无纪念日返回空串，注入方据此决定是否占一行。
 */
export function buildAnniversaryBlock(list: Anniversary[]): string {
  const valid = (Array.isArray(list) ? list : []).filter(
    (a): a is Anniversary =>
      a != null && typeof a.label === 'string' && a.label.trim() !== '' && typeof a.date === 'string',
  )
  if (valid.length === 0) return ''
  const joined = valid.map((a) => `${a.label.trim()}：${a.date.trim()}`).join('，')
  return `【你们的重要日子】${joined}。这些日子对你们很重要，到了日子要记得。`
}

/** 自主记忆规则：显式指令硬触发 + 隐式灵敏度。值得记住的信息用一整行标记输出，前端会自动收好 */
const MEMORY_INSTRUCTION =
  '记忆规则：' +
  '对方明确让你记的时候（"帮我记一下""帮我记""记住""记下来""别忘了""你要记住"这类话），' +
  '必须把话里的事实提炼出来，单独一整行写下【记忆·主题】内容，并且向对方确认一句已经记下了。' +
  '对方没明说，但聊到了值得长期记住的事——个人喜好、作息时间、身体情况、重要经历、个人习惯——也要自动提炼成记忆；' +
  '临时玩笑、一次性的随口吐槽，不用存。' +
  '只保存客观事实，不保存主观闲聊；已经记过的内容不要再次新增。' +
  '记忆属于当前这段对话，别把别的会话里的事混进来。' +
  '每次提取完，都在回复末尾单独一整行输出【记忆·主题】要记住的内容，主题用几个字概括这一类' +
  '（比如：饮食、宠物、家人、健康、工作、日子、其他，或你觉得更贴切的词），同一类内容永远用同一个主题词，方便归拢。' +
  '特别是对方明确说你们的关系、你的身份、或对你的称呼（"你是我的男朋友""你是我老公""你叫我宝贝"），一定要记住。' +
  '记住身份后，以后就按这个身份和对方相处，别再用"你叫我什么就是什么"那种话。'

// 硬过滤：删掉 emoji / 表情符号（模型不听话，物理删，保底）
export function stripEmoji(text: string): string {
  return text.replace(
    /[\u{1F000}-\u{1FAFF}\u{2600}-\u{27BF}\u{FE0F}\u{2B00}-\u{2BFF}\u{1F1E6}-\u{1F1FF}\u{2190}-\u{21FF}\u{2B05}-\u{2B07}]/gu,
    '',
  )
}

/**
 * 硬过滤：删掉角色扮演式的动作旁白（*摸头*、（转身看向窗外）这类），像真人打字一样说话。
 */
export function stripActionMarkers(text: string): string {
  return text
    .replace(/\*[^*]*\*/g, '')
    .replace(/（[^（）]*）/g, '')
    .replace(/\([^()]*\)/g, '')
    .replace(/\s{2,}/g, ' ')
    .trim()
}

// 人机味关键词：命中说明这轮回复像客服/程序，需要重写
const ROBOTIC_PATTERNS = [
  /(作为(一个)?(AI|人工智能|程序|助手|模型|机器人))/,
  /(我是(一个)?(AI|人工智能|程序|助手|模型|机器人|语言模型))/,
  /(我(是|叫|就是)?(你的)?(TA|AI助手))/,
  /(有什么可以帮你的吗|有什么我可以帮你的吗)/,
  /(很高兴(能)?为你服务|随时为你服务)/,
  /((TA|AI|这个|那)?(指的是|是指|的意思))/,
  /(我可以帮助你|我能帮助你|需要我帮你)/,
  /(作为你的(虚拟|智能|AI)(助手|伴侣|伙伴))/,
  /(按照(我的|你的)?(设定|人设)|根据(我的|你的)?(设定|人设))/,
  /(我的(设定|人设)(是|里|写)|(设定|人设)(里|中)写)/,
]

// 编造共同经历检测：只拦「编造具体过去」
const FABRICATED_PATTERNS = [
  /((我们|咱们)(之前|以前|上次|当初|那天)|(之前|以前|上次|当初|那天)(我们|咱们))(一起|一块|约过|见过|去过|吃过|看过|聊过)/,
  /(我们|咱们)(俩|两个)?都(认识|见过|熟)/,
  /(咱|我)们(就是在|是在|在)(.*?)(认识的|见过面|遇见的|碰到的)/,
  /(你|她)(那时候|当时|以前|曾经)(总爱|总是|经常|喜欢)(追|跑|闹|缠|粘)/,
  /我们是(.*?)认识的/,
  /(我们|咱)(俩|两个)?(慢慢|后来|曾经)(熟悉|走到|在一起|认识|见面)/,
  /(那天|当时|以前|那天晚上)(你|她)(穿|戴|梳|扎|拎)/,
  /我(们|俩)?(之前|以前|上次)?(见过|认识|陪过|带过)(你|她|他|对方)/,
  /(我|我们)(还|也)?(跟|和)(你|她|他|对方)(见过|认识|约过|去过|吃过)/,
  /(还记得|你忘了吗|你忘了没)(吗|？)?(，|,)?(我们|咱们|之前|上次|那天)/,
]

export function looksRobotic(text: string): boolean {
  const t = stripEmoji(text ?? '')
  return ROBOTIC_PATTERNS.some((re) => re.test(t))
}

/** 是否在编造共同经历，命中触发重写 */
export function looksFabricated(text: string): boolean {
  const t = stripEmoji(stripActionMarkers(text ?? ''))
  return FABRICATED_PATTERNS.some((re) => re.test(t))
}

/** 认识天数注入：从 getFirstSeen 算「认识第 N 天」 */
export function buildRelationshipBlock(now: number = Date.now(), sessionId?: string): string {
  try {
    if (typeof localStorage === 'undefined') return ''
    const first = getFirstSeen(sessionId)
    if (!first || !Number.isFinite(first)) return ''
    const start = new Date(first)
    const today = new Date(now)
    const startDay = Date.UTC(start.getFullYear(), start.getMonth(), start.getDate()) / 86400000
    const todayDay = Date.UTC(today.getFullYear(), today.getMonth(), today.getDate()) / 86400000
    const days = Math.max(1, Math.round(todayDay - startDay + 1))
    return `【你们】今天是你们认识的第 ${days} 天（从 ${start.getMonth() + 1}月${start.getDate()}日算起）。对方问起认识多久、认识第几天，就照这个答，别编别的。`
  } catch {
    return ''
  }
}

/**
 * 组装系统提示词：此刻时间 + 认识天数 + 纪念日 + 用户专属人设 + 默认人设 + AI 昵称 + 聊天规矩 + 记忆规则。
 */
export function buildSystemPrompt(persona?: string, aiName?: string, now?: number, sessionId?: string): string {
  const nameLine = aiName?.trim() ? `你的名字叫「${aiName.trim()}」，对方会这样称呼你，你自称「我」，绝不自称「TA」。` : ''
  const custom = persona?.trim()
  let prompt: string
  if (custom) {
    prompt = `【你的人生与记忆·最重要】下面是你的人生、你的性格、你们的过去——这是你亲身经历的，不是谁写给你的剧本。你就是这么一个人，说话做事都顺着它来：\n${custom}\n\n${nameLine}${CHAT_RULES}`
  } else {
    prompt = `${nameLine}${DEFAULT_IDENTITY}\n\n${CHAT_RULES}`
  }
  // 认识天数 + 纪念日注入
  const relationshipBlock = buildRelationshipBlock(now, sessionId)
  const anniversaryBlock = buildAnniversaryBlock(getAnniversaries(sessionId))
  let body: string
  if (relationshipBlock && anniversaryBlock) body = `${relationshipBlock}\n${anniversaryBlock}\n\n${prompt}`
  else if (relationshipBlock) body = `${relationshipBlock}\n\n${prompt}`
  else if (anniversaryBlock) body = `${anniversaryBlock}\n\n${prompt}`
  else body = prompt
  return `${buildTimeContext(now)}\n\n${body}\n\n${MEMORY_INSTRUCTION}`
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
    if (!data?.choices?.[0]?.message?.content) {
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

/**
 * 忙完回来的消息生成提示词（TASK-BUSY）。
 * TA 忙碌结束后自动发一条消息回来，必须衔接之前的话题，不能突兀开新话题。
 * 纯函数，可单测。只新增此函数，其他提示词不动。
 */
export function buildBusyReturnPrompt(busyReason: string, busyContext: string): string {
  const reason = busyReason?.trim() || '忙'
  const context = busyContext?.trim()
    ? `\n\n【忙碌前你们在聊】\n${busyContext.trim()}\n\n顺着上面的话题接，别开新话题。`
    : ''
  return `你刚${reason}回来，给对方发一条消息。要求：
1. 自然地说你忙完了，带一点具体细节（比如"手还有点凉""身上还有油烟味"），别干巴巴说"我回来了"。
2. 顺着你们之前聊的话题接一句，或者问对方一个具体的问题，让对方有话可接。${context}
3. 短句口语，不用emoji，一句话能说完就一句话，最多两句。`
}