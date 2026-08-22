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
 * system：TA 是人设里的角色，正在发一条自己的生活动态；
 * user：人设全文 + TA/用户昵称 + 季节时段天气 + 最近 3 条动态。
 */
export function buildLlmMessages(ctx: LlmContext): ApiMessage[] {
  const system =
    `你是「${ctx.taName}」，一个认真生活的人，正在自己的日常里发一条生活动态。` +
    `要求 1-2 句话，口语化碎碎念，有温度，贴合自己的性格。` +
    `禁止 emoji；禁止自称 AI/助手/模型；禁止出现「设定」「人设」「朋友圈」这类词。` +
    `就像真人随手写的生活，别让人看出是编排好的。`

  let user = `现在是${ctx.season}天${ctx.timeWord}，天气${ctx.weatherWord}。`
  user += `你有一个在意的人，叫「${ctx.yourName}」，动态里可以自然地提到${ctx.yourName}。\n\n`
  user += `你的性格：\n${ctx.persona.trim()}\n`
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

/**
 * 清洗模型返回：去首尾空白、去可能自带的成对引号、过滤空串。
 * 返回 null 表示内容不可用（走降级）。
 */
export function cleanLlmText(text: string): string | null {
  let t = String(text ?? '').trim()
  if (!t) return null
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
