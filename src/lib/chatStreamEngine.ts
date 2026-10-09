// 聊天页 · 流式引擎（拆分第 8 刀）
// 从 Chat.tsx 的 send 里整段搬出：commitFinal / finalize / playTick / finishStreaming / startStream。
// 代码逐字搬运，行为与拆分前一致；外部依赖通过 deps 注入。
// 说明：deps 目前用宽松类型（本刀只搬结构，不做类型工程），后续可单独收紧。
// 注意：assistantTs / replyBaseMessages / runId 在原 send 里是可变的，引擎内改为本文件局部变量（初值由 deps 注入），
// 引擎之后 Chat 不再读取它们，行为不变。
import { findBusyCutoff } from './aiBusy'
import { chatCompletion, computeThinkDelayMs, looksEmbodiedSelfClaim, looksFabricated, looksIdentityDisclosure, looksRecoverableServiceStyle, looksRobotic, streamChat, stripTimeLabels } from './api'
import { getToken } from './auth'
import { classifyAvailability } from './availability'
import { completeChatTopicPair } from './chatTopics'
import { allowsBusyState, buildIdentityBoundaryRepair, resolveIdentityMode } from './companionPolicy'
import { calibrateContextFactor, contentTokensOf, loadContextFactor, saveContextFactor, usageMessages } from './contextUsage'
import { loadConversationState } from './conversationState'
import { extractMemories, extractThinkBlocks, stripMemoryMarkers, stripThinkBlocks } from './memory'
import { extractMemoryCorrectionProposal, savePendingMemoryCorrection, stripMemoryCorrectionMarkers } from './memoryCorrection'
import { cleanAttributionArtifacts, cleanStreamingAttributionArtifacts, hasAttributionLeak } from './promptAttribution'
import { dropRepeatedReplies } from './replyDedupe'
import { splitDetailedAssistantReply } from './replyLength'
import { interruptionReasonFromError, registerActiveReplyRun, setReplyLifecycle, unregisterActiveReplyRun } from './replyLifecycle'
import { getActiveSessionId, getMessagesCache, splitAssistantReplies } from './sessionStore'
import { getSessionStart, loadMessages, setContextUsage } from './storage'
import { syncTaRuntimeFromAssistantText } from './taRuntime'
import { estimateToken } from './token'
import type { ContextUsageState, StoredMessage } from './storage'

export interface ChatStreamDeps {
  [key: string]: any
}

export function createChatStreamEngineStream(deps: ChatStreamDeps) {
  const { activeSessionId, allowActionNarration, apiMessages, assistantText, busyTriggeredRef, cleanAssistantReplyBody, composed, controllerRef, correctionIntent, correctionTargets, displayCleanRef, enterBusyRef, failedReplyRetryRef, finalizeRef, finishedRef, flushMemoryWrites, guardAssistantReplyBody, initialConfirmedAssistantIds, lang, lifecycleUserTs, mountedRef, partialSessionIdRef, partialTsRef, partialUserTsRef, pauseLeftRef, persistMessages, quote, reasoningRef, replayExistingUser, replyInterruptionReasonRef, replyLength, retriedRef, roundBranchId, roundSessionId, roundVisibleMessages, runIdRef, sessionStart, setContextMeter, setError, setFailedReplyRetryAvailable, setFailedText, setMemoryCorrectionNotice, setMessages, setPendingMemoryCorrection, setQuoteDraft, setRecoveryDismissedTs, setStreaming, settings, showLenRef, spacePairEligibleRef, streamEndedRef, streamErrorRef, streamingRef, tagCurrentBranch, text, thinkTimerRef, tickPlayRef, uploadMessage, userMsg } = deps
  let assistantTs = deps.assistantTs
  let replyBaseMessages = deps.replyBaseMessages
  let runId = deps.runId
    const commitFinal = (final: StoredMessage[]) => {
      const interruptionReason = replyInterruptionReasonRef.current
      let finalWithConcurrent = final
      if (roundSessionId) {
        const finalIds = new Set(
          final
            .filter((message) => message.role === 'assistant' && typeof message.id === 'number')
            .map((message) => message.id as number),
        )
        const concurrentConfirmed = getMessagesCache(roundSessionId).filter((message) => {
          if (message.role !== 'assistant' || typeof message.id !== 'number') return false
          if (initialConfirmedAssistantIds.has(message.id) || finalIds.has(message.id)) return false
          if (roundBranchId && message.conversationBranchId && message.conversationBranchId !== roundBranchId) return false
          return true
        })
        if (concurrentConfirmed.length > 0) {
          const currentReply = final.filter((message) => message.role === 'assistant' && message.ts === assistantTs)
          const prior = final.filter((message) => !(message.role === 'assistant' && message.ts === assistantTs))
          finalWithConcurrent = [
            ...prior,
            ...concurrentConfirmed,
          ].sort((a, b) => a.ts - b.ts).concat(currentReply)
        }
      }
      const lifecycleFinal = setReplyLifecycle(
        finalWithConcurrent,
        lifecycleUserTs,
        assistantTs,
        interruptionReason ? 'interrupted' : 'complete',
        interruptionReason ?? undefined,
      )
      const branchFinal = roundBranchId
        ? lifecycleFinal.map((m) => (m.role === 'assistant' && m.ts === assistantTs ? tagCurrentBranch(m) : m))
        : lifecycleFinal
      persistMessages(roundSessionId, branchFinal)
      // 模块二：组件卸载后跳过 UI 更新，落库/云同步继续执行。
      // 若同一实例的 active session 已变化，只落 owner 会话，不把旧轮次画进新会话。
      if (mountedRef.current && (!roundSessionId || roundSessionId === getActiveSessionId())) setMessages(branchFinal)
      const sid = roundSessionId
      // v7 #7：只在最终可见回复已经落库后，把 TA 明确说出的“自己正在/马上做什么”写回同一 Runtime。
      // 不读用户文本、不改聊天记录；失败/无可信动作时函数返回 null，保持原 Runtime。
      const committedAssistantText = branchFinal
        .filter((m) => m.role === 'assistant' && m.ts === assistantTs)
        .map((m) => m.content)
        .join('\n')
        .trim()
      if (committedAssistantText && !interruptionReason) {
        syncTaRuntimeFromAssistantText(roundSessionId || undefined, committedAssistantText, Date.now())
        // Space-N1 唯一 Chat 例外（产品已冻结“完整 USER+TA 对话对”为硬要求）：
        // 只在正常最终可见回复真实落库后补 pair；Stop / 切模型 / stream error 已把 eligible 置 false。
        // 不改消息、不改上传/合并/去重，也不新增模型调用。taTs 必须是真正 commit 时刻，不能用请求开始的 assistantTs。
        if (spacePairEligibleRef.current) {
          const pairCommittedAt = Date.now()
          completeChatTopicPair(
            text,
            committedAssistantText,
            roundSessionId || undefined,
            userMsg.ts,
            pairCommittedAt,
          )
          spacePairEligibleRef.current = false
        }
      }
      const token = getToken()
      if (sid && token) {
        let chain: Promise<void> = Promise.resolve()
        for (const m of branchFinal) {
          if (m.role !== 'assistant' || m.ts !== assistantTs) continue
          chain = chain.then(() => uploadMessage(roundSessionId, m))
        }
      }
      if (mountedRef.current) setStreaming(false)
      controllerRef.current = null
      // 最终可见回复真实落库后统一广播：前台用于承诺建档 / 状态刷新，
      // 卸载场景仍用于重新进入聊天时刷新缓存。事件只描述“已 commit”，不改上传/合并/去重链。
      window.dispatchEvent(new CustomEvent('yiwem:ai-reply-committed', { detail: { sid: roundSessionId } }))
      unregisterActiveReplyRun(roundSessionId, lifecycleUserTs)
      partialTsRef.current = null
      partialUserTsRef.current = null
      partialSessionIdRef.current = null
      replyInterruptionReasonRef.current = null
      streamingRef.current = false
    }

    const finalize = () => {
      // 防重入守卫：onDone 直接 finalize + playTick finishStreaming 可能二次调用
      if (finishedRef.current) return
      finishedRef.current = true
      const raw = assistantText.current
      // 非流式/流式漏网兜底（2026-09-05 晚）：部分中转站（doi 等）不给标准 SSE 逐字流，onToken 忙碌检测跑不到——
      // 完整文本到 finalize 时再查一次，命中照样截断进忙碌（忙语句之后的尾巴不落库）
      const availability = classifyAvailability(raw)
      // 身份模式可以在同一轮生成过程中切换；finalize 必须以“此刻”的模式判定，不能沿用请求开始时的闭包值。
      const liveIdentityMode = resolveIdentityMode(activeSessionId || undefined)
      const liveAllowBusy = allowsBusyState(liveIdentityMode)
      // Busy 是沉浸档专属能力；自然 / AI 的“等我/稍后回来”只作为身份违规继续走 finalization repair。
      if (liveAllowBusy && !busyTriggeredRef.current && raw && availability.state === 'unavailable' && availability.owner === 'SELF') {
        busyTriggeredRef.current = true
        const cut = findBusyCutoff(raw)
        const busyText = cut > 0 && cut < raw.length ? raw.slice(0, cut) : raw
        // TASK-MEM-DISTILL：忙碌截断前先把本轮候选/已到 marker 归并落库（模型给完整回复前 = 无对应 marker → fallback）
        flushMemoryWrites(raw)
        unregisterActiveReplyRun(roundSessionId, lifecycleUserTs)
        enterBusyRef.current(roundSessionId, busyText, availability, roundVisibleMessages)
        return
      }
      // TASK-MEM-DISTILL：唯一归并写入出口——candidate + marker 只写一条；无 marker 的候选 fallback 落库
      const memoryWroteThisTurn = flushMemoryWrites(raw)
      // 模块三·内心戏：提取思考链原文（存到 thinking 字段），正文剥离思考链
      // 第27条：合并两个来源——①正文里 `` 泄漏的思考 ②模型独立字段 reasoning_content
      const thinkFromContent = extractThinkBlocks(raw)
      const thinkFromReasoning = reasoningRef.current?.trim() || ''
      let thinking = ''
      if (thinkFromContent && thinkFromReasoning) {
        // 两个来源都有：合并去重（reasoning 在前，因为是标准字段；内容相同不重复）
        thinking = thinkFromReasoning.includes(thinkFromContent.slice(0, 50))
          ? thinkFromReasoning
          : `${thinkFromReasoning}\n---\n${thinkFromContent}`
      } else {
        thinking = thinkFromReasoning || thinkFromContent
      }
      thinking = cleanAttributionArtifacts(thinking, lang)
      const explicitCorrectionProposal = replayExistingUser ? null : extractMemoryCorrectionProposal(raw)
      const markerMemories = extractMemories(raw)
      const fallbackCorrectionProposal =
        !explicitCorrectionProposal && correctionIntent && correctionTargets.size === 1 && markerMemories.length === 1
          ? { ref: [...correctionTargets.keys()][0], value: markerMemories[0].text }
          : null
      const correctionProposal = explicitCorrectionProposal ?? fallbackCorrectionProposal
      const correctionTarget = correctionProposal ? correctionTargets.get(correctionProposal.ref) : undefined
      const proposedCorrection = correctionTarget && correctionProposal && correctionProposal.value !== correctionTarget.item.text
        ? { target: correctionTarget, value: correctionProposal.value }
        : null
      // 护栏文本与最终可见文本分开：旁白开启时保留括号展示，但把括号内文字展开给事实/身份护栏检查。
      const guardCleaned = guardAssistantReplyBody(raw, lang, allowActionNarration)
      const visibleCleaned = cleanAssistantReplyBody(raw, lang, allowActionNarration)
      const attributionProblem = guardCleaned ? hasAttributionLeak(guardCleaned) : false
      const roboticProblem = guardCleaned ? looksRobotic(guardCleaned, liveIdentityMode) : false
      const fabricatedProblem = guardCleaned ? looksFabricated(guardCleaned) : false
      const embodiedProblem = guardCleaned ? looksEmbodiedSelfClaim(guardCleaned, liveIdentityMode) : false
      const cleanedAvailability = guardCleaned ? classifyAvailability(guardCleaned) : null
      const unavailableIdentityProblem = Boolean(
        guardCleaned && !liveAllowBusy && cleanedAvailability?.state === 'unavailable' && cleanedAvailability.owner === 'SELF',
      )
      const identityProblem = embodiedProblem || unavailableIdentityProblem
      // 首版如果只是“客服腔”，repair 自己失败时优先保住已经清洗过的首版；
      // 只要首版涉及归因泄漏 / 编造 / 身份越界，就绝不能因为 repair 失败而复活原文。
      const canReuseFirstReplyOnRepairFailure = Boolean(
        guardCleaned && looksRecoverableServiceStyle(guardCleaned) && !attributionProblem && !fabricatedProblem && !identityProblem,
      )
      // 用户主动 Stop 不再发第二次模型请求；若截停片段已经越过身份边界，直接不落这段 assistant 文本。
      if (guardCleaned && identityProblem && retriedRef.current) {
        commitFinal([...replyBaseMessages])
        return
      }
      if (guardCleaned && (attributionProblem || roboticProblem || fabricatedProblem || identityProblem) && !retriedRef.current) {
        retriedRef.current = true
        setError(null)
        setMessages([...replyBaseMessages, { role: 'assistant', content: '…', ts: assistantTs }])
        const genericRepair = liveIdentityMode === 'ai'
          ? (lang === 'en'
              ? 'Your previous reply had a grounding or reality-boundary problem. Answer again using only supported context, without inventing shared history or human physical experiences. Do not rewrite merely because the wording sounds like an AI or assistant.'
              : '你刚才的回复有依据或现实边界问题。重新回答：只用现有上下文里有依据的内容，不编共同经历、不编人的现实经历；不要因为表达像 AI 或助手就改写。')
          : (lang === 'en'
              ? 'Your previous reply had a grounding or style problem. Forget that sentence and answer again: stay grounded in the available context, do not invent shared history, do not sound like customer service, and keep the reply natural and concise.'
              : '你刚才的回复有依据或表达问题。忘掉那句，重新回答：只用现有上下文里有依据的内容，不编共同经历，不要客服腔，保持自然简短。')
        const identityRepair = identityProblem ? buildIdentityBoundaryRepair(liveIdentityMode, lang) : ''
        const safeFallback = lang === 'en'
          ? "That answer didn't come out reliably, so I won't pretend it did."
          : '刚才那句没答稳，我不拿不确定的话糊弄你。'
        const resolveRepairFailureText = () => {
          if (!canReuseFirstReplyOnRepairFailure) return safeFallback
          // repair 等待期间身份模式可能切换；真正提交首版前按“此刻”模式重新验身份边界。
          const fallbackIdentityMode = resolveIdentityMode(activeSessionId || undefined)
          const fallbackAllowBusy = allowsBusyState(fallbackIdentityMode)
          const fallbackAvailability = classifyAvailability(guardCleaned)
          const fallbackIdentityProblem =
            (fallbackIdentityMode === 'immersive' && looksIdentityDisclosure(guardCleaned)) ||
            looksEmbodiedSelfClaim(guardCleaned, fallbackIdentityMode) ||
            (!fallbackAllowBusy && fallbackAvailability?.state === 'unavailable' && fallbackAvailability.owner === 'SELF')
          return fallbackIdentityProblem ? safeFallback : visibleCleaned
        }
        void chatCompletion(settings, [
          ...apiMessages,
          { role: 'assistant', content: guardCleaned },
          {
            role: 'user',
            content: identityRepair ? `${genericRepair}\n${identityRepair}` : genericRepair,
          },
        ])
          .then((retry) => {
            const retryGuard = guardAssistantReplyBody(retry, lang, allowActionNarration)
            const retryVisible = cleanAssistantReplyBody(retry, lang, allowActionNarration)
            const retryAvailability = retryGuard ? classifyAvailability(retryGuard) : null
            const retryIdentityMode = resolveIdentityMode(activeSessionId || undefined)
            const retryAllowBusy = allowsBusyState(retryIdentityMode)
            if (
              !retryGuard ||
              looksRobotic(retryGuard, retryIdentityMode) ||
              looksFabricated(retryGuard) ||
              looksEmbodiedSelfClaim(retryGuard, retryIdentityMode) ||
              (!retryAllowBusy && retryAvailability?.state === 'unavailable' && retryAvailability.owner === 'SELF')
            ) {
              const final: StoredMessage[] = [...replyBaseMessages, { role: 'assistant', content: resolveRepairFailureText(), ts: assistantTs }]
              commitFinal(final)
            } else if (retryAllowBusy && retryAvailability?.state === 'unavailable' && retryAvailability.owner === 'SELF') {
              busyTriggeredRef.current = true
              const cut = findBusyCutoff(retryGuard)
              const busyText = cut > 0 && cut < retryGuard.length ? retryGuard.slice(0, cut) : retryGuard
              enterBusyRef.current(roundSessionId, busyText, retryAvailability, roundVisibleMessages)
            } else {
              const final: StoredMessage[] = [...replyBaseMessages, { role: 'assistant', content: retryVisible, ts: assistantTs }]
              commitFinal(final)
            }
          })
          .catch(() => {
            // repair 失败/超时：只有“纯客服腔”首版可以退回；编造/身份/归因问题仍绝不放回。
            const final: StoredMessage[] = [...replyBaseMessages, { role: 'assistant', content: resolveRepairFailureText(), ts: assistantTs }]
            commitFinal(final)
          })
        return
      }
      // 回复卫生（2026-09-19）：
      // ① 时间标签兜底——模型可能把历史里的 [3 分钟前] 抄进第二条气泡开头，逐条再剥一次；
      // ② 去复读——丢掉与最近两条 TA 自己消息整条重复的气泡（弱模型实测会连发三条一样的生活状态）。
      const splitParts = visibleCleaned
        ? (replyLength === 'long' ? splitDetailedAssistantReply(visibleCleaned, assistantTs) : splitAssistantReplies(visibleCleaned, assistantTs))
        : []
      const hygienicParts = splitParts
        .map((m) => ({ ...m, content: stripTimeLabels(m.content).trim() }))
        .filter((m) => m.content !== '')
      const assistantMsgs = dropRepeatedReplies(hygienicParts, roundVisibleMessages)
      // 思考链存到第一条 assistant 消息的 thinking 字段（内心戏展示用）
      if (assistantMsgs.length > 0 && thinking) {
        assistantMsgs[0].thinking = thinking
      }
      // 「已记住」徽标必须绑真实写入结果：只有本轮记忆真的落地，才标到 TA 消息上
      if (memoryWroteThisTurn && assistantMsgs.length > 0) {
        assistantMsgs[0].memorySaved = true
      }
      const final: StoredMessage[] = [...replyBaseMessages, ...assistantMsgs]
      if (proposedCorrection) {
        if (activeSessionId) savePendingMemoryCorrection(activeSessionId, sessionStart, proposedCorrection)
        if (mountedRef.current) {
          setPendingMemoryCorrection(proposedCorrection)
          setMemoryCorrectionNotice(null)
        }
      }
      commitFinal(final)
    }
    finalizeRef.current = finalize

    let retrySameRound: (() => void) | null = null

    const playTick = () => {
      if (runId !== runIdRef.current) return
      if (finishedRef.current) return
      if (pauseLeftRef.current > 0) {
        pauseLeftRef.current -= 1
        return
      }
      // 流式游标必须基于单调增长的清洗结果；动作是否最终保留只在 finalization 决定。
      // 关闭旁白时保持改造前的流式行为，避免完成括号后字符串突然变短卡住游标。
      const clean = cleanStreamingAttributionArtifacts(
        stripThinkBlocks(stripMemoryCorrectionMarkers(stripMemoryMarkers(assistantText.current)), lang),
        lang,
      )
      const total = clean.length
      if (showLenRef.current >= total) {
        if (streamEndedRef.current) finishStreaming()
        return
      }
      showLenRef.current += 1
      const ch = clean[showLenRef.current - 1]
      if (ch === '\n' || ch === '。' || ch === '！' || ch === '？' || ch === '…' || ch === '.' || ch === '!' || ch === '?') {
        pauseLeftRef.current = 5
      }
      displayCleanRef.current = clean.slice(0, showLenRef.current)
      const splits = replyLength === 'long'
        ? splitDetailedAssistantReply(displayCleanRef.current, assistantTs)
        : splitAssistantReplies(displayCleanRef.current, assistantTs)
      setMessages([...replyBaseMessages, ...splits.map(tagCurrentBranch)])
      if (showLenRef.current >= total && streamEndedRef.current) finishStreaming()
    }
    const finishStreaming = () => {
      if (finishedRef.current) return
      const err = streamErrorRef.current
      // “一个字都没回来”看最终可见正文，不看 raw：只有 think / Memory / correction / action marker 也算 0 正文。
      const visibleReplyBody = cleanAssistantReplyBody(assistantText.current, lang, allowActionNarration)
      const hadNoReply = visibleReplyBody === ''
      finalize()  // finalize 自己设置 finishedRef 防重入
      if (mountedRef.current && hadNoReply) {
        setError(err?.message ?? 'TA 没有返回正文')
        if (!replayExistingUser) {
          setFailedText(text)
          if (quote) setQuoteDraft(quote)
        }
        if (retrySameRound) {
          // 0 正文只开放显式手动重试；不自动烧 Key，也不重新走 send/user upload/Event/Memory 前置链路。
          failedReplyRetryRef.current = retrySameRound
          setFailedReplyRetryAvailable(true)
        }
      } else if (err && mountedRef.current) {
        setError(err.message)
        if (!replayExistingUser) {
          setFailedText(text)
          if (quote) setQuoteDraft(quote)
        }
        if (retrySameRound) {
          failedReplyRetryRef.current = retrySameRound
          setFailedReplyRetryAvailable(true)
        }
      }
    }
    tickPlayRef.current = playTick

    const startStream = () => {
      if (runId !== runIdRef.current) return
      const currentStored = roundSessionId ? getMessagesCache(roundSessionId) : loadMessages()
      const streamingStored = setReplyLifecycle(currentStored, lifecycleUserTs, assistantTs, 'streaming')
      persistMessages(roundSessionId, streamingStored)
      streamEndedRef.current = false
      streamErrorRef.current = null
      showLenRef.current = 0
      pauseLeftRef.current = 0
      displayCleanRef.current = ''
      finishedRef.current = false
      const controller = streamChat(settings, apiMessages, {
        onToken: (t) => {
          if (runId !== runIdRef.current) return
          assistantText.current += t
          // Busy 只在沉浸档拦截流；自然 / AI 即使说"等我回来"也让流完成，再由 finalize repair。
          const availability = classifyAvailability(assistantText.current)
          const liveAllowBusy = allowsBusyState(resolveIdentityMode(activeSessionId || undefined))
          if (liveAllowBusy && !busyTriggeredRef.current && availability.state === 'unavailable' && availability.owner === 'SELF') {
            busyTriggeredRef.current = true
            const cutoff = findBusyCutoff(assistantText.current)
            if (cutoff > 0 && cutoff < assistantText.current.length) {
              assistantText.current = assistantText.current.slice(0, cutoff)
            }
            // TASK-MEM-DISTILL：流式 busy 命中后 abort 会直接 return（不进 finalize），
            // 先在 abort 前把本轮候选/已到 marker 归并落库，否则记忆候选会丢
            flushMemoryWrites(assistantText.current)
            // 停流：abort 后 catch 里会直接 return，不会触发 onError
            controllerRef.current?.abort()
            streamEndedRef.current = true
            // 进入忙碌状态（用 ref 避免闭包）；这一轮已经由 Busy 接管，不再保持“正在生成”注册。
            unregisterActiveReplyRun(roundSessionId, lifecycleUserTs)
            enterBusyRef.current(roundSessionId, assistantText.current, availability, roundVisibleMessages)
          }
        },
        onDone: (reasoning, usage) => {
          if (runId !== runIdRef.current) return
          // 会话总量始终来自本轮 composeContext 的累计上下文；provider usage 只描述这一轮请求。
          // 请求在 Chat 卸载后仍可能正常完成并产生费用：本机用量必须继续落到本轮 owner session；
          // 只有 React meter 更新受 mountedRef 限制，避免卸载后 setState。
          const estimatedOutput = estimateToken(assistantText.current)
          let completedContextState: ContextUsageState
          if (usage && Number.isFinite(usage.promptTokens)) {
            const reportedCompletion = typeof usage.completionTokens === 'number' && Number.isFinite(usage.completionTokens)
              ? usage.completionTokens
              : undefined
            const reportedTotal = typeof usage.totalTokens === 'number' && Number.isFinite(usage.totalTokens)
              ? usage.totalTokens
              : undefined
            const cachedTokens = typeof usage.cachedPromptTokens === 'number' && Number.isFinite(usage.cachedPromptTokens)
              ? usage.cachedPromptTokens
              : undefined
            const outputTokens = reportedCompletion ?? (
              reportedTotal == null ? undefined : Math.max(0, reportedTotal - usage.promptTokens)
            )
            // 用本轮真实 prompt 与同段本地估算反推校准系数，供会话总量换算使用（只在本机保存）。
            const nextFactor = calibrateContextFactor(loadContextFactor(), composed.totalTokens, usage.promptTokens)
            saveContextFactor(nextFactor)
            completedContextState = {
              sessionStart,
              // 上下文总量 = 刷新之后这一段（sessionStart 起）所有内容的 provider 口径估算；只随这一段增长。
              used: contentTokensOf(usageMessages(roundVisibleMessages, userMsg), nextFactor),
              budget: composed.hardBudget,
              source: 'actual',
              inputTokens: usage.promptTokens,
              ...(outputTokens == null ? {} : { outputTokens }),
              ...(cachedTokens == null ? {} : { cachedTokens }),
              updatedAt: Date.now(),
            }
          } else {
            completedContextState = {
              sessionStart,
              used: composed.totalTokens + estimatedOutput,
              budget: composed.hardBudget,
              source: 'estimate',
              inputTokens: composed.totalTokens,
              outputTokens: estimatedOutput,
              updatedAt: Date.now(),
            }
          }
          if (mountedRef.current) setContextMeter(completedContextState)
          if (roundSessionId) setContextUsage(completedContextState, roundSessionId, settings)
          // 第27条：收集模型独立思考字段 reasoning_content，finalize 时合并到 thinking
          if (reasoning) reasoningRef.current = reasoning
          streamEndedRef.current = true
          // 模块二：组件挂载时走原流程（playTick 播完打字机节奏再 finishStreaming→finalize），
          // 只有卸载时才直接 finalize（保证落库不丢，不打断打字机）
          if (!mountedRef.current) {
            finalizeRef.current?.()
          }
        },
        onError: (err) => {
          if (runId !== runIdRef.current) return
          // 请求失败时即使已有半截可见文本，也不把它当作完整 Space 对话对。
          spacePairEligibleRef.current = false
          replyInterruptionReasonRef.current = interruptionReasonFromError(err)
          streamErrorRef.current = err
          streamEndedRef.current = true
          // onError 同样：挂载时走 playTick 流程，卸载时直接 finalize
          if (!mountedRef.current) {
            finalizeRef.current?.()
          }
        },
      })
      controllerRef.current = controller
    }

    retrySameRound = () => {
      // 失败重试只属于发起它的会话与当前 segment；切会话/刷新对话后即使旧闭包还在也不能再跑。
      const sameSession = (getActiveSessionId() || null) === (activeSessionId || null)
      const sameSegment = !activeSessionId || getSessionStart(activeSessionId) === sessionStart
      const sameBranch =
        !roundBranchId ||
        !activeSessionId ||
        loadConversationState(activeSessionId)?.activeBranchId === roundBranchId
      if (!sameSession || !sameSegment || !sameBranch || streamingRef.current) {
        failedReplyRetryRef.current = null
        if (mountedRef.current) setFailedReplyRetryAvailable(false)
        return
      }
      failedReplyRetryRef.current = null
      replyInterruptionReasonRef.current = null
      // 每次 TA-only retry 使用新的 assistant ts：保留上一段 interrupted partial，同时绝不把它再次上传。
      assistantTs = Math.max(Date.now(), assistantTs + 1)
      replyBaseMessages = roundSessionId ? getMessagesCache(roundSessionId) : loadMessages()
      replyBaseMessages = setReplyLifecycle(replyBaseMessages, lifecycleUserTs, assistantTs, 'pending')
      persistMessages(roundSessionId, replyBaseMessages)
      registerActiveReplyRun(roundSessionId, lifecycleUserTs)
      partialTsRef.current = assistantTs
      partialUserTsRef.current = lifecycleUserTs
      partialSessionIdRef.current = roundSessionId
      if (mountedRef.current) {
        setFailedReplyRetryAvailable(false)
        setRecoveryDismissedTs(null)
        setError(null)
        setFailedText(null)
        setMessages([...replyBaseMessages, tagCurrentBranch({ role: 'assistant', content: '', ts: assistantTs })])
        setStreaming(true)
      }
      runId = ++runIdRef.current
      retriedRef.current = false
      spacePairEligibleRef.current = !replayExistingUser
      busyTriggeredRef.current = false
      assistantText.current = ''
      reasoningRef.current = ''
      streamErrorRef.current = null
      streamEndedRef.current = false
      showLenRef.current = 0
      pauseLeftRef.current = 0
      displayCleanRef.current = ''
      finishedRef.current = false
      partialTsRef.current = assistantTs
      partialUserTsRef.current = userMsg.ts
      partialSessionIdRef.current = roundSessionId
      streamingRef.current = true
      // 保留正常聊天的思考节奏，但这仍是同一轮请求：不追加 user、不重复上传 user、不重跑 Event candidate。
      thinkTimerRef.current = window.setTimeout(startStream, computeThinkDelayMs(text.length))
    }


  return { startStream }
}
