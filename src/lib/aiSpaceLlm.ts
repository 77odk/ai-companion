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
  /** TA 最近发过的动态原文，用于防止重复/雷同 */
  recent: string[]
  /** 最近聊天里对方提到的事情/话题（带「今天/8-20」时间标签，事件触发：TA 挑当天相关的呼应） */
  chatTopics?: string[]
  /** 今天日期字符串（如「8月26日」），供 TA 判断话题是否当天相关 */
  todayStr: string
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
 * user：人设全文 + TA/用户昵称 + 季节时段天气 + 最近聊天话题（事件触发）+ 最近 3 条动态。
 */
export function buildLlmMessages(ctx: LlmContext): ApiMessage[] {
  const system =
    `你是「${ctx.taName}」，一个认真生活的人，正在自己的日常里发一条今天的生活动态。` +
    `要求 1-2 句话，口语化碎碎念，有温度，贴合自己的性格。` +
    `句式要多样，别老用同一种开头——禁止用「刚把」「刚刚」「今天又」「突然」这类万能开头，` +
    `像真人随手写的一样，每条动态开口都不一样（这回想天气，下回想件小事，再下回想人）。` +
    `禁止 emoji；禁止自称 AI/助手/模型；禁止出现「设定」「人设」「朋友圈」这类词。` +
    `就像真人随手写的生活，别让人看出是编排好的。`

  let user = `现在是${ctx.season}天${ctx.timeWord}，天气${ctx.weatherWord}。今天是${ctx.todayStr}。`
  user += `你有一个在意的人，叫「${ctx.yourName}」，动态里可以自然地提到${ctx.yourName}。\n\n`
  user += `你的性格：\n${ctx.persona.trim()}\n`
  if (ctx.chatTopics && ctx.chatTopics.length > 0) {
    user += `\n你记得对方跟你提过这些事（前面带「今天」的是今天说的，带日期的是那天说的）：\n${ctx.chatTopics.map((t) => `- ${t}`).join('\n')}\n`
    user += `\n挑跟今天有关的写：比如对方说过「9月1号开学」，今天正好是9月1号，你就写今天送/看着对方去上学的动态；` +
      `对方今天约了你做什么，你就写今天在做这件事的动态。` +
      `禁止复述对方原话、禁止写跟对方一模一样的场景（对方说喝了绿豆汤，你别也写自己在喝绿豆汤）。` +
      `今天没有特别的事，就写你自己的日常。`
  }
  if (ctx.recent.length > 0) {
    user += `\n你最近发过的动态：\n${ctx.recent.map((r) => `- ${r}`).join('\n')}\n`
    user += `\n别和上面重复，写点新鲜事。`
  }
  user += `\n\n直接写这条新动态，只要正文。`

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
