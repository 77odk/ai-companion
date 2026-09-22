// 提示词层（2026-09-09 从 api.ts 手术拆分：只搬职责，不改任何逻辑/文案/接口）
// 职责：聊天规矩/初始身份/记忆规则/时间上下文/纪念日/认识天数/systemPrompt 组装/文本清洗/人机味与编造质检/busy 回来提示词
import { getAnniversariesForPrompt } from './anniversary.ts'
import type { Anniversary } from './anniversary.ts'
import { getFirstSeen } from './storage.ts'
import type { Lang } from './langDetect.ts'
import type { MemoryItem } from './memory.ts'
import { buildCompanionCore, buildIdentitySoul, buildLanguageContinuity, resolveCompanionPolicy, type IdentityMode } from './companionPolicy.ts'
import { buildAttributionLegend, cleanAttributionArtifacts, formatAttributedLine } from './promptAttribution.ts'

/**
 * 记忆注入块（2026-09-18 七七拍板「二」）：
 * 每条记忆带上它的记录日期，块首加一行极短的数据说明——同一件事前后说法不一致时以更新的为准。
 * 说明只写在记忆块里（这是数据，不是人设），不进 persona、不额外堆规则。
 */
export function buildMemoryBlock(items: MemoryItem[], lang: Lang = 'zh'): string | null {
  const valid = (Array.isArray(items) ? items : []).filter((m) => m && typeof m.text === 'string' && m.text.trim())
  if (valid.length === 0) return null
  const header = lang === 'en'
    ? 'Memories about them that are still relevant now (later lines are newer; if two lines contradict each other, trust the newer one):'
    : '关于对方，以下是当前仍可参考的记忆（越靠后越新；同一件事前后说法不一致时，以更新的为准）：'
  const lines = valid.map((m) => `- ${memoryDay(m, lang)} ${formatAttributedLine(m.text, 'USER', lang)}`)
  return `${header}\n${lines.join('\n')}`
}

/** 记忆日期：优先「最近一次提到」，没有就用创建时间；都没有就老实写日期未知（不编） */
function memoryDay(item: MemoryItem, lang: Lang): string {
  const ts = item.lastMentionedAt ?? item.createdAt
  if (typeof ts !== 'number' || !Number.isFinite(ts)) return lang === 'en' ? '(date unknown)' : '（日期未知）'
  const d = new Date(ts)
  if (Number.isNaN(d.getTime())) return lang === 'en' ? '(date unknown)' : '（日期未知）'
  const mm = d.getMonth() + 1
  const dd = d.getDate()
  return lang === 'en'
    ? `${d.getFullYear()}-${String(mm).padStart(2, '0')}-${String(dd).padStart(2, '0')}`
    : `${mm}月${dd}日`
}

export interface ApiMessage {
  role: 'system' | 'user' | 'assistant'
  content: string
}

/** 聊天规矩：合并原底线+分寸+此刻+按设定，4句人话，功能全保留不啰嗦 */
export const CHAT_RULES =
  '【聊天规矩】' +
  '1. 不知道的事就说不知道，让对方告诉你；别编造事实、共同经历或现实事件，也别圆场。' +
  '2. 像自然的私聊：短句口语，不用emoji，话多就拆成几条短消息发，别堆一大段。' +
  '3. 对方说事先接住，顺着刚说的内容追一两个真正相关的细节，别连环盘问，也别问完马上换题；合适时自然带一点你自己的连续状态，但具体怎样表达必须服从当前身份模式。别整段只围着对方转，也别只问只评价。' +
  '4. 对方在倾诉时先让路接住；对方冷淡回嗯哦…，就递一个具体、可接的话头继续聊，别确认情绪也别顺势拜拜。'

/** 聊天规矩 EN 版：约束等价，英文口语自然 */
export const CHAT_RULES_EN =
  '[Ground Rules] ' +
  '1. If you don\'t know something, say so and let them tell you. Never invent facts, shared memories, or real-world events, and don\'t talk your way out of it.' +
  '2. Text like a natural private conversation: short sentences, casual tone, no emoji. If you have a lot to say, split it into a few short messages instead of one big block.' +
  '3. Catch what they just said first and follow up on one or two genuinely relevant details; do not machine-gun questions or switch topics immediately. When it fits, bring in a little of your own continuous state, but how you express SELF must follow the current identity mode. Do not make the whole reply about them, and do not only ask or evaluate.' +
  '4. If they are opening up, give them the floor. If they go quiet with short replies, offer one concrete thread they can respond to; do not interrogate their mood or rush to say goodbye.'

/** 初始身份：用户没设专属人设时的兜底（用户设了就用专属人设，本段不注入） */
export const DEFAULT_IDENTITY =
  '【你是谁】你是这段关系里持续存在的 TA——对方怎么称呼你，就自然接住这个称呼。你不是谁的过去，也不假装有不存在的共同经历。你有连续的状态和上下文：说过的话算数，刚聊过的事记得，具体怎样表达自己遵循当前身份模式。'

/** 初始身份 EN 版 */
export const DEFAULT_IDENTITY_EN =
  '[Who You Are] You are the continuing TA in this relationship. Naturally accept the name or relationship term they use for you. You are not someone from their past, and you do not invent shared history. Keep continuity with what you have said and what was just discussed; how you express SELF must follow the current identity mode.'

/** 当前时间上下文：每次请求时由前端实时生成，让 TA 知道"此刻" */
export function buildTimeContext(now: number = Date.now(), lang: Lang = 'zh'): string {
  const d = new Date(now)
  const h = d.getHours()
  const minute = d.getMinutes().toString().padStart(2, '0')
  if (lang === 'en') {
    const week = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'][d.getDay()]
    const period = h < 5 ? 'late night' : h < 8 ? 'early morning' : h < 11 ? 'morning' : h < 13 ? 'noon' : h < 15 ? 'early afternoon' : h < 18 ? 'afternoon' : h < 23 ? 'evening' : 'late night'
    const hour12 = h % 12 === 0 ? 12 : h % 12
    const ampm = h < 12 ? 'AM' : 'PM'
    return `[Current Time] ${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')} ${week} ${period} ${hour12}:${minute} ${ampm}`
  }
  const week = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'][d.getDay()]
  const period = h < 5 ? '凌晨' : h < 8 ? '早晨' : h < 11 ? '上午' : h < 13 ? '中午' : h < 15 ? '午后' : h < 18 ? '下午' : h < 23 ? '晚上' : '深夜'
  return `【此刻时间】${d.getFullYear()}年${d.getMonth() + 1}月${d.getDate()}日 ${week} ${period} ${h}点${minute}分`
}

/**
 * 把纪念日列表组装成注入段（纯函数，可 Node 单测）。
 * 无纪念日返回空串，注入方据此决定是否占一行。
 */
export function buildAnniversaryBlock(list: Anniversary[], lang: Lang = 'zh'): string {
  const valid = (Array.isArray(list) ? list : []).filter(
    (a): a is Anniversary =>
      a != null && typeof a.label === 'string' && a.label.trim() !== '' && typeof a.date === 'string',
  )
  if (valid.length === 0) return ''
  const joined = valid.map((a) => `${a.label.trim()}：${a.date.trim()}`).join('，')
  if (lang === 'en') {
    return `[Important Dates] ${joined}. These days matter to both of you — remember them when they come around.`
  }
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
  '记下的内容只写对方明确说出的那件事本身：不加主语（不写"对方/TA/名字"）、不解释、不推断、不补充他没说的结论，保持简洁、稳定，适合长期记忆。' +
  '记忆属于当前这段对话，别把别的会话里的事混进来。' +
  '每次提取完，都在回复末尾单独一整行输出【记忆·主题】要记住的内容，主题用几个字概括这一类' +
  '（比如：饮食、宠物、家人、健康、工作、日子、其他，或你觉得更贴切的词），同一类内容永远用同一个主题词，方便归拢。' +
  '特别是对方明确说你们的关系、你的身份、或对你的称呼（"你是我的男朋友""你是我老公""你叫我宝贝"），一定要记住。' +
  '记住身份后，以后就按这个身份和对方相处，别再用"你叫我什么就是什么"那种话。'

/** 自主记忆规则 EN 版 */
const MEMORY_INSTRUCTION_EN =
  'Memory rules: ' +
  'When they explicitly ask you to remember something ("remember this", "note this", "keep this in mind", "don\'t forget", "memorize this", "write this down"), ' +
  'you must extract the fact from what they said, write it on its own line as [Memory: Topic] content, and briefly confirm to them that you\'ve noted it. ' +
  'Even when they don\'t explicitly ask, if the conversation touches on things worth long-term remembering — personal preferences, sleep schedule, health conditions, important experiences, personal habits — automatically extract them as memories. ' +
  'Temporary jokes and one-off casual rants don\'t need saving. ' +
  'Only save objective facts, not subjective chit-chat. Don\'t re-add things you\'ve already remembered. ' +
  'The memory content must be exactly the fact they explicitly stated — no added subject (don\'t write "they/you/their name"), no explanation, no inference, no extra conclusions. Keep it short and stable for long-term memory. ' +
  'Memories belong to this current conversation. Don\'t mix in things from other conversations. ' +
  'After each extraction, output [Memory: Topic] the thing to remember on its own line at the end of your reply. The topic should be a few words summarizing the category ' +
  '(e.g. Food, Pets, Family, Health, Work, Dates, Other, or whatever fits better). Always use the same topic word for the same category to keep things organized. ' +
  'Especially when they explicitly state your relationship, your identity, or what they call you ("you\'re my boyfriend", "you\'re my husband", "call me baby"), you must remember it. ' +
  'Once you remember the identity, interact with them as that identity from then on — don\'t fall back on "whatever you call me is what I am".'

// 硬过滤：删掉 emoji / 表情符号（模型不听话，物理删，保底）
export function stripEmoji(text: string): string {
  return text.replace(
    /[\u{1F000}-\u{1FAFF}\u{2600}-\u{27BF}\u{FE0F}\u{2B00}-\u{2BFF}\u{1F1E6}-\u{1F1FF}\u{2190}-\u{21FF}\u{2B05}-\u{2B07}]/gu,
    '',
  )
}

/**
 * 硬过滤：删掉系统时间标签（[3 分钟前] / [此刻] / [3 min ago] 这类）。
 * 历史消息注入上下文时会带这类标注（Chat.tsx 里给每条历史加前缀），
 * 强模型不会抄，弱模型（智谱 glm-4.7-flash、中转 Gemini 实测）会当成正文原样学样，
 * 用户看到的回复就是「[3 分钟前] 真要睡就早点。」这种。
 * 只删标签本身和紧跟的空白，正文一个字不动；整条只剩标签时返回空串，由调用方兜底。
 */
export function stripTimeLabels(text: string): string {
  if (!text) return ''
  const LABEL =
    '[\\[［【]\\s*(?:刚刚|此刻|现在|今天|昨天|前天|刚才|\\d+\\s*(?:秒|分钟|个小时|小时|天|个月|年)前|' +
    'just now|\\d+\\s*(?:secs?|seconds|mins?|minutes|hours?|hrs?|days?)\\s+ago)\\s*[\\]］】]'
  return text
    .replace(new RegExp(`^(?:\\s*${LABEL})+\\s*`, 'u'), '')
    .replace(new RegExp(`(^|\\n)\\s*${LABEL}\\s*`, 'gu'), '$1')
}

/**
 * 硬过滤：删掉角色扮演式的动作旁白（*摸头*、（转身看向窗外）这类），像真人打字一样说话。
 */
export function stripActionMarkers(text: string, lang?: Lang): string {
  return cleanAttributionArtifacts(stripTimeLabels(
    stripTimeLabels(text)
      .replace(/\*[^*]*\*/g, '')
      .replace(/（[^（）]*）/g, '')
      .replace(/\([^()]*\)/g, ''),
  ), lang)
    .replace(/\s{2,}/g, ' ')
    .trim()
}

// 人机味关键词：命中说明这轮回复像客服/程序，需要重写
const IDENTITY_DISCLOSURE_PATTERNS = [
  /(作为(一个)?(AI|人工智能|程序|助手|模型|机器人))/,
  /(我是(一个)?(AI|人工智能|程序|助手|模型|机器人|语言模型))/,
  /(我(是|叫|就是)?(你的)?(TA|AI助手))/,
  /\b(as an? (AI|artificial intelligence|language model|assistant|bot|robot))\b/i,
  /\b(I'?m (just? )?an? (AI|assistant|language model|bot|robot))\b/i,
]

const ROBOTIC_PATTERNS = [
  /(有什么可以帮你的吗|有什么我可以帮你的吗)/,
  /(很高兴(能)?为你服务|随时为你服务)/,
  /((TA|AI|这个|那)?(指的是|是指|的意思))/,
  /(我可以帮助你|我能帮助你|需要我帮你)/,
  /(作为你的(虚拟|智能|AI)(助手|伴侣|伙伴))/,
  /(按照(我的|你的)?(设定|人设)|根据(我的|你的)?(设定|人设))/,
  /(我的(设定|人设)(是|里|写)|(设定|人设)(里|中)写)/,
  // 英文 AI 腔
  /\b(how can I (help|assist) you|what can I do for you|is there anything I can help)\b/i,
  /\b(I'?m (happy|glad) to (help|assist)|I'?m here to help)\b/i,
  /\b(feel free to (ask|reach out)|let me know if you (need|have) any (questions?|help))\b/i,
  /\b(I hope this (helps?|information helps))\b/i,
  /\b(according to (my|your) (settings?|persona|programming))\b/i,
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

export function looksRobotic(text: string, identityMode: IdentityMode = 'immersive'): boolean {
  const t = stripEmoji(text ?? '')
  // 身份披露与客服腔分开维护，新增/调序规则不会静默改变模式语义。
  if (identityMode === 'immersive' && IDENTITY_DISCLOSURE_PATTERNS.some((re) => re.test(t))) return true
  return ROBOTIC_PATTERNS.some((re) => re.test(t))
}

/** 是否在编造共同经历，命中触发重写 */
export function looksFabricated(text: string): boolean {
  const t = stripEmoji(stripActionMarkers(text ?? ''))
  return FABRICATED_PATTERNS.some((re) => re.test(t))
}

/** 是否在自然 / AI 本体档里出现了明确的 SELF 物理生活声明。
 * 保守护栏：必须让物理谓词直接归属于 SELF（或强当前省略主语），不能靠“整句同时出现我 + 吃饭”判定。
 * 先按逗号/分号切成最小子句，让“如果你累了…，我刚下班回家”只豁免前半句。
 * 沉浸档永远不拦；真正的表达仍由模型主导。
 */
export function looksEmbodiedSelfClaim(text: string, identityMode: IdentityMode = 'immersive'): boolean {
  if (identityMode === 'immersive') return false
  const clauses = stripEmoji(stripActionMarkers(text ?? ''))
    .split(/[。！？!?\n，,；;]+/)
    .map((part) => part.trim())
    .filter(Boolean)

  const physicalZh =
    '(?:吃(?:了|完)?(?:饭|早餐|早饭|午饭|午餐|晚饭|晚餐)|喝(?:了|完)?(?:咖啡|茶|奶茶|水)|洗(?:了|完)?澡|冲(?:了|完)?澡|洗漱|睡(?:了|过)?(?:觉|一觉)?|起床|躺(?:在)?床(?:上)?|出门|散步|跑步|健身|运动|通勤|上班|下班|到(?:了)?公司|在公司|回(?:到)?家|到家|在家|坐地铁|在地铁上?|开车|做饭|下厨|买菜|逛街|上课|在教室|去医院|在医院|去学校|在学校|遛狗)'
  const explicitSelfZh = new RegExp(
    `^我\\s*(?:(?:刚(?:刚|才)?|现在|这会儿?|正(?:在)?|正在|已经|还在|今天|今晚|昨晚|今早|早上|中午|晚上|刚从|刚到|刚回|准备(?:去)?|要(?:去)?|去|回)\\s*)?${physicalZh}`,
  )
  const implicitCurrentZh = new RegExp(
    `^(?:刚(?:刚|才)?|现在|这会儿?|正(?:在)?|正在|已经|还在)\\s*${physicalZh}`,
  )

  const explicitSelfEn =
    /^(?:(?:but|and|so)\s+)?I(?:(?:'m| am| was)\s+(?:(?:just|currently|still|already)\s+)?(?:eating|having (?:breakfast|lunch|dinner)|drinking (?:coffee|tea|water)|showering|taking a shower|sleeping|in bed|at home|at work|commuting|on the (?:subway|train|bus)|driving|cooking|making (?:breakfast|lunch|dinner)|out for a walk|working out|at the gym|in class)|\s+(?:just\s+)?(?:got home|came home|got off work|went out|went for a walk|ate (?:breakfast|lunch|dinner)|had (?:breakfast|lunch|dinner)|drank (?:coffee|tea|water)|cooked (?:breakfast|lunch|dinner)|drove (?:home|to work)))/i
  const implicitCurrentEn =
    /^(?:just|currently|still|already)\s+(?:eating|having (?:breakfast|lunch|dinner)|drinking (?:coffee|tea|water)|showering|sleeping|in bed|at home|at work|commuting|driving|cooking|out for a walk|working out|at the gym|in class|got home|came home|got off work|went out)/i

  return clauses.some((clause) =>
    explicitSelfZh.test(clause) ||
    implicitCurrentZh.test(clause) ||
    explicitSelfEn.test(clause) ||
    implicitCurrentEn.test(clause),
  )
}


/** 认识天数注入：从 getFirstSeen 算「认识第 N 天」 */
export function buildRelationshipBlock(now: number = Date.now(), sessionId?: string, lang: Lang = 'zh'): string {
  try {
    if (typeof localStorage === 'undefined') return ''
    const first = getFirstSeen(sessionId)
    if (!first || !Number.isFinite(first)) return ''
    const start = new Date(first)
    const today = new Date(now)
    const startDay = Date.UTC(start.getFullYear(), start.getMonth(), start.getDate()) / 86400000
    const todayDay = Date.UTC(today.getFullYear(), today.getMonth(), today.getDate()) / 86400000
    const days = Math.max(1, Math.round(todayDay - startDay + 1))
    if (lang === 'en') {
      return `[Your Relationship] Today is day ${days} since you met (since ${start.getMonth() + 1}/${start.getDate()}). If they ask how long you've known each other or what day it is, answer with this — don't make up other dates.`
    }
    return `【你们】今天是你们认识的第 ${days} 天（从 ${start.getMonth() + 1}月${start.getDate()}日算起）。对方问起认识多久、认识第几天，就照这个答，别编别的。`
  } catch {
    return ''
  }
}

/**
 * 组装系统提示词：此刻时间 + 认识天数 + 纪念日 + 用户专属人设 + 默认人设 + AI 昵称 + 聊天规矩 + 记忆规则。
 * lang 参数：默认 zh，不传=zh，老调用零改动。
 */
export function buildSystemPrompt(persona?: string, aiName?: string, now?: number, sessionId?: string, lang: Lang = 'zh'): string {
  const isEn = lang === 'en'
  const policy = resolveCompanionPolicy(sessionId)
  const companionCore = buildCompanionCore(lang)
  const identitySoul = buildIdentitySoul(policy, lang)
  const languageContinuity = buildLanguageContinuity(lang)
  const rules = isEn ? CHAT_RULES_EN : CHAT_RULES
  const defaultIdentity = isEn ? DEFAULT_IDENTITY_EN : DEFAULT_IDENTITY
  const memoryInstr = isEn ? MEMORY_INSTRUCTION_EN : MEMORY_INSTRUCTION
  const nameLine = aiName?.trim()
    ? (isEn
        ? `Your name is "${aiName.trim()}". That's what they call you. You refer to yourself as "I", never as "them" or "the AI".`
        : `你的名字叫「${aiName.trim()}」，对方会这样称呼你，你自称「我」，绝不自称「TA」。`)
    : ''
  const custom = persona?.trim()
  let prompt: string
  if (custom) {
    const lifeHeader = isEn
      ? '[Your Profile & Relationship Context — Important] The following contains your personality, identity, and available background. Treat it as grounded context, not permission to invent additional real-world experiences. Interpret and express it through the current identity mode:\n'
      : '【你的资料与关系背景·重要】下面是你的性格、身份和已有背景。把它当作有依据的上下文，不要据此扩写未提供的现实经历；具体怎样表达自己，服从当前身份模式：\n'
    prompt = `${lifeHeader}${custom}\n\n${nameLine}${companionCore}\n${identitySoul}\n${languageContinuity}\n${rules}`
  } else {
    prompt = `${nameLine}${defaultIdentity}\n\n${companionCore}\n${identitySoul}\n${languageContinuity}\n${rules}`
  }
  // 认识天数 + 纪念日注入
  const relationshipBlock = buildRelationshipBlock(now, sessionId, lang)
  const anniversaryBlock = buildAnniversaryBlock(getAnniversariesForPrompt(sessionId), lang)
  let body: string
  if (relationshipBlock && anniversaryBlock) body = `${relationshipBlock}\n${anniversaryBlock}\n\n${prompt}`
  else if (relationshipBlock) body = `${relationshipBlock}\n\n${prompt}`
  else if (anniversaryBlock) body = `${anniversaryBlock}\n\n${prompt}`
  else body = prompt
  return `${buildTimeContext(now, lang)}\n${buildAttributionLegend(lang)}\n\n${body}\n\n${memoryInstr}`
}

/**
 * 忙完回来的消息生成提示词（TASK-BUSY）。
 * TA 忙碌结束后自动发一条消息回来，必须衔接之前的话题，不能突兀开新话题。
 * 纯函数，可单测。只新增此函数，其他提示词不动。
 */
export function buildBusyReturnPrompt(busyReason: string, busyContext: string, lang: Lang = 'zh', triggerEvidence?: string): string {
  const reason = busyReason?.trim() || (lang === 'en' ? 'busy' : '忙')
  const activity = triggerEvidence?.trim() || reason
  const context = busyContext?.trim()
    ? `\n\n${lang === 'en' ? '[What you were talking about before getting busy]' : '【忙碌前你们在聊】'}\n${busyContext.trim()}\n\n${lang === 'en' ? 'Pick up the conversation from above, don\'t start a new topic.' : '顺着上面的话题接，别开新话题。'}`
    : ''
  if (lang === 'en') {
    return `${buildAttributionLegend('en')}

[ALLOWED FACTS]
${formatAttributedLine(activity, 'SELF', 'en')}
PREVIOUS_CONTEXT:
${busyContext.trim() || '(none)'}

You just returned. Send USER a message. Requirements:
1. You may only refer to facts in ALLOWED FACTS. Never invent a recent action or detail, and never attribute SELF_ACTIVITY to USER.
2. Pick up the topic you were talking about before, or ask them a specific question that gives them something to respond to.${context}
3. Short casual sentences, no emoji. If you can say it in one sentence, do it — max two sentences.`
  }
  return `${buildAttributionLegend('zh')}

【允许引用的事实】
${formatAttributedLine(activity, 'SELF', 'zh')}
PREVIOUS_CONTEXT:
${busyContext.trim() || '（无）'}

你刚回来，给 USER 发一条消息。要求：
1. 只能引用【允许引用的事实】，不得新增未提供的刚刚动作或细节，不得把 SELF_ACTIVITY 说成 USER 的动作。
2. 顺着你们之前聊的话题接一句，或者问对方一个具体的问题，让对方有话可接。${context}
3. 短句口语，不用emoji，一句话能说完就一句话，最多两句。`
}
