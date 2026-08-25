import { useMemo, useState } from 'react'
import {
  WEEKLY_REPLY_SYSTEM_PROMPT,
  WEEKLY_SYSTEM_PROMPT,
  answerPendingReplies,
  buildWeeklyPrompt,
  cooldownInfo,
  formatMessageLine,
  getPendingReplies,
  getWeekRange,
  getWeeklyReviews,
  newWeeklyReviewId,
  parseWeeklyOutput,
  saveWeeklyReviews,
  type WeeklyReview,
} from '../lib/weeklyReview'
import { getKnownDays } from '../lib/milestone'
import { getFirstSeen, isSlowLetterMode, loadMessages, loadPersona, loadSettings } from '../lib/storage'
import { chatCompletion } from '../lib/api'
import { getActiveSessionId, getMemoriesCache, getMessagesCache, getSessionsCache } from '../lib/sessionStore'
import { loadMemory } from '../lib/memory'

/* ---- 定稿文案（一字不改） ---- */

const REPLY_PLACEHOLDER = '写下读完这篇周记你的感想'
const OPTION_IMMEDIATE = '✉️ 立即得到 TA 简短回复（默认）'
const OPTION_SEALED = '📨 封存留言，等 TA 更新下一篇周记再完整回信'
const SEALED_NOTE = '封存模拟书信，不会立刻答复；TA 每周仅会产出一篇周记。'
const SUCCESS_IMMEDIATE = '留言已送达✨ TA 读完写下了简短回复，展示在本条批阅下方。'
const SUCCESS_SEALED = '留言已封存 TA 暂时不会回复。TA 每周只会写一篇周记，下一篇周记更新时，你会收到完整回信。'
const REPLY_FAILED = 'TA 暂时没回上，下周周记会提到'
const EMPTY_STATE = 'TA 还没有写下周记，TA 每周最多产出一篇，请耐心等待。'
const TOOLTIP_TEXT = '周记：TA 自主记录内心与生活，每周最多一篇，你可以阅读留言，体验慢书信互动。'
const BANNER_REPLIED = '📬 TA 更新了新周记！同时拆开了你之前封存的留言，一并写下回信。'
const SLOW_LETTER_NOTE = '开启后，所有批阅强制封存，关闭即时回复，全部等待 TA 下一篇周记回信。'

/* ---- 线条图标（去 emoji，跟全站同一种描边风格） ---- */

const BackIcon = () => (
  <svg
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="1.5"
    strokeLinecap="round"
    strokeLinejoin="round"
    aria-hidden="true"
  >
    <path d="M15 18l-6-6 6-6" />
  </svg>
)

/** 列表页头部小问号：点开看周记说明 */
const QuestionIcon = () => (
  <svg
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="1.5"
    strokeLinecap="round"
    strokeLinejoin="round"
    aria-hidden="true"
  >
    <circle cx="12" cy="12" r="9" />
    <path d="M9.2 9a2.8 2.8 0 0 1 5.5 1c0 1.7-2.7 2.3-2.7 3.6" />
    <path d="M12 16.8h.01" />
  </svg>
)

/** 封存留言「待回信」的信封图标：线条 SVG（红线：图标禁 emoji） */
const EnvelopeIcon = () => (
  <svg
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="1.5"
    strokeLinecap="round"
    strokeLinejoin="round"
    aria-hidden="true"
  >
    <rect x="3" y="5" width="18" height="14" rx="2" />
    <path d="M3 7.5l9 6 9-6" />
  </svg>
)

interface Props {
  /** 返回记忆页 */
  onBack: () => void
  /** 没配 key 时「去配置」跳服务商配置 */
  onGoSettings: () => void
}

export default function WeeklyPage({ onBack, onGoSettings }: Props) {
  const [reviews, setReviews] = useState<WeeklyReview[]>(() => getWeeklyReviews())
  const [view, setView] = useState<'list' | 'detail'>('list')
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [generating, setGenerating] = useState(false)
  const [genError, setGenError] = useState<string | null>(null)
  // 批注编辑：editingReply = 正在改批注；replyText = 批注草稿
  const [editingReply, setEditingReply] = useState(false)
  const [replyText, setReplyText] = useState('')
  // 批阅模式：immediate 立即简短回复 / sealed 封存慢信（全局慢信开启时强制封存）
  const [replyMode, setReplyMode] = useState<'immediate' | 'sealed'>('immediate')
  // 全局慢信开关只在设置页改，进周记页读一次即可
  const slowLetter = isSlowLetterMode()
  // 提交成功提示（按模式）
  const [hint, setHint] = useState<string | null>(null)
  // 立即回复：TA 正在写简短回复
  const [taReplying, setTaReplying] = useState(false)
  // 列表页头部 tooltip
  const [showTooltip, setShowTooltip] = useState(false)
  // 生成成功且存在封存留言 → 新周记详情页顶部的「已回信」横幅
  const [justReplied, setJustReplied] = useState(false)

  const settings = loadSettings()
  const hasKey = Boolean(settings.apiKey?.trim() && settings.baseUrl?.trim() && settings.model?.trim())
  const cooldown = cooldownInfo(Date.now())
  const canGenerate = cooldown.canGenerate

  // 批阅实际生效模式：全局慢信开启时强制封存
  const effectiveMode = slowLetter ? 'sealed' : replyMode

  // 详情选中的那篇：从 reviews 里现找，批注保存后能立刻反映
  const selectedReview = useMemo(
    () => (selectedId ? reviews.find((r) => r.id === selectedId) ?? null : null),
    [reviews, selectedId],
  )

  // 周记口吻：优先当前会话的人设（侧边栏会话缓存里有），没有回落到全局人设
  const persona = useMemo(() => {
    const sid = getActiveSessionId()
    const sessionPersona = sid ? getSessionsCache().find((s) => String(s.id) === sid)?.persona : ''
    return (sessionPersona || loadPersona()).trim()
  }, [])

  const openDetail = (r: WeeklyReview) => {
    setSelectedId(r.id)
    setEditingReply(false)
    setReplyText('')
    setReplyMode('immediate')
    setHint(null)
    setTaReplying(false)
    setShowTooltip(false)
    setJustReplied(false)
    setView('detail')
  }

  // 生成本周周记：调用户 key 非流式（复用 chatCompletion），成功后保存 + 跳详情；429 走现有重试逻辑。
  // 冷却期直接拦截：canGenerate=false 时不进入（UI 也禁用了按钮），零 token。
  const handleGenerate = async () => {
    if (generating) return
    if (!cooldownInfo().canGenerate) return
    const s = loadSettings()
    if (!s.apiKey?.trim() || !s.baseUrl?.trim() || !s.model?.trim()) {
      setGenError('还没接上大脑，去「我的」页填一下 API Key 就能写周记了')
      return
    }
    setGenerating(true)
    setGenError(null)
    setJustReplied(false)
    try {
      const ts = Date.now()
      const week = getWeekRange(ts, getFirstSeen(getActiveSessionId() || undefined))
      const sid = getActiveSessionId()
      // 本周消息：落在本周窗口内，取最近 40 条按时间升序
      const weekMsgs = (sid ? getMessagesCache(sid) : loadMessages())
        .filter((m) => m.ts >= week.startTs && m.ts <= week.endTs)
        .sort((a, b) => a.ts - b.ts)
        .slice(-40)
      const summaryLines = weekMsgs.map((m) => formatMessageLine(m))
      // 本周新增记忆：该会话记忆里 createdAt 在本周内
      const newMemories = (sid ? getMemoriesCache(sid) : loadMemory())
        .filter((m) => m.createdAt >= week.startTs && m.createdAt <= week.endTs)
        .map((m) => m.text)
      const curReviews = getWeeklyReviews()
      const lastReply = curReviews[0]?.myReply?.content
      // 封存留言：下一篇周记生成时一并完整回信
      const pending = getPendingReplies(curReviews)
      const pendingTexts = pending.map((p) => p.content)

      const raw = await chatCompletion(
        s,
        [
          { role: 'system', content: WEEKLY_SYSTEM_PROMPT },
          {
            role: 'user',
            content: buildWeeklyPrompt({
              weekLabel: week.weekLabel,
              summaryLines,
              newMemories,
              daysKnown: getKnownDays(ts, sid),
              ...(lastReply?.trim() ? { lastReply: lastReply.trim() } : {}),
              ...(pendingTexts.length > 0 ? { pendingReplies: pendingTexts } : {}),
              ...(persona ? { persona } : {}),
            }),
          },
        ],
        { maxTokens: 1200, timeoutMs: 90000 },
      )

      const parsed = parseWeeklyOutput(raw, `第 ${week.weekNumber} 周`)
      if (!parsed.content) {
        setGenError('TA 这周没写出来，再试一次？')
        return
      }
      const review: WeeklyReview = {
        id: newWeeklyReviewId(),
        weekLabel: week.weekLabel,
        title: parsed.title,
        content: parsed.content,
        createdAt: ts,
        generatedFrom: { startTs: week.startTs, endTs: week.endTs },
      }
      // 回信挂载：解析出的回信按顺序挂到封存留言上并标记已回信（信封标记消失）；没回上的保持待回信
      let answered = curReviews
      if (pending.length > 0) {
        answered = answerPendingReplies(curReviews, pending, parsed.replies, ts)
        setJustReplied(true)
      }
      const next = [review, ...answered]
      saveWeeklyReviews(next)
      setReviews(next)
      setSelectedId(review.id)
      setView('detail')
    } catch (e) {
      setGenError(e instanceof Error ? e.message : '生成失败了，稍后再试试')
    } finally {
      setGenerating(false)
    }
  }

  // 批注保存：按模式处理——立即回复保存 myReply + 调 key 生成一句简短回复；封存只入库不调模型
  const handleSaveReply = async () => {
    const t = replyText.trim()
    if (!t || !selectedReview || taReplying) return
    const now = Date.now()
    if (effectiveMode === 'sealed') {
      const pending = { id: newWeeklyReviewId(), content: t, repliedAt: now }
      const next = reviews.map((r) =>
        r.id === selectedReview.id ? { ...r, replies: [...(r.replies ?? []), pending] } : r,
      )
      saveWeeklyReviews(next)
      setReviews(next)
      setHint(SUCCESS_SEALED)
      setEditingReply(false)
      setReplyText('')
      return
    }

    // 立即回复模式：先保存批注（myReply），再调用户 key 非流式生成一句简短回复
    const base = reviews.map((r) =>
      r.id === selectedReview.id ? { ...r, myReply: { content: t, repliedAt: now } } : r,
    )
    saveWeeklyReviews(base)
    setReviews(base)
    setEditingReply(false)
    setReplyText('')
    setHint(SUCCESS_IMMEDIATE)
    setTaReplying(true)
    try {
      const s = loadSettings()
      if (!s.apiKey?.trim() || !s.baseUrl?.trim() || !s.model?.trim()) throw new Error('no-key')
      const reply = await chatCompletion(
        s,
        [
          { role: 'system', content: WEEKLY_REPLY_SYSTEM_PROMPT },
          { role: 'user', content: `我的批注：${t}` },
        ],
        { maxTokens: 100, timeoutMs: 30000 },
      )
      const clean = reply.trim()
      if (!clean) throw new Error('empty')
      const withReply = reviews.map((r) =>
        r.id === selectedReview.id
          ? { ...r, myReply: { content: t, repliedAt: now, taReply: clean, taReplyFailed: false } }
          : r,
      )
      saveWeeklyReviews(withReply)
      setReviews(withReply)
    } catch {
      // 无 key/429/网络 → 批注仍保存，回复区显示兜底文案，不阻塞
      const failed = reviews.map((r) =>
        r.id === selectedReview.id
          ? { ...r, myReply: { content: t, repliedAt: now, taReplyFailed: true } }
          : r,
      )
      saveWeeklyReviews(failed)
      setReviews(failed)
    } finally {
      setTaReplying(false)
    }
  }

  // ---- 列表视图 ----
  const renderList = () => (
    <div className="page weekly-page">
      <div className="detail-header">
        <button type="button" className="detail-back" onClick={onBack} aria-label="返回忆览页">
          <BackIcon />
        </button>
        <h2 className="detail-title">相与书</h2>
        <button
          type="button"
          className="weekly-tooltip-btn"
          onClick={() => setShowTooltip((s) => !s)}
          aria-expanded={showTooltip}
          aria-label="周记说明"
        >
          <QuestionIcon />
        </button>
      </div>

      {showTooltip && (
        <div className="weekly-tooltip" role="tooltip">
          {TOOLTIP_TEXT}
        </div>
      )}

      {genError && <p className="weekly-error">{genError}</p>}

      {!hasKey ? (
        <div className="weekly-guide-card">
          <p className="weekly-guide-title">TA 还没写过周记</p>
          <p className="weekly-guide-desc">接上大脑后，TA 才能给你写周记。</p>
          <button type="button" className="btn btn-primary" onClick={onGoSettings}>
            去配置
          </button>
        </div>
      ) : canGenerate ? (
        <div className="weekly-guide-card">
          <p className="weekly-guide-desc">{reviews.length === 0 ? EMPTY_STATE : '这周的周记还没写。'}</p>
          <button type="button" className="btn btn-primary" onClick={handleGenerate} disabled={generating}>
            {generating ? 'TA 正在写…' : '让 TA 写这周的周记'}
          </button>
        </div>
      ) : (
        <div className="weekly-guide-card">
          <p className="weekly-guide-desc">
            ⏳ TA还在沉淀思绪 TA每周只能写下一篇周记，距离下一篇周记还有 {cooldown.remainText}。
          </p>
          <button type="button" className="btn btn-primary" disabled>
            让 TA 写这周的周记
          </button>
        </div>
      )}

      {reviews.length > 0 && (
        <ul className="weekly-list">
          {reviews.map((r) => (
            <li key={r.id}>
              <button type="button" className="weekly-card" onClick={() => openDetail(r)}>
                <span className="weekly-card-title">{r.title}</span>
                <span className="weekly-card-foot">
                  <span className="weekly-card-label">{r.weekLabel}</span>
                  {r.myReply && <span className="weekly-card-reply">已批注</span>}
                  {Array.isArray(r.replies) && r.replies.some((p) => !p.replied) && (
                    <span className="weekly-card-reply weekly-card-reply-pending">
                      <EnvelopeIcon /> 待回信
                    </span>
                  )}
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  )

  // ---- 详情视图 ----
  if (view === 'detail') {
    const r = selectedReview
    if (!r) return renderList() // 详情数据丢失（如换了会话）→ 回列表
    return (
      <div className="page weekly-page">
        <div className="detail-header">
          <button
            type="button"
            className="detail-back"
            onClick={() => {
              setView('list')
              setSelectedId(null)
            }}
            aria-label="返回周记列表"
          >
            <BackIcon />
          </button>
          <h2 className="detail-title">{r.title}</h2>
          <span className="detail-spacer" aria-hidden="true" />
        </div>
        <p className="weekly-detail-label">{r.weekLabel}</p>

        {justReplied && <p className="weekly-banner">{BANNER_REPLIED}</p>}

        {r.content
          .split('\n')
          .map((p) => p.trim())
          .filter(Boolean)
          .map((p, i) => (
            <p key={i} className="weekly-detail-para">
              {p}
            </p>
          ))}

        <div className="weekly-reply">
          <h3 className="weekly-reply-title">批注</h3>

          {hint && <p className="weekly-reply-hint">{hint}</p>}

          {r.myReply && !editingReply ? (
            <div className="weekly-reply-show">
              <p className="weekly-reply-content">你的批注：{r.myReply.content}</p>
              {taReplying && <p className="weekly-reply-ta">TA 正在写回复…</p>}
              {r.myReply.taReply && <p className="weekly-reply-ta">TA 的回信：{r.myReply.taReply}</p>}
              {!r.myReply.taReply && !r.myReply.taReplyFailed && !taReplying && (
                <p className="weekly-reply-ta weekly-reply-ta-fail">{REPLY_FAILED}</p>
              )}
              {r.myReply.taReplyFailed && <p className="weekly-reply-ta weekly-reply-ta-fail">{REPLY_FAILED}</p>}
              <div className="weekly-reply-foot">
                <span className="weekly-reply-meta">TA 下周会看到</span>
                <button
                  type="button"
                  className="link-btn"
                  onClick={() => {
                    setReplyText(r.myReply?.content ?? '')
                    setEditingReply(true)
                    setHint(null)
                  }}
                >
                  修改
                </button>
              </div>
            </div>
          ) : (
            <div className="weekly-reply-edit">
              <textarea
                className="input weekly-reply-input"
                rows={3}
                placeholder={REPLY_PLACEHOLDER}
                value={replyText}
                onChange={(e) => {
                  setReplyText(e.target.value)
                  setHint(null)
                }}
                autoFocus={editingReply}
              />
              {slowLetter ? (
                <p className="weekly-reply-mode-note">{SLOW_LETTER_NOTE}</p>
              ) : (
                <div className="weekly-reply-mode" role="radiogroup" aria-label="批阅方式">
                  <label className={`weekly-reply-mode-option${effectiveMode === 'immediate' ? ' selected' : ''}`}>
                    <input
                      type="radio"
                      name="weekly-reply-mode"
                      checked={effectiveMode === 'immediate'}
                      onChange={() => setReplyMode('immediate')}
                    />
                    <span>{OPTION_IMMEDIATE}</span>
                  </label>
                  <label className={`weekly-reply-mode-option${effectiveMode === 'sealed' ? ' selected' : ''}`}>
                    <input
                      type="radio"
                      name="weekly-reply-mode"
                      checked={effectiveMode === 'sealed'}
                      onChange={() => setReplyMode('sealed')}
                    />
                    <span>{OPTION_SEALED}</span>
                  </label>
                  <p className="weekly-reply-mode-note">{SEALED_NOTE}</p>
                </div>
              )}
              <div className="weekly-reply-actions">
                <button
                  type="button"
                  className="btn btn-primary btn-sm"
                  onClick={() => void handleSaveReply()}
                  disabled={!replyText.trim() || taReplying}
                >
                  {effectiveMode === 'sealed' ? '封存留言' : '写下批注'}
                </button>
                {editingReply && (
                  <button
                    type="button"
                    className="btn btn-ghost btn-sm"
                    onClick={() => {
                      setEditingReply(false)
                      setReplyText('')
                    }}
                  >
                    取消
                  </button>
                )}
              </div>
            </div>
          )}

          {/* 封存留言列表：回信后信封图标消失、展示 TA 的回信 */}
          {Array.isArray(r.replies) && r.replies.length > 0 && (
            <div className="weekly-reply-sealed-list">
              {r.replies.map((p) => (
                <div className="weekly-reply-sealed" key={p.id}>
                  <p className="weekly-reply-content">你的批注：{p.content}</p>
                  {p.replied ? (
                    <p className="weekly-reply-ta">TA 的回信：{p.reply}</p>
                  ) : (
                    <span className="weekly-reply-pending">
                      <EnvelopeIcon />
                      待回信
                    </span>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    )
  }

  return renderList()
}
