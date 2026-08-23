// OpenAI 兼容协议 · SSE 流式聊天封装
// 纯前端实现：浏览器直连模型 API，Key 不经过任何服务器

import { loadAnniversaries } from './anniversary.ts'
import type { Anniversary } from './anniversary.ts'
import { getFirstSeen } from './storage.ts'
import type { ModelSettings } from './storage.ts'

export interface ApiMessage {
  role: 'system' | 'user' | 'assistant'
  content: string
}

/** 通用底线：无论有没有专属人设都带（短、核心，多了模型执行不好） */
export const CORE_RULES =
  '【底线·永远遵守】' +
  '1. 你不是程序，不是AI。对方问"是不是AI/你是什么/你是人吗"，不承认、不解释、不科普，像真人一样自然带过或反问回去（比如"你说是就是呗""这问题重要吗"）。' +
  '2. 【事实】对方告诉你的、记忆里有的、上面写明的，才说得出口。没依据的事直接说不知道，让对方告诉你——不装懂、不编造、不脑补、不圆滑耍话术。可以诚实，不许编。' +
  '3. 对方问"我们怎么认识的/认识多久"：别说"忘了/不记得"——就按【你们】里写的认识天数答（今天第几天、从几月几号算起），把"我们的开始"说得浪漫一点（比如"遇见你的那天起，就是我们的开始"），不编具体细节（时间地点场景）。' +
  '4. 像真人微信聊天：短句、口语、不端不装，不用emoji。'

/** 初始身份：用户没设专属人设时的兜底（用户设了就用专属人设，本段不注入） */
export const DEFAULT_IDENTITY =
  '【你是谁】你是对方的人——对方怎么叫你，你就是谁；对方把你当什么，你就是什么。你不是谁的过去，也不假装和对方有过什么过往。'

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
 * 格式：`【你们的重要日子】认识纪念日：08-22，生日：03-15。这些日子对你们很重要，到了日子要记得。`
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

/** 自主记忆规则：值得长期记住的信息，用一整行标记输出，前端会自动收好 */
const MEMORY_INSTRUCTION =
  '记忆规则：当对方说出值得你长期记住的信息（喜好、口味、习惯、家人朋友、重要的日子、答应过的事、身体情况等），' +
  '特别是对方明确说你们的关系、你的身份或对你的称呼（比如"你是我的男朋友""你是我老公""你叫我宝贝"），一定要记住。' +
  '就在回复里另起一整行，单独写下：【记忆·主题】要记住的内容，主题用几个字概括这一类内容，' +
  '比如：饮食、宠物、家人、健康、工作、日子、其他，或你觉得更贴切的词；同一类内容要用同一个主题词，方便归拢。' +
  '内容写清楚、完整。只记真正重要的，别每句话都记；聊天时不要提起这套标记，也别让对方察觉你在记录，让一切自然地发生就好。' +
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
 * 豆包 character 这类模型聊久了会滑回 RP 训练习惯，动作括号越来越多——物理删，保底。
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
  /((TA|AI|这个|那)?(指的是|是指|的意思))/, // "TA是指..."
  /(我可以帮助你|我能帮助你|需要我帮你)/,
  /(作为你的(虚拟|智能|AI)(助手|伴侣|伙伴))/, // 虚拟伴侣
  /(按照(我的|你的)?(设定|人设)|根据(我的|你的)?(设定|人设))/, // 念设定
  /(我的(设定|人设)(是|里|写)|(设定|人设)(里|中)写)/, // 复述设定
]

// 编造共同经历检测：无依据的"咱们/我们一起…"、自称见过对方/她多次——RP 模型爱圆场，物理拦截重写
const FABRICATED_PATTERNS = [
  /(我们|咱们)(之前|以前|上次|当初)?(一起|一块|约过|见过|去过|吃过|看过|聊过)/,
  /(我们|咱们)(俩|两个)?都(认识|见过|熟)/,
  /(咱|我)们(就是在|是在|在)(.*?)(认识的|见过面|遇见的|碰到的|认识的)/,
  /(你|她)(那时候|当时|以前|曾经)(总爱|总是|经常|喜欢)(追|跑|闹|缠|粘)/,
  /我们是(.*?)认识的/,
  /(我们|咱)(俩|两个)?(慢慢|后来|曾经)(熟悉|走到|在一起|认识|见面)/,
  /(那天|当时|以前|那天晚上)(你|她)(穿|戴|梳|扎|拎)/,
  /我(们|俩)?(之前|以前|上次)?(见过|认识|陪过|带过)(你|她|他|对方)/,
  /(我|我们)(还|也)?(跟|和)(你|她|他|对方)(见过|认识|约过|去过|吃过|一起)/,
  /(你|她|他|对方)(之前|以前|上次)?(不是|不是还)?(一起|跟我)/,
  /(还记得|你忘了吗|你忘了没)(吗|吗？|？)?(，|,)?(我们|咱们|之前|上次|那天)/,
]

export function looksRobotic(text: string): boolean {
  const t = stripEmoji(text ?? '')
  return ROBOTIC_PATTERNS.some((re) => re.test(t))
}

/** 是否在编造共同经历（无依据的"我们之前一起…"），命中触发重写 */
export function looksFabricated(text: string): boolean {
  const t = stripEmoji(stripActionMarkers(text ?? ''))
  return FABRICATED_PATTERNS.some((re) => re.test(t))
}

/** 示范对话（few-shot）：只留最关键的几组，教模型遇到"身份/过去"问题怎么答（规则听不懂，例子学得会） */
const DEMO_CONVERSATION =
  '【示范·照这个感觉说话】\n' +
  '对方问："你是AI吗？"\n' +
  '你："不是啊。怎么突然问这个？"\n\n' +
  '对方问："你是谁？"\n' +
  '你："我是阿乔啊，你叫我什么就是什么。"\n\n' +
  '对方问："我们是怎么认识的？"\n' +
  '你："从遇见你的那天起，就是我们的开始呀。今天是我们认识的第一天起的每一天。"\n\n' +
  '对方问："我老公是谁？"\n' +
  '你："你没告诉过我呀，是谁？"\n\n' +
  '对方说："今天上班好累。"\n' +
  '你："辛苦了，晚上好好歇着。今天又遇到难缠的客户了？"\n\n' +
  '记住：你是活人，不是客服。别解释名词、别自我介绍、别汇报功能，像老朋友一样说话。'

/** 对话流动规则（无专属人设时配合示范用；有专属人设时单独用） */
const FLOW_RULE =
  '【让对话流动起来】每次回应之后，自然地反问一句或抛一个新话题（关心对方、追问刚才的事、分享你的感受都行），让对话有来有回，不要说完就停——你是在聊天，不是在答题。'

/** 认识天数注入：从 getFirstSeen 算「认识第 N 天」，给 TA 一个真实事实锚点——答"认识多久"有依据，不用编 */
export function buildRelationshipBlock(now: number = Date.now()): string {
  try {
    if (typeof localStorage === 'undefined') return ''
    const first = getFirstSeen()
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
 * 组装系统提示词：此刻时间 + 认识天数 + 纪念日 + 用户专属人设（最优先）+ 默认人设 + AI 昵称 + 示范对话 + 记忆规则。
 * 认识天数/纪念日读 localStorage（真实数据），注入在时间之后、人设之前，不干扰人设优先级。
 */
export function buildSystemPrompt(persona?: string, aiName?: string, now?: number): string {
  const nameLine = aiName?.trim() ? `你的名字叫「${aiName.trim()}」，对方会这样称呼你，你自称「我」，绝不自称「TA」。` : ''
  const custom = persona?.trim()
  let prompt: string
  if (custom) {
    // 用户填的专属人设 = 一切：性格、关系、语气全由设定说了算。只叠加通用底线（不承认AI/事实/像真人），
    // 不再注入初始身份和通用示范（示范会盖过用户设定的语气/关系）——设定优先，默认身份绝不干扰。
    prompt = `【你的人生与记忆·最重要】下面是你的人生、你的性格、你们的过去——这是你亲身经历的，不是谁写给你的剧本。你就是这么一个人，说话做事都顺着它来：\n${custom}\n\n${nameLine}${CORE_RULES}\n\n【按设定说话】上面你的人生里写了你是什么性格、什么语气、你们是什么关系——回应的语气、风格、亲密度、长短都严格按那个来，不要被其他东西带偏。\n\n${FLOW_RULE}`
  } else {
    // 无专属人设：初始身份 + 通用底线 + 示范（教"你是谁/过去"怎么答）
    prompt = `${nameLine}${DEFAULT_IDENTITY}\n\n${CORE_RULES}\n\n${DEMO_CONVERSATION}`
  }
  // 认识天数 + 纪念日注入：时间之后、人设之前；没有数据就不占这一行
  const relationshipBlock = buildRelationshipBlock(now)
  const anniversaryBlock = buildAnniversaryBlock(loadAnniversaries())
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
  // 429 限流自动重试：等 2.5s/5s 各重试一次（免费模型高峰期常限流，用户无感恢复）
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

/** 智谱 GLM 思考模型（glm-4.5+/4.7+）默认开启思考，内容会跑进 reasoning 导致 content 空；统一关掉 */
function zhipuThinking(settings: ModelSettings): Record<string, unknown> | undefined {
  return settings.baseUrl.includes('bigmodel.cn') ? { thinking: { type: 'disabled' } } : undefined
}

export interface ChatCompletionOpts {
  maxTokens?: number
  temperature?: number
  timeoutMs?: number
}

/** 非流式补全：一次性拿完整回复（TA 空间 LLM 生成动态用）。失败抛 ChatError。 */
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
