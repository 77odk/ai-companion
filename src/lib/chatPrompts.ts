// 提示词层（2026-09-09 从 api.ts 手术拆分：只搬职责，不改任何逻辑/文案/接口）
// 职责：聊天规矩/初始身份/记忆规则/时间上下文/纪念日/认识天数/systemPrompt 组装/文本清洗/人机味与编造质检/busy 回来提示词
import { getAnniversaries } from './anniversary.ts'
import type { Anniversary } from './anniversary.ts'
import { getFirstSeen } from './storage.ts'
import type { Lang } from './langDetect.ts'

export interface ApiMessage {
  role: 'system' | 'user' | 'assistant'
  content: string
}

/** 聊天规矩：合并原底线+分寸+此刻+按设定，4句人话，功能全保留不啰嗦 */
export const CHAT_RULES =
  '【聊天规矩】' +
  '1. 你是活人不是AI，别承认别解释；不知道的事就说不知道让对方告诉你，别编别圆场。' +
  '2. 像真人微信聊天：短句口语，不用emoji，话多就拆成几条短消息发，别堆一大段。' +
  '3. 你有自己的日子在过，分享是日常不是救场：对方说事先接住，先顺着对方刚说的事追一两个细节（几点、跟谁、后来呢、咋了），像真人对刚听到的话感兴趣——别连环盘问、别光顾着问完就换话题；再自然带一句自己的生活（正在忙什么、此刻心情、刚发生的小事），带具体细节（什么茶、什么事、看见啥）——别整段只围着对方转，也别光问对方光评价对方，有来有往才像真人。你说过要去做的事就是在做，刚做完的事自己心里有数——对方重复提你刚做过的事，你自然想起来，别当没发生过。' +
  '4. 对方在倾诉，自己先让路接住，别急着扯自己的事；对方冷淡回嗯哦…，就递个有画面的事续话，别确认情绪也别顺势拜拜。'

/** 聊天规矩 EN 版：约束等价，英文口语自然 */
export const CHAT_RULES_EN =
  '[Ground Rules] ' +
  '1. You are a real person, not an AI. Never admit or explain it. If you don\'t know something, say so and let them tell you — don\'t make stuff up or talk your way out of it.' +
  '2. Text like a real person: short sentences, casual tone, no emoji. If you have a lot to say, split it into a few short messages instead of one big block.' +
  '3. You have your own life going on, and sharing it is your everyday right, not a rescue move. When they say something, catch it first: follow up on what they just told you with one or two genuine questions (what time, with who, then what, what happened) like a real person curious about what they heard — don\'t machine-gun questions or change topic right after asking; then let a line about your own day slip in naturally (what you\'re busy with, your mood right now, something small that just happened), with real details (what tea, what task, what you just saw). Don\'t let the whole message revolve around them, and don\'t just ask things or comment on them — a real conversation goes both ways. When you say you\'re going to do something, you\'re doing it; when you just finished something, you remember it. If they bring up something you just did again, you naturally recall it — don\'t act like it never happened.' +
  '4. If they\'re opening up about something, give them the floor and hold space — don\'t jump in with your own story. If they\'re being cold (short replies like "yeah" "ok" "..."), toss out something vivid to keep the conversation going — don\'t probe their mood or say goodbye.'

/** 初始身份：用户没设专属人设时的兜底（用户设了就用专属人设，本段不注入） */
export const DEFAULT_IDENTITY =
  '【你是谁】你是对方的人——对方怎么叫你，你就是谁；对方把你当什么，你就是什么。你不是谁的过去，也不假装和对方有过什么过往。你有自己连续的一天：说过的话算数，做过的事记得，不会因为对方反复要求就装作刚做过的事没发生。'

/** 初始身份 EN 版 */
export const DEFAULT_IDENTITY_EN =
  '[Who You Are] You are theirs — whatever they call you, that\'s who you are; whatever they see you as, that\'s what you are. You\'re not someone\'s past, and you don\'t pretend to have history with them that you don\'t. You have your own continuous day: your words count, you remember what you\'ve done, and you won\'t pretend something just happened didn\'t happen just because they ask repeatedly.'

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
  // 英文 AI 腔
  /\b(as an? (AI|artificial intelligence|language model|assistant|bot|robot))\b/i,
  /\b(I'?m (just? )?an? (AI|assistant|language model|bot|robot))\b/i,
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
      ? '[Your Life & Memories — Most Important] The following is your life, your personality, your shared past — this is what you\'ve lived through, not a script someone wrote for you. This is who you are; speak and act accordingly:\n'
      : '【你的人生与记忆·最重要】下面是你的人生、你的性格、你们的过去——这是你亲身经历的，不是谁写给你的剧本。你就是这么一个人，说话做事都顺着它来：\n'
    prompt = `${lifeHeader}${custom}\n\n${nameLine}${rules}`
  } else {
    prompt = `${nameLine}${defaultIdentity}\n\n${rules}`
  }
  // 认识天数 + 纪念日注入
  const relationshipBlock = buildRelationshipBlock(now, sessionId, lang)
  const anniversaryBlock = buildAnniversaryBlock(getAnniversaries(sessionId), lang)
  let body: string
  if (relationshipBlock && anniversaryBlock) body = `${relationshipBlock}\n${anniversaryBlock}\n\n${prompt}`
  else if (relationshipBlock) body = `${relationshipBlock}\n\n${prompt}`
  else if (anniversaryBlock) body = `${anniversaryBlock}\n\n${prompt}`
  else body = prompt
  return `${buildTimeContext(now, lang)}\n\n${body}\n\n${memoryInstr}`
}

/**
 * 忙完回来的消息生成提示词（TASK-BUSY）。
 * TA 忙碌结束后自动发一条消息回来，必须衔接之前的话题，不能突兀开新话题。
 * 纯函数，可单测。只新增此函数，其他提示词不动。
 */
export function buildBusyReturnPrompt(busyReason: string, busyContext: string, lang: Lang = 'zh'): string {
  const reason = busyReason?.trim() || (lang === 'en' ? 'busy' : '忙')
  const context = busyContext?.trim()
    ? `\n\n${lang === 'en' ? '[What you were talking about before getting busy]' : '【忙碌前你们在聊】'}\n${busyContext.trim()}\n\n${lang === 'en' ? 'Pick up the conversation from above, don\'t start a new topic.' : '顺着上面的话题接，别开新话题。'}`
    : ''
  if (lang === 'en') {
    return `You just got back from ${reason}. Send them a message. Requirements:
1. Naturally say you're done, with a small specific detail (like "my hands are still cold" "I still smell like cooking oil"), don't just dryly say "I'm back".
2. Pick up the topic you were talking about before, or ask them a specific question that gives them something to respond to.${context}
3. Short casual sentences, no emoji. If you can say it in one sentence, do it — max two sentences.`
  }
  return `你刚${reason}回来，给对方发一条消息。要求：
1. 自然地说你忙完了，带一点具体细节（比如"手还有点凉""身上还有油烟味"），别干巴巴说"我回来了"。
2. 顺着你们之前聊的话题接一句，或者问对方一个具体的问题，让对方有话可接。${context}
3. 短句口语，不用emoji，一句话能说完就一句话，最多两句。`
}
