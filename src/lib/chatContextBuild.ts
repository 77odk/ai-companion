import { loadCurrentPosts } from './aiSpace'
import { buildActionNarrationInstruction, buildMemoryBlock, buildSystemPrompt, buildTimeContext } from './api'
import { getToken } from './auth'
import { futureTopicsFromMessages } from './chatTopics'
import { allowsEmbodiedLifeContext, resolveIdentityMode } from './companionPolicy'
import { COMPACT_KEEP_RECENT, buildCompactedHistory, composeContext } from './contextComposer'
import { processEventCandidate } from './eventDetector'
import { formatEventDateShort, getRecentEvents } from './eventStore'
import { buildFutureAgendaBlock } from './futureAgenda'
import { buildUserWeatherContext, readUserWeatherContext } from './homeWeather'
import { buildIdentityContext } from './identityContext'
import { getListenTogetherSnapshot } from './listenTogetherState'
import { loadMemory, stripMemoryMarkers, stripThinkBlocks, touchMemory } from './memory'
import { stripMemoryCorrectionMarkers } from './memoryCorrection'
import { selectMemoryWorkingSet, shouldTouchMemoryFromUser } from './memoryRecallPolicy'
import { messageEvidenceText } from './messageQuote'
import { cleanAttributionArtifacts, formatAttributedLine } from './promptAttribution'
import { getRelationshipRoleGuidanceForPrompt, getRelationshipSettingLabelForPrompt } from './relationshipState'
import { buildReplyLengthInstruction, getEffectiveReplyLength } from './replyLength'
import { LIFE_BASELINE, LIFE_BASELINE_EN, buildSpacePostsBlock, personaHasLifeAnchors } from './spaceChatInject'
import { isActionNarrationEnabled, loadAIProfile, loadUserProfile } from './storage'
import { getAccount } from './sync'
import { buildTaRuntimeContext, getOrAdvanceTaRuntime, getSessionPersona, shouldInjectTaRuntimeContext } from './taRuntime'
import { getTaStateView, taMoodLabelForPrompt } from './taState'
import { getWeeklyReviews } from './weeklyReview'
import { MOMENT_GUIDE_EN, MOMENT_GUIDE_ZH, buildYourMomentBlock, shouldInjectYourMoment } from './yourMoment'
// 聊天页 · 上下文拼装（C+ 拆分第 1 块）
// 从 Chat.tsx 的 send 流程整段搬出：Event 候选窗、主 system 拼装、TA Runtime、Space 注入、
// 未来约定、生活基线、Bridge / Compact 注入、上下文块组装与请求体拼装。
// 本文件是纯计算：不碰 React 状态、不碰 ref、不 await、不写存储。
import type { ApiMessage } from './api'
import type { ContextBlock } from './contextComposer'
import type { MemoryCorrectionTarget } from './memoryCorrection'
import { recallSessionMemories } from './sessionStore'
import { getMemoriesCache } from './sessionStore'
import { getSessionsCache } from './sessionStore'
import { detectMemoryInstruction } from './memory'
import { touchMemoryCache } from './sessionStore'
import { getActiveSessionId } from './sessionStore'
import type { Lang } from './langDetect'
import type { StoredMessage } from './storage'
import type { Session } from './sessionApi'
import { getContextBridge } from './storage'

interface ChatContextInput {
  activeSession: Session | null
  activeSessionId: string
  base: StoredMessage[]
  bridgeInfo: ReturnType<typeof getContextBridge>
  compactDone: boolean
  compactSummary: string
  contextBoundary: number
  persona: string
  lang: Lang
  memInstr: ReturnType<typeof detectMemoryInstruction>
  isRetort: boolean
  text: string
  userMsg: StoredMessage
  roundVisibleMessages: StoredMessage[]
  replayExistingUser: boolean
  correctionIntent: boolean
}

export interface ChatContextResult {
  replyLength: ReturnType<typeof import('./replyLength').getEffectiveReplyLength>
  allowActionNarration: boolean
  apiMessages: ApiMessage[]
  correctionTargets: Map<string, MemoryCorrectionTarget>
  memory: ReturnType<typeof import('./memory').loadMemory>
  history: ApiMessage[]
  composed: ReturnType<typeof import('./contextComposer').composeContext>
}

export function buildChatContextBlocks(input: ChatContextInput): ChatContextResult {
  const { activeSession, activeSessionId, base, bridgeInfo, compactDone, compactSummary, contextBoundary, persona, lang, text, userMsg, roundVisibleMessages, replayExistingUser, correctionIntent, memInstr, isRetort } = input
    // Event Candidate Window：只带最近 6 条聊天里最多 2 条历史 user 原话 + 真实 ts；TA 文本永不作为 Event 证据。
    // 这让软 Event 在第一次“收口句”命中时就有多轮 evidence；最终仍由 Event V2 原五维硬闸门决定是否落库。
    if (!replayExistingUser) {
      const recentEventUserEvidence = roundVisibleMessages
        .slice(-6)
        .filter((m) => m.role === 'user')
        .slice(-2)
        .map((m) => ({ text: messageEvidenceText(m.content), ts: m.ts }))
        .filter((m) => m.text.length > 0)
      void processEventCandidate({
        sessionId: activeSessionId || undefined,
        userText: text,
        recentUserEvidence: recentEventUserEvidence,
        now: userMsg.ts,
      })
    }

    const nameForPrompt = (() => {
      if (!activeSessionId) return loadAIProfile().nickname
      const cached = getSessionsCache().find((s) => String(s.id) === activeSessionId)
      const t = (cached?.title || activeSession?.title || '').trim()
      if (!t || t === '新会话' || t === '我们的开始') return loadAIProfile(activeSessionId).nickname
      return t
    })()
    const accountId = activeSessionId ? (getAccount()?.account ?? '') : ''
    const replyLength = activeSessionId
      ? getEffectiveReplyLength(accountId, activeSessionId)
      : 'natural'
    const replyPreference = buildReplyLengthInstruction(replyLength, lang).trim()
    const allowActionNarration = isActionNarrationEnabled()
    const actionNarrationPreference = buildActionNarrationInstruction(allowActionNarration, lang).trim()
    // 回复偏好与旁白约定都并进现有主 system 文本末尾，不增加第二条 system。
    const apiMessages: ApiMessage[] = [
      {
        role: 'system',
        content:
          buildSystemPrompt(persona, nameForPrompt, undefined, getActiveSessionId() || undefined, lang, false) +
          (replyPreference ? '\n\n' + replyPreference : '') +
          (actionNarrationPreference ? '\n\n' + actionNarrationPreference : ''),
      },
    ]
    // 核心 system 只留稳定身份/规则；Memory/Event/Runtime/Space 等都走现有 ContextBlock，
    // 避免所有功能永久挤进不可裁剪的 core。
    const contextBlocks: ContextBlock[] = [
      { id: 'current-time', content: buildTimeContext(Date.now(), lang), priority: 'core' },
    ]
    const listening = getListenTogetherSnapshot()
    if (listening.hasTrack) {
      contextBlocks.push({
        id: 'user-listening',
        priority: 'ambient',
        content: lang === 'en'
          ? `[USER's player right now]\nTrack: ${listening.title}\nStatus: ${listening.playing ? 'playing' : 'paused'}. This is real player state shared across TA switches. You may naturally know what USER is listening to; do not invent audio details that are not present here.`
          : `【用户此刻的播放器】\n正在听：${listening.title}\n状态：${listening.playing ? '播放中' : '已暂停'}。这是用户级真实播放器状态，切换 TA 也不变。你可以自然知道用户正在听什么，但不要编造这里没有的歌曲细节。`,
      })
    }
    const correctionTargets = new Map<string, MemoryCorrectionTarget>()

    const contextText = base
      .slice(-6)
      .map((m) => (m.role === 'assistant'
        ? cleanAttributionArtifacts(stripThinkBlocks(stripMemoryCorrectionMarkers(stripMemoryMarkers(m.content)), lang), lang)
        : m.content))
      .join('\n')
    const recalledMemory = recallSessionMemories(activeSessionId, contextText)
    const memory = selectMemoryWorkingSet(recalledMemory, {
      userText: text,
      // correction ref 只会让最终字符串更长；用同长度的 s:<id> 做预算上界，避免真实渲染后超出 working-set budget。
      renderBlock: (items) => buildMemoryBlock(
        items,
        lang,
        correctionIntent ? (item) => `s:${item.id}` : undefined,
      ),
    }).items
    if (memory.length > 0) {
      const refByItem = new Map<object, string>()
      if (correctionIntent) {
        const globalItems = loadMemory()
        const sessionItems = activeSessionId ? getMemoriesCache(activeSessionId) : []
        const token = getToken() ?? ''
        for (const m of memory) {
          const globalMatch = globalItems.filter((item) => item.id === m.id && item.text === m.text)
          const sessionMatch = sessionItems.filter((item) => item.id === m.id && item.text === m.text)
          if (globalMatch.length + sessionMatch.length !== 1) continue
          if (globalMatch.length === 1) {
            const ref = `g:${m.id}`
            refByItem.set(m, ref)
            correctionTargets.set(ref, { kind: 'global', item: globalMatch[0] })
          } else if (activeSessionId && sessionMatch.length === 1) {
            const ref = `s:${m.id}`
            refByItem.set(m, ref)
            correctionTargets.set(ref, { kind: 'session', sessionId: activeSessionId, item: sessionMatch[0], token })
          }
        }
      }
      const memoryBlock = buildMemoryBlock(memory, lang, correctionIntent ? (item) => refByItem.get(item) : undefined)
      if (memoryBlock) {
        contextBlocks.push({ id: 'memory', content: memoryBlock, priority: 'memory' })
      }
      if (correctionTargets.size > 0) {
        contextBlocks.push({
          id: 'memory-correction-consent',
          priority: 'core',
          content: lang === 'en'
            ? 'USER may be correcting a stored fact. Only if they clearly replace/deny one numbered [M:...] memory, ask naturally for confirmation and end with exactly one line: [Correct Memory <g:id or s:id>] <the complete corrected fact>. This is only a proposal; do not claim it is already changed. Do not emit a normal [Memory] marker for the same fact.'
            : '用户这句话可能在纠正旧记忆。只有在他明确否定/替换上面某条带 [M:...] 编号的记忆时，先自然询问是否要改，并在回复末尾单独输出一行【纠正记忆·g:id或s:id】纠正后的完整事实。这个标记只是申请，不能说已经改好；同一事实不要再输出普通【记忆】标记。一次最多一条。',
        })
      }
      const now = Date.now()
      for (const m of memory) {
        if (m.pinned || !shouldTouchMemoryFromUser(m, text)) continue
        if (activeSessionId) touchMemoryCache(activeSessionId, m.id, now)
        touchMemory(m.id, now)
      }
    }
    // Event（E3 二处）：最近 5 条一起经历过的事注入（记忆注入之后、自我时间线之前）；
    // 只作背景信息，不让 TA 直接复述
    const recentEvents = getRecentEvents(activeSessionId || undefined, 3)
    if (recentEvents.length > 0) {
      const eventsHeader = lang === 'en'
        ? 'Background info — things you two have been through together (do not repeat these lines as-is):\n'
        : '以上是背景信息，不要直接复述这些句子——你们一起经历过的事：\n'
      contextBlocks.push({
        id: 'events',
        priority: 'event',
        content:
          eventsHeader +
          recentEvents.map((e) => {
            const eventText = `${e.title}${e.description ? `（${e.description}）` : ''}`
            return `- ${formatEventDateShort(e.occurredAt)}：${formatAttributedLine(eventText, 'SHARED', lang, 'USER')}`
          }).join('\n'),
      })
    }
    // 最近 TA 原话已经完整存在 history + 相对时间标记里，不再重复塞一份 SelfTimeline system。
    // TA Runtime：只在用户这一轮明确询问 TA 的当前状态时注入。
    // 平时不把 TA 上轮自述再喂回去，避免“自述 → Runtime → 再自述”越滚越具体；Home 展示仍独立读取同一 Runtime。
    if (shouldInjectTaRuntimeContext(text, lang)) {
      const runtime = getOrAdvanceTaRuntime(
        activeSessionId || undefined,
        getSessionPersona(activeSessionId || undefined),
        Date.now(),
      )
      const runtimeCtx = buildTaRuntimeContext(runtime, lang)
      if (runtimeCtx) {
        contextBlocks.push({ id: 'runtime', content: runtimeCtx, priority: 'runtime' })
      }
    }
    // S4：给模型只发当前轮需要的粗粒度状态摘要，不暴露双轴/七倾向/变化历史。
    if (activeSessionId) {
      const taState = getTaStateView(activeSessionId)
      const promptMood = taMoodLabelForPrompt(taState.mood, lang)
      contextBlocks.push({
        id: 'ta-state',
        priority: 'ambient',
        content: lang === 'en'
          ? `[Your current inner state]\nMood: ${promptMood}. Let it affect tone subtly. Do not announce a cause unless chat history directly supports one.`
          : `【你此刻的内在状态】\n心情：${promptMood}。只让它轻微影响语气；除非聊天历史有直接证据，不要主动编原因。`,
      })

      const relationshipLabel = getRelationshipSettingLabelForPrompt(activeSessionId, lang)
      if (relationshipLabel) {
        const relationshipGuidance = getRelationshipRoleGuidanceForPrompt(activeSessionId, lang)
        contextBlocks.push({
          id: 'relationship-setting',
          priority: 'core',
          content: lang === 'en'
            ? `[Relationship setting]\nUSER explicitly set your relationship as: ${relationshipLabel}. This setting controls role consistency only; never invent shared history from it.${relationshipGuidance ? ` ${relationshipGuidance}` : ''}`
            : `【关系设定】\n用户明确设定你们的关系是：${relationshipLabel}。它只约束关系口径，绝不能据此编造共同经历。${relationshipGuidance ? ` ${relationshipGuidance}` : ''}`,
        })
      }
    }

    const userWeather = readUserWeatherContext(loadUserProfile().city ?? '')
    if (userWeather) {
      contextBlocks.push({
        id: 'user-weather',
        content: buildUserWeatherContext(userWeather, lang),
        priority: 'ambient',
      })
    }
    const identityCtx = buildIdentityContext(activeSessionId || undefined, lang)
    if (identityCtx) {
      contextBlocks.push({ id: 'identity', content: identityCtx, priority: 'core' })
    }
    const journalRelevant = /周记|周报|周总结|这周|上周|本周|journal|weekly/i.test(text)
    const weeklyList = journalRelevant ? getWeeklyReviews(activeSessionId || undefined) : []
    if (weeklyList.length > 0) {
      const w = weeklyList[0]
      // TASK-JOURNAL-INJECT：不只带标题，带最近一篇正文前 200 字摘要，被问"周记写的啥"有内容可答
      const excerpt = (w.content ?? '').trim().slice(0, 200)
      if (lang === 'en') {
        contextBlocks.push({
          id: 'weekly-review',
          priority: 'ambient',
          content: `Your most recent journal entry to them is "${w.title}" (${w.weekLabel}).${excerpt ? `\n${formatAttributedLine(excerpt, 'SELF', 'en')}` : ''}\nIf they bring it up, respond in the tone and content of this entry.`,
        })
      } else {
        contextBlocks.push({
          id: 'weekly-review',
          priority: 'ambient',
          content: `你最近写给对方的周记是「${w.title}」（${w.weekLabel}）。${excerpt ? `\n${formatAttributedLine(excerpt, 'SELF', 'zh')}` : ''}\n对方要是提起周记，就照这篇的语气和内容回应。`,
        })
      }
    }
    const identityMode = resolveIdentityMode(activeSessionId || undefined)
    const allowEmbodiedLife = allowsEmbodiedLifeContext(identityMode)
    // Space 旧动态没有 identityMode stamp。为避免从沉浸切到自然 / AI 后把旧吃饭、出门、地点继续当成 SELF 事实，
    // v1 仅在沉浸档把 Space 历史注入 Chat；Space 页面本身仍照当前 identity policy 正常生成与展示。
    if (allowEmbodiedLife) {
      const spaceBlock = buildSpacePostsBlock(loadCurrentPosts(activeSessionId || undefined), 2, lang)
      if (spaceBlock) {
        contextBlocks.push({ id: 'space-posts', content: spaceBlock, priority: 'ambient' })
      }
    }
    // 未来约定注入（因果链第二环 TASK-FUTURE-AGENDA）：TA 记得「约好还没做的事」，
    // 对方问起/到期临近时能自然接，不会一问三不知；没约定返回空串跳过，不占上下文。
    const agendaBlock = buildFutureAgendaBlock(futureTopicsFromMessages(base), new Date(), lang)
    if (agendaBlock) {
      contextBlocks.push({ id: 'future-agenda', content: agendaBlock, priority: 'event' })
    }
    // 生活基线 / 你的时刻只在这一轮真的需要 TA 分享自己近况时才进上下文，不再每轮常驻。
    const recentUserTexts = base
      .filter((m) => m.role === 'user')
      .slice(-3)
      .map((m) => m.content)
    const shouldShareMoment = allowEmbodiedLife && shouldInjectYourMoment(recentUserTexts, lang)
    if (shouldShareMoment && !personaHasLifeAnchors(persona)) {
      contextBlocks.push({
        id: 'life-baseline',
        content: lang === 'en' ? LIFE_BASELINE_EN : LIFE_BASELINE,
        priority: 'ambient',
      })
    }
    if (shouldShareMoment) {
      const momentBlock = buildYourMomentBlock(persona, new Date(), lang)
      if (momentBlock) {
        contextBlocks.push({
          id: 'your-moment',
          priority: 'ambient',
          content: `${lang === 'en' ? MOMENT_GUIDE_EN : MOMENT_GUIDE_ZH}\n${formatAttributedLine(momentBlock, 'SELF', lang)}`,
        })
      }
    }
    if (!replayExistingUser && memInstr.isInstruction && !(correctionIntent && correctionTargets.size > 0)) {
      if (lang === 'en') {
        contextBlocks.push({
          id: 'memory-explicit',
          priority: 'core',
          content: `USER just asked you to remember: ${formatAttributedLine(memInstr.fact ?? text, 'USER', 'en')}. Write only that stated fact, with no inference or added conclusion. End with one [Memory: Topic] line and briefly confirm it was noted.`,
        })
      } else {
        contextBlocks.push({
          id: 'memory-explicit',
          priority: 'core',
          content: `USER 刚要求你记住：${formatAttributedLine(memInstr.fact ?? text, 'USER', 'zh')}。只写这条明确事实，不推断、不补充；回复末尾单独一行输出【记忆·主题】内容，并简短确认已记下。`,
        })
      }
    } else if (isRetort && !(correctionIntent && correctionTargets.size > 0)) {
      if (lang === 'en') {
        contextBlocks.push({
          id: 'memory-retort',
          priority: 'core',
          content:
            'They reminded you to save something from the recent conversation. Extract only stable facts they actually stated; do not infer. End with one [Memory: Topic] line and confirm it was noted.',
        })
      } else {
        contextBlocks.push({
          id: 'memory-retort',
          priority: 'core',
          content:
            '用户在提醒你记下最近提过的信息。只提取用户实际说过、适合长期保留的稳定事实，不推断不补充；回复末尾输出一行【记忆·主题】内容，并确认已记下。',
        })
      }
    }

    const history: ApiMessage[] = base.map((m) => {
      const body =
        m.role === 'assistant'
          ? cleanAttributionArtifacts(stripThinkBlocks(stripMemoryMarkers(m.content), lang), lang)
          : m.content
      const mark = msgTimeMark(m.ts, lang)
      return { role: m.role, content: mark ? mark + body : body }
    })

    // PR #99 Session Bridge：已承接时，注入 evidence-only bridge 摘要（memory 优先级块，不新增 LLM 调用）。
    // 只临时参与后续约 BRIDGE_ACTIVE_TURNS 轮（turnsLeft 递减，归零后退出注入）；不写 Memory / Event。
    const bridgeBlocks: ContextBlock[] = []
    if (activeSessionId && bridgeInfo && bridgeInfo.bridgedAt >= contextBoundary && bridgeInfo.turnsLeft > 0 && bridgeInfo.content.trim()) {
      bridgeBlocks.push({ id: 'bridge', content: bridgeInfo.content, priority: 'memory' })
    }
    // PR #99 Context Compact：已压缩时，注入 = [较老历史摘要(system)] + [最近原始消息]。
    // 当前时间已经在 buildSystemPrompt 中注入一次；这里不再追加第二条时间 system。
    const historyForModel =
      activeSessionId && compactDone && compactSummary.trim()
        ? buildCompactedHistory(compactSummary, history, COMPACT_KEEP_RECENT)
        : history
    const composed = composeContext(apiMessages, historyForModel, [...contextBlocks, ...bridgeBlocks])
  return { replyLength, allowActionNarration, apiMessages, correctionTargets, memory, history, composed }
}

// 原 Chat.tsx 顶部工具函数，随本块一起搬来（Chat 侧仍需使用故导出）
export function msgTimeMark(ts: number, _lang: Lang): string {
  if (!Number.isFinite(ts) || ts <= 0) return ''
  const d = new Date(ts)
  if (Number.isNaN(d.getTime())) return ''
  const yyyy = d.getFullYear()
  const mm = String(d.getMonth() + 1).padStart(2, '0')
  const dd = String(d.getDate()).padStart(2, '0')
  const hh = String(d.getHours()).padStart(2, '0')
  const min = String(d.getMinutes()).padStart(2, '0')
  return `[${yyyy}-${mm}-${dd} ${hh}:${min}] `
}
