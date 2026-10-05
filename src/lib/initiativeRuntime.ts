import { looksFabricated, stripActionMarkers, stripEmoji } from './chatPrompts.ts'
import { stripMemoryMarkers, stripThinkBlocks } from './memory.ts'
import { chooseInitiativeCandidate, markInitiativeDelivered, type InitiativeCandidate, type InitiativePolicyInput } from './initiativePolicy.ts'
import type { ApiMessage } from './chatPrompts.ts'
import type { IdentityMode } from './companionPolicy.ts'
import type { ModelUsage } from './modelChat.ts'
import type { InitiativePreference } from './storage.ts'
import type { Lang } from './langDetect.ts'

export interface InitiativeGenerationContext {
  sessionId: string
  taName: string
  persona: string
  lang: Lang
  identityMode: IdentityMode
}

export type InitiativeCatchUpOutcome =
  | 'disabled-or-no-reason'
  | 'in-flight'
  | 'generation-failed'
  | 'rejected'
  | 'commit-failed'
  | 'delivered'

export interface InitiativeCatchUpDeps {
  estimateTokens: (text: string) => number
  generate: (messages: ApiMessage[]) => Promise<{ text: string; usage?: ModelUsage }>
  commit: (content: string, candidate: InitiativeCandidate) => Promise<boolean>
  recordUsage: (usage: {
    source: 'actual' | 'estimate'
    inputTokens: number
    outputTokens?: number
    cachedTokens?: number
  }) => void
  savePreference: (preference: InitiativePreference) => boolean
  now?: () => number
  onDelivered?: (content: string, candidate: InitiativeCandidate) => void
}

const inFlight = new Set<string>()

function reasonLine(candidate: InitiativeCandidate, lang: Lang): string {
  if (lang === 'en') {
    if (candidate.reason === 'future-intent') {
      return 'A real plan the user previously made with you is due now. Due does NOT mean it happened: ' + candidate.evidence
    }
    if (candidate.reason === 'open-thread') {
      return 'Your own last visible reply left this real question unfinished. Resume it naturally without claiming the user answered: ' + candidate.evidence
    }
    if (candidate.reason === 'self-intent') {
      return 'In your own prior visible reply, you explicitly said you wanted to continue this later. You may now pick it up naturally: ' + candidate.evidence
    }
    if (candidate.reason === 'event') return 'A real recorded event happened: ' + candidate.evidence
    return 'Today is a real important date: ' + candidate.evidence
  }
  if (candidate.reason === 'future-intent') {
    return '用户之前真实说过的约定今天已到期。到期不代表已经发生：' + candidate.evidence
  }
  if (candidate.reason === 'open-thread') {
    return '你上一条真实可见回复里留下了这个尚未等到用户回答的问题。可以自然接回来，但绝不能假装用户已经回答过：' + candidate.evidence
  }
  if (candidate.reason === 'self-intent') {
    return '你之前真实可见回复里明确说过之后还想继续这件事。现在可以自然接回来：' + candidate.evidence
  }
  if (candidate.reason === 'event') return '已经记录的真实 Event：' + candidate.evidence
  return '今天是真实的重要日子：' + candidate.evidence
}

function identityInstruction(mode: IdentityMode, lang: Lang): string {
  if (lang === 'en') {
    if (mode === 'immersive') return 'Stay in the companion persona. Do not mention system prompts or settings.'
    if (mode === 'natural') return 'Be natural and AI-aware if needed. Do not claim physical real-world experiences.'
    return 'You may be explicit that you are AI. Do not claim human physical experiences.'
  }
  if (mode === 'immersive') return '保持陪伴角色语气，不提系统、提示词、设定。'
  if (mode === 'natural') return '保持自然表达；需要时可以承认 AI 身份，但不能声称自己真的经历了现实中的物理生活。'
  return '可以明确自己是 AI，但不能声称自己拥有真人的物理生活经历。'
}

export function buildInitiativeMessages(
  context: InitiativeGenerationContext,
  candidate: InitiativeCandidate,
): ApiMessage[] {
  const persona = String(context.persona ?? '').trim().slice(0, 4000)
  const isEn = context.lang === 'en'
  const system = isEn
    ? [
        'You are ' + (context.taName || 'TA') + ', the user\'s long-term companion.',
        persona ? 'Persona: ' + persona : '',
        identityInstruction(context.identityMode, context.lang),
        'Write ONE proactive message, 1–2 short sentences.',
        'You are generating only because there is real evidence below. Stay strictly within that evidence.',
        'Never invent what you did while the user was away. Never imply an upcoming plan already happened.',
        'Do not mention that an app, rule, event detector, memory system, or evidence triggered you.',
        'Sound like a natural continuation, not a report or customer-service message.',
      ].filter(Boolean).join('\n')
    : [
        '你是' + (context.taName || 'TA') + '，是用户长期相处的陪伴角色。',
        persona ? '人设：' + persona : '',
        identityInstruction(context.identityMode, context.lang),
        '只写一条主动消息，1–2 句短句。',
        '你之所以开口，只因为下面有真实依据；只能沿着这条依据说。',
        '绝不能编造用户离开期间你去做了什么现实中的事；未来约定到期也绝不能当成已经发生。',
        '不要提“系统、规则、识别、记忆库、Event、依据”等后台概念。',
        '像自然接着关系说话，不要写成提醒通知或客服播报。',
      ].filter(Boolean).join('\n')

  return [
    { role: 'system', content: system },
    { role: 'user', content: reasonLine(candidate, context.lang) },
  ]
}

function hasUnsupportedOfflineClaim(text: string): boolean {
  const zh = /(?:^|[，。！？；\s])我(?:刚刚?|刚才|之前|这会儿|一直|已经)?(?:去(?:了)?|回来|回家|到家|下班|上班|吃(?:了|完)|喝(?:了|完)|洗(?:了|完)|睡(?:了|过)|散步|跑步|健身|开会|做饭|逛街|看完|忙完)/
  const en = /\bI\s+(?:just\s+|was\s+|have\s+been\s+|already\s+)?(?:went|came back|got home|got back|worked|ate|drank|slept|walked|ran|worked out|cooked|shopped|finished watching)\b/i
  return zh.test(text) || en.test(text)
}

function futureIntentClaimedComplete(text: string): boolean {
  return /(?:我们|咱们).{0,10}(?:已经|刚刚?|刚才|终于).{0,10}(?:看完|吃完|去过|玩完|做完|完成)|(?:看完|吃完|玩完|做完).{0,8}(?:回来|了)/.test(text)
    || /\bwe\s+(?:just|already|finally)\s+(?:watched|ate|went|finished|did)\b/i.test(text)
}

export function cleanInitiativeReply(
  raw: string,
  candidate: InitiativeCandidate,
  lang: Lang,
): string | null {
  const cleaned = stripActionMarkers(
    stripEmoji(
      stripThinkBlocks(stripMemoryMarkers(String(raw ?? '')), lang),
    ),
    lang,
  )
    .replace(/\s{2,}/g, ' ')
    .trim()

  if (!cleaned) return null
  if (looksFabricated(cleaned)) return null
  if (hasUnsupportedOfflineClaim(cleaned)) return null
  if (candidate.reason === 'future-intent' && futureIntentClaimedComplete(cleaned)) return null

  const chars = Array.from(cleaned)
  const limit = lang === 'en' ? 320 : 160
  if (chars.length > limit) return chars.slice(0, limit).join('').trim()
  return cleaned
}

export async function runInitiativeCatchUp(
  policyInput: InitiativePolicyInput,
  context: InitiativeGenerationContext,
  deps: InitiativeCatchUpDeps,
): Promise<InitiativeCatchUpOutcome> {
  const candidate = chooseInitiativeCandidate(policyInput)
  if (!candidate) {
    if (policyInput.preference.lastBackgroundAt > 0) {
      deps.savePreference({ ...policyInput.preference, lastBackgroundAt: 0 })
    }
    return 'disabled-or-no-reason'
  }

  if (inFlight.has(context.sessionId)) return 'in-flight'
  // 主动消息宁可漏一次也不能因为网络/响应不确定而重复轰用户：
  // 在模型调用前先记“这条理由已经尝试过”，daily count 仍只在真正投递成功后增加。
  if (!deps.savePreference({ ...policyInput.preference, lastCandidateKey: candidate.key })) {
    return 'generation-failed'
  }
  inFlight.add(context.sessionId)
  try {
    const messages = buildInitiativeMessages(context, candidate)
    const estimatedInputTokens = messages.reduce((sum, message) => sum + deps.estimateTokens(message.content), 0)

    let generated: { text: string; usage?: ModelUsage }
    try {
      generated = await deps.generate(messages)
    } catch {
      return 'generation-failed'
    }

    const outputEstimate = deps.estimateTokens(generated.text)
    if (generated.usage && Number.isFinite(generated.usage.promptTokens)) {
      deps.recordUsage({
        source: 'actual',
        inputTokens: generated.usage.promptTokens,
        ...(typeof generated.usage.completionTokens === 'number'
          ? { outputTokens: generated.usage.completionTokens }
          : typeof generated.usage.totalTokens === 'number'
            ? { outputTokens: Math.max(0, generated.usage.totalTokens - generated.usage.promptTokens) }
            : { outputTokens: outputEstimate }),
        ...(typeof generated.usage.cachedPromptTokens === 'number'
          ? { cachedTokens: generated.usage.cachedPromptTokens }
          : {}),
      })
    } else {
      deps.recordUsage({
        source: 'estimate',
        inputTokens: estimatedInputTokens,
        outputTokens: outputEstimate,
      })
    }

    const cleaned = cleanInitiativeReply(generated.text, candidate, context.lang)
    if (!cleaned) return 'rejected'

    const committed = await deps.commit(cleaned, candidate)
    if (!committed) return 'commit-failed'

    const deliveredAt = deps.now?.() ?? Date.now()
    const nextPreference = markInitiativeDelivered(policyInput.preference, candidate, deliveredAt)
    const saved = deps.savePreference({ ...nextPreference, lastBackgroundAt: 0 })
    if (!saved) return 'commit-failed'

    try {
      deps.onDelivered?.(cleaned, candidate)
    } catch {
      // 已落库是不可逆提交点：展示层回调失败不能把成功投递降级或触发重试。
    }
    return 'delivered'
  } finally {
    inFlight.delete(context.sessionId)
  }
}

export function resetInitiativeRuntimeForTests(): void {
  inFlight.clear()
}
