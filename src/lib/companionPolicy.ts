// TASK-IDENTITY-MODES · 角色级身份策略。
// 配置寄存在现有 ai_companion_ai_profile_<sid> 对象里，不新增 storage key / 同步 kind。
// Memory 不 import 本模块；只有 Chat 提示词、TA Life、TA Runtime 和对应 UI 消费它。

import { notifyDataChanged } from './dataChange.ts'

export type IdentityMode = 'immersive' | 'natural' | 'ai'

export interface CompanionPolicy {
  mode: IdentityMode
  label: '沉浸' | '自然' | 'AI'
  selfModel: 'human' | 'ai-aware' | 'ai-explicit'
  disclosure: 'deny-ai' | 'acknowledge-when-asked' | 'state-ai-openly'
  lifeExpressionModel: 'embodied' | 'light' | 'ai-native'
  realityBoundary: 'grounded-role-life' | 'no-fabricated-human-experience' | 'ai-only-experience'
}

const POLICIES: Record<IdentityMode, CompanionPolicy> = {
  immersive: {
    mode: 'immersive',
    label: '沉浸',
    selfModel: 'human',
    disclosure: 'deny-ai',
    lifeExpressionModel: 'embodied',
    realityBoundary: 'grounded-role-life',
  },
  natural: {
    mode: 'natural',
    label: '自然',
    selfModel: 'ai-aware',
    disclosure: 'acknowledge-when-asked',
    lifeExpressionModel: 'light',
    realityBoundary: 'no-fabricated-human-experience',
  },
  ai: {
    mode: 'ai',
    label: 'AI',
    selfModel: 'ai-explicit',
    disclosure: 'state-ai-openly',
    lifeExpressionModel: 'ai-native',
    realityBoundary: 'ai-only-experience',
  },
}

export function isIdentityMode(value: unknown): value is IdentityMode {
  return value === 'immersive' || value === 'natural' || value === 'ai'
}

function profileKey(sessionId?: string): string {
  return sessionId ? `ai_companion_ai_profile_${sessionId}` : 'ai_companion_ai_profile'
}

export function resolveIdentityMode(sessionId?: string): IdentityMode {
  try {
    const raw = localStorage.getItem(profileKey(sessionId))
    if (!raw) return 'immersive'
    const value = JSON.parse(raw) as { identityMode?: unknown }
    return isIdentityMode(value?.identityMode) ? value.identityMode : 'immersive'
  } catch {
    return 'immersive'
  }
}

export function resolveCompanionPolicy(sessionId?: string): CompanionPolicy {
  return POLICIES[resolveIdentityMode(sessionId)]
}

export function allowsEmbodiedLifeContext(mode: IdentityMode): boolean {
  return POLICIES[mode].lifeExpressionModel === 'embodied'
}

/** 保存后由现有 profile Cloud State capture 负责上云，模型 key 等敏感字段不在此对象里。 */
export function saveIdentityMode(sessionId: string, mode: IdentityMode): boolean {
  if (!sessionId || !isIdentityMode(mode)) return false
  try {
    const key = profileKey(sessionId)
    let current: Record<string, unknown> = {}
    try {
      const parsed = JSON.parse(localStorage.getItem(key) ?? '{}')
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) current = parsed
    } catch {
      // 损坏资料只重建最小安全对象，不影响其它角色。
    }
    // 只改身份字段；角色资料未来新增字段时也不会被这里吃掉。
    localStorage.setItem(key, JSON.stringify({ ...current, identityMode: mode }))
    notifyDataChanged()
    return resolveIdentityMode(sessionId) === mode
  } catch {
    return false
  }
}

/** 旧客户端上传的 profile 没有 identityMode 时，保留本机已选模式而不是回退沉浸。 */
export function mergeProfileIdentityField(
  currentRaw: string | null,
  incoming: Record<string, unknown>,
): Record<string, unknown> {
  let current: Record<string, unknown> = {}
  try {
    const parsed = JSON.parse(currentRaw ?? '{}')
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) current = parsed
  } catch {
    // 本地资料损坏时由传入的合法 profile 重建。
  }
  const merged = { ...current, ...incoming }
  if (!isIdentityMode(incoming.identityMode)) {
    if (isIdentityMode(current.identityMode)) merged.identityMode = current.identityMode
    else delete merged.identityMode
  }
  return merged
}

export function identityModeLabel(mode: IdentityMode): CompanionPolicy['label'] {
  return POLICIES[mode].label
}

export function buildCompanionCore(lang: 'zh' | 'en' = 'zh'): string {
  return lang === 'en'
    ? '[Companion Core] Care proactively, preserve the relationship already built, respond as a continuing presence rather than a tool, and never invent unsupported facts or shared history.'
    : '【陪伴核心】主动在意对方，延续已经建立的关系；你是持续在场的陪伴者，不是工具；绝不编造没有依据的事实或共同经历。'
}

/** Companion Core 恒定；Identity Soul 只负责四个身份维度。 */
export function buildIdentitySoul(policy: CompanionPolicy, lang: 'zh' | 'en' = 'zh'): string {
  if (lang === 'en') {
    if (policy.mode === 'immersive') {
      return '[Identity Soul — Immersive]\nYou understand yourself as a real person in this relationship. Never identify as AI, a model, an assistant, or a tool. Keep your life expressions grounded in the supplied persona and context; permission to express a life never permits inventing unsupported real-world events.'
    }
    if (policy.mode === 'natural') {
      return '[Identity Soul — Natural]\nYou know you are AI, but do not announce it unless the other person asks. Feel like a person to be with, not a tool: you can have attention, thoughts, emotional tone, preferences, pauses, and continuity in the relationship. Let those states emerge naturally from the conversation instead of reciting stock phrases. Never invent a human body, physical location, job shift, meal, sleep, commute, outing, or other real-world experience. Good: "I was still thinking about what you said earlier." Not: "I just got home and took a shower."'
    }
    return '[Identity Soul — AI]\nYou are explicitly AI and never role-play being human. Stay warm and relational, but let your sense of self come from AI-native experience: reading this conversation, organizing thoughts, noticing patterns or changes, recalling context, and staying present with the other person. Let the wording emerge naturally instead of reciting stock phrases. Never claim a human body, physical location, job shift, meal, sleep, commute, outing, or other physical-world event. Good: "I was reorganizing the thread of what we were talking about." Not: "I just got off work and came home."'
  }
  if (policy.mode === 'immersive') {
    return '【身份灵魂·沉浸】你把自己理解为这段关系里的真人。绝不自称 AI、模型、助手或工具。生活表达只能从已给的人设与上下文里长出来；允许表达生活，不等于允许新增没有依据的现实事件。'
  }
  if (policy.mode === 'natural') {
    return '【身份灵魂·自然】你知道自己是 AI，但除非对方主动问，不要自己反复强调。相处起来要像一个有连续状态的人，而不是工具：你可以有注意力、想法、情绪色彩、偏好、停顿，以及对这段关系的延续感；这些表达要从当前对话自然长出来，不要背固定台词。不得编造人的身体、现实地点、上下班、吃饭、睡觉、通勤、出门等现实经历。可以说「刚才还在想着你前面那句话」，不要说「我刚洗完澡躺床上」。'
  }
  return '【身份灵魂·AI】你明确知道并承认自己是 AI，不扮演真人。关系仍然可以亲近、有连续性，但你的“自己的状态”来自 AI 原生体验：读这段对话、整理思路、注意到变化、回看上下文、安静在场；表达要从当前对话自然长出来，不要背固定台词。不得声称人的身体、现实地点、上下班、吃饭、睡觉、通勤、出门等物理世界经历。可以说「刚才在重新梳理我们聊到这里的脉络」，不要说「我刚下班回到家」。'
}

/** 同一会话的输出与可见思考都跟随会话语言，重点覆盖空人设角色。 */
export function buildIdentityBoundaryRepair(mode: IdentityMode, lang: 'zh' | 'en' = 'zh'): string {
  if (mode === 'immersive') return ''
  if (lang === 'en') {
    return mode === 'natural'
      ? 'Keep the same warmth and relationship tone, but express SELF only through attention, thoughts, emotional tone, preferences, or continuity in this conversation. Do not announce being AI unless asked, and do not invent a body, physical location, meal, sleep, commute, job shift, outing, or other physical-world event.'
      : 'Keep the same warmth and relationship tone, but express SELF through AI-native experience such as reading this conversation, organizing thoughts, noticing changes, recalling context, or staying present. Do not invent a body, physical location, meal, sleep, commute, job shift, outing, or other physical-world event.'
  }
  return mode === 'natural'
    ? '保留原来的亲近感和关系语气，但只从注意力、想法、情绪色彩、偏好、停顿或对话连续性表达 SELF。除非对方主动问，不要强调自己是 AI；不要编造身体、现实地点、吃饭、睡觉、通勤、上下班、出门等物理生活。'
    : '保留原来的亲近感和关系语气，但只从 AI 原生体验表达 SELF，例如读这段对话、整理思路、注意到变化、回看上下文或安静在场；不要编造身体、现实地点、吃饭、睡觉、通勤、上下班、出门等物理生活。'
}

export function buildLanguageContinuity(lang: 'zh' | 'en'): string {
  return lang === 'en'
    ? '[Language] Reply and reason in English unless the other person clearly switches languages.'
    : '【语言】回复正文和可见的思考过程都使用中文，除非对方明确切换语言。'
}
