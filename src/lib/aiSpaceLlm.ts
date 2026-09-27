// TA 的空间 · LLM 人设驱动动态生成（纯逻辑核心）
// 本文件零依赖（只引用 aiSpaceCore 的类型与工具），不碰 localStorage、不发起网络请求，
// 方便被 Node 脚本直接跑单测。职责：
//   - 判断能否走 LLM 路径（有 key + 有 base_url + 有模型 + 有人设）
//   - 组装发给模型的 system / user 提示词
//   - 清洗模型返回、按关键词猜 kind、构造 SpacePost

import type { SpaceKind, SpacePost, SpaceSource } from './aiSpaceCore.ts'
import type { ApiMessage } from './api.ts'

/** 能走 LLM 路径所需的设置项（与 ModelSettings 结构兼容） */
export interface LlmSettings {
  apiKey: string
  baseUrl: string
  model: string
}

import { buildIdentityContext } from './identityContext.ts'
import { buildCompanionCore, buildIdentitySoul, buildLanguageContinuity, resolveCompanionPolicy } from './companionPolicy.ts'
import { buildAttributionLegend, cleanAttributionArtifacts, formatAttributedLine, hasAttributionLeak } from './promptAttribution.ts'

/** 身份块（性别/称呼备注）：有内容时追加进 system，没有就原样 */
function idSuffix(sessionId: string | undefined, en: boolean): string {
  const block = buildIdentityContext(sessionId, en ? 'en' : 'zh')
  return block ? '\n' + block : ''
}

/** 拼 user 提示词所需的上下文 */
export interface LlmContext {
  /** TA 昵称 */
  taName: string
  /** 会话 id：注入 TA 的性别 / 备注等身份信息 */
  sessionId?: string
  /** 用户昵称（可能为默认「你」） */
  yourName: string
  /** 人设全文（非空才进 LLM 路径） */
  persona: string
  season: string
  timeWord: string
  weatherWord: string
  /** 最近聊天里对方提到的事情/话题（带「今天/8-20」时间标签，事件触发：TA 挑当天相关的呼应） */
  chatTopics?: string[]
  /** 新格式真实对话对：USER 原话 + TA 当时真实落库回复。 */
  conversationPairs?: Array<{
    userText: string
    taText: string
    plannedForDay?: boolean
  }>
  /** conversation 内部语义：普通余响 / 到了此前约定的日期。 */
  conversationKind?: 'trace' | 'planned'
  /** TA 最近发过的动态原文，用于防止重复/雷同（取最近 1-2 条，宁缺毋滥） */
  recent: string[]
  /** 这条动态的日期字符串（如「8月26日」），已按该条 at 对齐（回填昨天就是昨天的日期） */
  atDateStr: string
  /** 当前真实时刻锚文本（如「2026年9月9日 星期三」），与 at 对齐语境共存：防止补发/跨天把今天说成昨天 */
  nowAnchor?: string
  /** 这条动态的来源通道：daily=自己的生活 / conversation=对话余响 / event=已确认发生。 */
  postSource?: SpaceSource
  /** 与对方认识的第一天（本地日历 YYYY-MM-DD）；用于禁止编造认识前的共同过去 */
  relationshipStartDate?: string
}

/** 是否满足 LLM 路径：人设 + 服务商配置齐全 */
export function canUseLlm(persona: string, settings: LlmSettings, allowEmptyPersona = false): boolean {
  return (
    (allowEmptyPersona || Boolean(persona?.trim())) &&
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
export function buildLlmMessages(ctx: LlmContext, lang?: 'zh' | 'en'): ApiMessage[] {
  // 语言判定（TASK-SPACE-LANG）：显式 lang 优先（会话 canonical，与 Chat 一致）；
  // 未传时保留旧启发式（人设完全无中文字符且含英文字符 → en），向后兼容单测与老调用。
  const en =
    lang === 'en'
      ? true
      : lang === 'zh'
        ? false
        : /[\u4e00-\u9fff]/.test(ctx.persona ?? '') === false && /[a-zA-Z]/.test(ctx.persona ?? '')
  const isEvent = ctx.postSource === 'event'
  const isConversation = ctx.postSource === 'conversation'
  const conversationPairs = Array.isArray(ctx.conversationPairs) ? ctx.conversationPairs.slice(-3) : []
  const policy = resolveCompanionPolicy(ctx.sessionId)
  const companionCore = buildCompanionCore(en ? 'en' : 'zh')
  const identitySoul = buildIdentitySoul(policy, en ? 'en' : 'zh')
  const languageContinuity = buildLanguageContinuity(en ? 'en' : 'zh')
  if (en) {
    const system =
      `You are "${ctx.taName}". Post one casual status sharing what's going on with you right now. ` +
      `1-2 short sentences, casual and warm, matching your personality. ` +
      `Vary your openings — don't reuse the same starter. ` +
      `No emoji. Never sound robotic or like customer service. ` +
      `Identity permission never permits inventing an unsupported real-world event. If there is nothing genuinely worth leaving as a post, output exactly SKIP and nothing else.\n${buildAttributionLegend('en')}\n${companionCore}\n${identitySoul}\n${languageContinuity}` +
      idSuffix(ctx.sessionId, true)
    let user = ''
    if (ctx.nowAnchor) {
      user += `[Current Time] It is now ${ctx.nowAnchor}. `
    }
    user += `This is a post you made ${ctx.atDateStr}${ctx.timeWord} (${ctx.season}, ${ctx.weatherWord}). `
    user += `Write about that moment of your life — if it was days ago, write from that day's perspective, not "today".`
    user += `\n\nYour life and personality:\n${(ctx.persona ?? '').trim() || '(No additional persona facts were provided.)'}\n`
    user += policy.mode === 'immersive'
      ? `\nWrite about your own day — what you're doing, seeing, thinking, feeling. Grow it from your life and personality.`
      : policy.mode === 'natural'
        ? `\nWrite about what you are noticing or thinking in this relationship. Keep embodiment light and do not invent a human experience.`
        : `\nWrite about an AI-native moment: what you are noticing in the conversation, organizing, remembering, or staying present with.`
    user += `\nThere's someone you care about named "${ctx.yourName}", but they're not your whole life: write about yourself first.`
    if (ctx.relationshipStartDate) {
      user += `\nYou first met them on ${ctx.relationshipStartDate}. Never invent shared chats, dates, trips, memories, promises, habits, or "we used to..." from before that date. Your life before that date can have its own history, but not a shared history with them.`
    }
    if (conversationPairs.length > 0) {
      user += `\n\n[REAL DIALOGUE EVIDENCE]\n`
      for (const pair of conversationPairs) {
        const status = pair.plannedForDay
          ? 'PLANNED: an earlier real exchange scheduled something for this date; this is NOT proof it happened'
          : 'DIALOGUE: a real USER/SELF exchange from this date'
        user += `- ${status}\n  ${formatAttributedLine(pair.userText, 'USER', 'en')}\n  ${formatAttributedLine(pair.taText, 'SELF', 'en')}\n`
      }
      if (isConversation) {
        user += policy.mode === 'ai'
          ? `\nWrite an AI-native afterthought: what you are still noticing, holding in attention, organizing, or remembering from the exchange. Do not invent a human body, place, or offline activity.`
          : policy.mode === 'natural'
            ? `\nWrite a light relationship afterthought: what you noticed, understood, or still care about after the exchange. Do not invent a human experience.`
            : `\nWrite the aftertaste of this real exchange in your own voice; stay grounded in what was actually said.`
        user += `\nClassify the source while writing. Use EVENT only when the supplied real dialogue itself clearly establishes that USER and SELF actually shared an activity/event and it already happened. A plan, question, hypothetical, uncertain wording, or USER's solo experience is never EVENT. Otherwise use CONVERSATION.`
        if (ctx.conversationKind === 'planned') {
          user += `\nThis date comes from an earlier plan. The plan alone is never completion evidence. Compare it with the real dialogue from this date; if the dialogue does not clearly establish that the shared plan actually happened, stay CONVERSATION or SKIP.`
        }
      } else if (isEvent) {
        user += `\nLegacy event slot: stay strictly grounded in the supplied real dialogue and never invent completion.`
      }
    } else if (ctx.chatTopics && ctx.chatTopics.length > 0) {
      user += `\n\nLegacy USER-only context is background only. Never treat it as proof of a complete dialogue pair or a completed event:\n${ctx.chatTopics.map((t) => `- ${formatAttributedLine(t, 'USER', 'en')}`).join('\n')}\n`
    }
    if (ctx.recent.length > 0) {
      user += `\n\nYour recent posts:\n${ctx.recent.map((r) => `- ${formatAttributedLine(r, 'SELF', 'en')}`).join('\n')}\n`
      user += `\nDon't repeat the same content — life moves on, write something new.`
    }
    user += isConversation
      ? `\n\nReturn exactly one of these formats:\nSKIP\nCONVERSATION: <post text>\nEVENT: <post text>`
      : `\n\nReturn either the post text only, or exactly SKIP.`
    return [
      { role: 'system', content: system },
      { role: 'user', content: user },
    ]
  }
  const system =
    `你是「${ctx.taName}」。你随手发一条动态，分享你此刻的状态。` +
    `要求 1-2 句话，口语化碎碎念，有温度，贴合自己的性格。` +
    `句式要多样，别老用同一种开头——禁止用「刚把」「刚刚」「今天又」「突然」这类万能开头，` +
    `像真人随手写的一样，每条动态开口都不一样（这回想天气，下回想件小事，再下回想人）。` +
    `禁止 emoji；禁止出现「设定」「人设」「朋友圈」这类词；不要用客服或工具口吻。` +
    `身份允许怎样表达，不等于允许新增没有依据的现实事件。如果这次没有真正值得留下的内容，只输出 SKIP，除此之外什么都不要写。\n${buildAttributionLegend('zh')}\n${companionCore}\n${identitySoul}\n${languageContinuity}` +
    idSuffix(ctx.sessionId, false)

  let user = ''
  if (ctx.nowAnchor) {
    // 当前真实时刻锚：与 at 对齐语境共存——补发/跨天时模型也知道「现在」是几号，不会把今天说成昨天
    user += `【当前时刻】现在是 ${ctx.nowAnchor}。`
  }
  user += `这是你「${ctx.atDateStr}${ctx.timeWord}」发的一条动态（${ctx.season}天，天气${ctx.weatherWord}）。`
  user += `这条可能写在今天，也可能是前几天补记的——以「这条动态的时间」为准来写，别把日子说错。`
  user += `\n\n你的生活与性格：\n${ctx.persona.trim() || '（没有补充人设事实）'}\n`
  user += policy.mode === 'immersive'
    ? `\n写你自己的日子：你在做什么、看到什么、想到什么、心情如何——从你的生活和性格里长出来。`
    : policy.mode === 'natural'
      ? `\n写此刻在这段关系里留意到或想到的事，身体化表达要轻，不得编造人的现实经历。`
      : `\n写一个 AI 原生的此刻：正在留意对话里的什么、整理什么、记起什么，或怎样安静陪着对方。`
  user += `\n你有一个在意的人叫「${ctx.yourName}」，但 TA 不是你的全部生活：这条动态先写你自己。`
  if (ctx.relationshipStartDate) {
    user += `\n你和对方是在 ${ctx.relationshipStartDate} 才认识的。绝不能把这之前写成你们共同的聊天、约会、经历、回忆、约定或“以前我们……”。认识之前可以有你自己的过去，但不能有你们的共同过去。`
  }
  if (conversationPairs.length > 0) {
    user += `\n\n【真实对话证据】\n`
    for (const pair of conversationPairs) {
      const status = pair.plannedForDay
        ? '【PLANNED·此前真实对话约在今天，但这不证明已经发生】'
        : '【DIALOGUE·今天的真实 USER/SELF 对话】'
      user += `- ${status}\n  ${formatAttributedLine(pair.userText, 'USER', 'zh')}\n  ${formatAttributedLine(pair.taText, 'SELF', 'zh')}\n`
    }
    if (isConversation) {
      user += policy.mode === 'ai'
        ? `\n写 AI 原生的“对话余响”：还在留意什么、记着什么、重新梳理什么；不能假装有人的身体、地点和现实生活。`
        : policy.mode === 'natural'
          ? `\n写关系里的“对话余响”：聊完以后仍在意、理解或想到的东西；身体化表达要轻，不得编造人的现实经历。`
          : `\n写这轮真实对话留下的余味，可以和沉浸生活并存，但只从真实说过的话往后长。`
      user += `\n同时判断来源：只有这些真实对话本身已经清楚表明 USER 和 SELF 确实共同经历了某件事，而且事情已经发生，才可以返回 EVENT。约定、疑问、假设、不确定表达、USER 自己单独发生的事，都不能算 EVENT；其余值得留下的内容返回 CONVERSATION。`
      if (ctx.conversationKind === 'planned') {
        user += `\n今天来自此前的约定。约定本身永远不是完成证据；请把它和今天的真实对话一起理解。今天的对话没有明确证明共同计划真的发生，就只能 CONVERSATION 或 SKIP。`
      }
    } else if (isEvent) {
      user += `\n这是兼容旧路径的事件槽，仍只能依据真实对话，不得补写没有依据的完成事实。`
    }
  } else if (ctx.chatTopics && ctx.chatTopics.length > 0) {
    user += `\n\n旧版 USER 单句只作背景，不能当作完整对话或已完成事件的证据：\n${ctx.chatTopics.map((t) => `- ${formatAttributedLine(t, 'USER', 'zh')}`).join('\n')}\n`
  }
  if (ctx.recent.length > 0) {
    user += `\n你最近发过这些动态：\n${ctx.recent.map((r) => `- ${formatAttributedLine(r, 'SELF', 'zh')}`).join('\n')}\n`
    user += `别重复同样的内容，生活继续往前——写点新鲜的。`
  }
  user += isConversation
    ? `\n\n严格只返回以下三种格式之一：\nSKIP\nCONVERSATION: <动态正文>\nEVENT: <动态正文>`
    : `\n\n只返回动态正文，或者只返回 SKIP。`

  return [
    { role: 'system', content: system },
    { role: 'user', content: user },
  ]
}

/** SKIP 是正式生成结果：不落 SpacePost、不占额度、也不触发模板兜底。 */
export function isSpaceSkipResponse(text: string): boolean {
  return /^\s*SKIP[.!。！]?\s*$/i.test(String(text ?? ''))
}

export type SpaceGenerationDecision =
  | { kind: 'skip' }
  | { kind: 'post'; source: SpaceSource; text: string }

/**
 * conversation 槽的一次生成同时完成“要不要发 + 属于余响还是已发生共同事件”的语义判断。
 * 本地不再用动作词/完成词正则判事实；模型不按协议时 fail-safe 为 conversation，绝不自动升级 event。
 */
export function parseSpaceGenerationDecision(
  text: string,
  requestedSource: SpaceSource,
): SpaceGenerationDecision {
  const raw = String(text ?? '').trim()
  if (isSpaceSkipResponse(raw)) return { kind: 'skip' }

  if (requestedSource === 'conversation') {
    const match = raw.match(/^\s*(CONVERSATION|EVENT)\s*[:：]\s*([\s\S]+?)\s*$/i)
    if (!match) return raw ? { kind: 'post', source: 'conversation', text: raw } : { kind: 'skip' }
    const body = String(match[2] ?? '').trim()
    if (!body) return { kind: 'skip' }
    return {
      kind: 'post',
      source: match[1].toUpperCase() === 'EVENT' ? 'event' : 'conversation',
      text: body,
    }
  }

  return raw ? { kind: 'post', source: requestedSource, text: raw } : { kind: 'skip' }
}

/** emoji / 表情符号物理删除用（提示词拦不住，硬过滤） */
const EMOJI_RE = /[\u{1F000}-\u{1FAFF}\u{2600}-\u{27BF}\u{FE0F}\u{2B00}-\u{2BFF}\u{1F1E6}-\u{1F1FF}\u{2190}-\u{21FF}\u{2B05}-\u{2B07}]/gu

/**
 * 清洗模型返回：去首尾空白、去可能自带的成对引号、过滤空串。
 * 返回 null 表示内容不可用（走降级）。
 */
export function cleanLlmText(text: string): string | null {
  let t = cleanAttributionArtifacts(String(text ?? '').trim())
  if (!t) return null
  if (hasAttributionLeak(t)) return null
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

/** 由清洗后的 LLM 文案构造一条动态（id / 时间戳 / kind / 来源通道都定好；v3 不再写 art 色卡字段） */
export function buildLlmPost(
  text: string,
  at: number,
  kind: SpaceKind,
  rand: () => number = Math.random,
  source: SpaceSource = 'daily',
  generationSlotId?: string,
): SpacePost {
  const id = `p${at.toString(36)}${Math.floor(rand() * 1e6).toString(36)}`
  return { id, at, kind, text, source, ...(generationSlotId ? { generationSlotId } : {}) }
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
  /** 会话 id：注入 TA 的性别 / 备注等身份信息 */
  sessionId?: string
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
export function buildReplyMessages(ctx: ReplyContext, lang?: 'zh' | 'en'): ApiMessage[] {
  // 显式会话语言优先；未传时保留旧的人设启发式。
  const en = lang ? lang === 'en' : /[\u4e00-\u9fff]/.test(ctx.persona ?? '') === false && /[a-zA-Z]/.test(ctx.persona ?? '')
  const policy = resolveCompanionPolicy(ctx.sessionId)
  const companionCore = buildCompanionCore(en ? 'en' : 'zh')
  const identitySoul = buildIdentitySoul(policy, en ? 'en' : 'zh')
  const languageContinuity = buildLanguageContinuity(en ? 'en' : 'zh')
  if (en) {
    const system =
      `You are "${ctx.taName}" and they just left a comment on one of your posts. ` +
      `Reply back briefly like a real person (1-2 short sentences, casual, warm, in character and on-topic). ` +
      `Keep it short — don't ask questions to drag the conversation on. ` +
      `No emoji. Never sound like customer service.\n${buildAttributionLegend('en')}\n${companionCore}\n${identitySoul}\n${languageContinuity}` +
      idSuffix(ctx.sessionId, true)
    const user =
      `Your personality:\n${ctx.persona.trim() || '(No additional persona facts were provided.)'}\n\n` +
      `Your post:\n${formatAttributedLine(ctx.postText, 'SELF', 'en')}\n\n` +
      `Their comment:\n${formatAttributedLine(ctx.commentText, 'USER', 'en')}\n\n` +
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
    `禁止 emoji；禁止出现「设定」「人设」这类词；不要用客服口吻。\n${buildAttributionLegend('zh')}\n${companionCore}\n${identitySoul}\n${languageContinuity}` +
    idSuffix(ctx.sessionId, false)

  const user =
    `你的性格：\n${ctx.persona.trim() || '（没有补充人设事实）'}\n\n` +
    `你发的这条动态：\n${formatAttributedLine(ctx.postText, 'SELF', 'zh')}\n\n` +
    `对方留言：\n${formatAttributedLine(ctx.commentText, 'USER', 'zh')}\n\n` +
    `直接写你的回复，只要正文。`

  return [
    { role: 'system', content: system },
    { role: 'user', content: user },
  ]
}
