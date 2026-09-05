// TA 的空间 · LLM 人设驱动动态生成（纯逻辑核心）
// 本文件零依赖（只引用 aiSpaceCore 的类型与工具），不碰 localStorage、不发起网络请求，
// 方便被 Node 脚本直接跑单测。职责：
//   - 判断能否走 LLM 路径（有 key + 有 base_url + 有模型 + 有人设）
//   - 组装发给模型的 system / user 提示词
//   - 清洗模型返回、按关键词猜 kind、构造 SpacePost

import { pickArtVariant, type SpaceKind, type SpacePost } from './aiSpaceCore.ts'
import type { ApiMessage } from './api.ts'

/** 能走 LLM 路径所需的设置项（与 ModelSettings 结构兼容） */
export interface LlmSettings {
  apiKey: string
  baseUrl: string
  model: string
}

/** 拼 user 提示词所需的上下文 */
export interface LlmContext {
  /** TA 昵称 */
  taName: string
  /** 用户昵称（可能为默认「你」） */
  yourName: string
  /** 人设全文（非空才进 LLM 路径） */
  persona: string
  season: string
  timeWord: string
  weatherWord: string
  /** 最近聊天里对方提到的事情/话题（带「今天/8-20」时间标签，事件触发：TA 挑当天相关的呼应） */
  chatTopics?: string[]
  /** TA 最近发过的动态原文，用于防止重复/雷同 */
  recent: string[]
  /** 这条动态的日期字符串（如「8月26日」），已按该条 at 对齐（回填昨天就是昨天的日期） */
  atDateStr: string
}

/** 是否满足 LLM 路径：人设 + 服务商配置齐全 */
export function canUseLlm(persona: string, settings: LlmSettings): boolean {
  return (
    Boolean(persona?.trim()) &&
    Boolean(settings?.apiKey?.trim()) &&
    Boolean(settings?.baseUrl?.trim()) &&
    Boolean(settings?.model?.trim())
  )
}

/**
 * 组装 LLM 提示词。
 * system：TA 是人设里的角色，正在发一条自己的生活动态；纯文字，不配图（2026-09-03 七七拍板删色卡配图）；
 * user：人设全文 + TA/用户昵称 + 「这条动态的时间」（已按 at 对齐）+ 最近聊天话题（偶尔引子）+ 最近 3 条动态。
 * 素材换血（2026-09-04 七七拍板）：动态九成写 TA 自己的生活，从人设里长出来；
 * 用户话题只是偶尔引子——3~4 条里最多 1 条提到对方，且只在真的一起经历了什么时。
 */
export function buildLlmMessages(ctx: LlmContext): ApiMessage[] {
  // 2026-09-05 夜乔修：Sam 发中文动态——动态生成没跟角色语言走。英文人设 → 英文模板
  const en = /[\u4e00-\u9fff]/.test(ctx.persona ?? '') === false && /[a-zA-Z]/.test(ctx.persona ?? '')
  if (en) {
    const system =
      `You are "${ctx.taName}", a real person living your own life. Post one casual status sharing what's going on with you right now. ` +
      `1-2 short sentences, casual and warm, matching your personality. ` +
      `Vary your openings — don't reuse the same starter. ` +
      `No emoji. Never say you're an AI/assistant/model. Write like a real person's casual post, never robotic.`
    let user = `This is a post you made ${ctx.atDateStr}${ctx.timeWord} (${ctx.season}, ${ctx.weatherWord}). Write about that moment of your life.`
    user += `\n\nYour life and personality:\n${(ctx.persona ?? '').trim()}\n`
    user += `\nWrite about your own day — what you're doing, seeing, thinking, feeling. Grow it from your life and personality.`
    user += `\nThere's someone you care about named "${ctx.yourName}", but they're not your whole life: write about yourself first.`
    if (ctx.chatTopics && ctx.chatTopics.length > 0) {
      user += `\n\nThings they told you (marked "today" if said the same day as this post):\n${ctx.chatTopics.map((t) => `- ${t}`).join('\n')}\n`
      user += `\nWrite mostly about your own day. Only when you truly shared something together, mention them naturally in one line — don't make the whole post about them.`
    }
    if (ctx.recent.length > 0) {
      user += `\n\nYour recent posts:\n${ctx.recent.map((r) => `- ${r}`).join('\n')}\n`
      user += `\nDon't repeat those — write something new.`
    }
    user += `\n\nWrite the post directly, content only, no explanation.`
    return [
      { role: 'system', content: system },
      { role: 'user', content: user },
    ]
  }
  const system =
    `你是「${ctx.taName}」，一个认真生活的人。你在自己的日子里随手发一条动态，分享你此刻的生活。` +
    `要求 1-2 句话，口语化碎碎念，有温度，贴合自己的性格。` +
    `句式要多样，别老用同一种开头——禁止用「刚把」「刚刚」「今天又」「突然」这类万能开头，` +
    `像真人随手写的一样，每条动态开口都不一样（这回想天气，下回想件小事，再下回想人）。` +
    `禁止 emoji；禁止自称 AI/助手/模型；禁止出现「设定」「人设」「朋友圈」这类词。` +
    `就像真人随手写的生活，别让人看出是编排好的。`

  let user = `这是你「${ctx.atDateStr}${ctx.timeWord}」发的一条动态（${ctx.season}天，天气${ctx.weatherWord}）。写你那一刻的生活。`
  user += `\n\n你的生活与性格：\n${ctx.persona.trim()}\n`
  user += `\n写你自己的日子：你在做什么、看到什么、想到什么、心情如何——从你的生活和性格里长出来。`
  user += `\n你有一个在意的人叫「${ctx.yourName}」，但 TA 不是你的全部生活：这条动态先写你自己。`
  if (ctx.chatTopics && ctx.chatTopics.length > 0) {
    user += `\n\n你记得对方跟你提过这些事（带「今天」的是这条动态同一天说的，带日期的是那天说的）：\n${ctx.chatTopics.map((t) => `- ${t}`).join('\n')}\n`
    user += `\n大多数动态写你自己的日子就好。只有当你和对方真的共同经历了什么（比如约好这天去哪、这天一起做了什么、对方这天有大事你惦记着），才在这条里自然地提一句对方——别整条都写对方，更别复述对方原话。`
  }
  if (ctx.recent.length > 0) {
    user += `\n你最近发过的动态：\n${ctx.recent.map((r) => `- ${r}`).join('\n')}\n`
    user += `\n别和上面重复，写点新鲜的。`
  }
  user += `\n\n直接写这条新动态，只要正文，别解释。`

  return [
    { role: 'system', content: system },
    { role: 'user', content: user },
  ]
}

/** emoji / 表情符号物理删除用（提示词拦不住，硬过滤） */
const EMOJI_RE = /[\u{1F000}-\u{1FAFF}\u{2600}-\u{27BF}\u{FE0F}\u{2B00}-\u{2BFF}\u{1F1E6}-\u{1F1FF}\u{2190}-\u{21FF}\u{2B05}-\u{2B07}]/gu

/**
 * 清洗模型返回：去首尾空白、去可能自带的成对引号、过滤空串。
 * 返回 null 表示内容不可用（走降级）。
 */
export function cleanLlmText(text: string): string | null {
  let t = String(text ?? '').trim()
  if (!t) return null
  // 硬过滤：删掉所有 emoji / 表情符号（提示词拦不住，物理删）
  t = t.replace(EMOJI_RE, '')
  const pairs: Array<[string, string]> = [
    ['"', '"'],
    ['“', '”'],
    ['「', '」'],
    ["'", "'"],
    ['‘', '’'],
  ]
  for (const [open, close] of pairs) {
    if (t.startsWith(open) && t.endsWith(close)) {
      t = t.slice(1, -1).trim()
      break
    }
  }
  if (!t) return null
  return t
}

/** 关键词猜 kind 的规则（按优先级：想你 → 钻研 → 天气 → 小确幸 → 心情 → 日常） */
const KIND_RULES: Array<[SpaceKind, string[]]> = [
  ['想你', ['想你', '想', '念']],
  ['钻研', ['表格', '文件', '代码', '研究', '整理']],
  ['天气', ['天气', '雨', '晴', '风']],
  ['小确幸', ['开心', '幸福', '好看', '猫', '面包']],
  ['心情', ['难过', '乱', '发呆']],
]

/** 用关键词猜动态分类，猜不出默认「日常」 */
export function guessKind(text: string): SpaceKind {
  const t = String(text ?? '')
  for (const [kind, keywords] of KIND_RULES) {
    for (const kw of keywords) {
      if (t.includes(kw)) return kind
    }
  }
  return '日常'
}

/** 由清洗后的 LLM 文案构造一条动态（id / 时间戳 / kind / 插画变体都定好） */
export function buildLlmPost(
  text: string,
  at: number,
  kind: SpaceKind,
  rand: () => number = Math.random,
): SpacePost {
  const id = `p${at.toString(36)}${Math.floor(rand() * 1e6).toString(36)}`
  return { id, at, kind, text, art: pickArtVariant(kind, rand) }
}

/**
 * 从模型返回里拆出「[配图] 描述」标记（TASK_UI_BATCH2 配图）：
 * 返回 { text: 去掉标记后的正文, caption: 配图描述或 null }。
 * 模型没配图时 caption 为 null，正文原样。
 */
export function extractImageCaption(text: string): { text: string; caption: string | null } {
  const t = String(text ?? '')
  const m = t.match(/\[配图\]\s*[:：]?\s*([^\n]*)/)
  if (m) {
    let caption = (m[1] ?? '').trim().replace(EMOJI_RE, '')
    if (caption.length > 20) caption = `${caption.slice(0, 20)}…`
    const body = t.replace(/\[配图\]\s*[:：]?\s*[^\n]*/, '').trim()
    return { text: body, caption: caption || null }
  }
  return { text: t, caption: null }
}

/* ---- TASK_UI_BATCH2 评论回复（LLM 按人设 + 动态内容回，最多 1 条） ---- */

/** 拼评论回复提示词所需的上下文 */
export interface ReplyContext {
  /** TA 昵称 */
  taName: string
  /** 用户昵称 */
  yourName: string
  /** 人设全文 */
  persona: string
  /** 被评论的那条动态原文 */
  postText: string
  /** 用户这条留言 */
  commentText: string
}

/**
 * 组装「TA 回复评论」的提示词。
 * system：按人设里的角色自然回一句，回完就收住，不把聊天续起来；
 * user：人设 + 动态原文 + 留言，直接写回复正文。
 */
export function buildReplyMessages(ctx: ReplyContext): ApiMessage[] {
  // 2026-09-05 夜乔修：英文人设的角色，评论回复也用英文
  const en = /[\u4e00-\u9fff]/.test(ctx.persona ?? '') === false && /[a-zA-Z]/.test(ctx.persona ?? '')
  if (en) {
    const system =
      `You are "${ctx.taName}" and they just left a comment on one of your posts. ` +
      `Reply back briefly like a real person (1-2 short sentences, casual, warm, in character and on-topic). ` +
      `Keep it short — don't ask questions to drag the conversation on. ` +
      `No emoji. Never say you're an AI/assistant/model.`
    const user =
      `Your personality:\n${ctx.persona.trim()}\n\n` +
      `Your post:\n${ctx.postText}\n\n` +
      `Their comment:\n${ctx.commentText}\n\n` +
      `Write your reply directly, content only.`
    return [
      { role: 'system', content: system },
      { role: 'user', content: user },
    ]
  }
  const system =
    `你是「${ctx.taName}」，对方刚在你的一条生活动态下留言了。` +
    `像真人一样简短地回一句（一两句话，口语化、有温度，贴合自己的性格和那条动态）。` +
    `回完就收住，不要反问回去把聊天续起来。` +
    `禁止 emoji；禁止自称 AI/助手/模型；禁止出现「设定」「人设」这类词。`

  const user =
    `你的性格：\n${ctx.persona.trim()}\n\n` +
    `你发的这条动态：\n${ctx.postText}\n\n` +
    `对方留言：\n${ctx.commentText}\n\n` +
    `直接写你的回复，只要正文。`

  return [
    { role: 'system', content: system },
    { role: 'user', content: user },
  ]
}
