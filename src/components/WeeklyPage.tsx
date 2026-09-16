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
import { loadCurrentPosts } from '../lib/aiSpace'
import { loadChatTopics } from '../lib/chatTopics'
import { dayKeyOf } from '../lib/aiSpaceCore'
import { getActiveSessionId, getMemoriesCache, getMessagesCache, getSessionsCache } from '../lib/sessionStore'
import { resolveRolePersona } from '../lib/sessionProfile'
import { loadMemory } from '../lib/memory'
import { getEventsForWeek } from '../lib/eventStore'

const REPLY_PLACEHOLDER = '把此刻的心情写下来…'
const OPTION_IMMEDIATE = '立即回复'
const OPTION_SEALED = '慢信模式'
const SEALED_NOTE = '慢信不会立刻送达；当前会等到下一封一周情书时一起回给你。'
const SUCCESS_IMMEDIATE = '你的回信已经寄出。TA 的回信到了以后，会先等你亲手拆开。'
const SUCCESS_SEALED = '这封慢信已经寄出，会等到下一封一周情书时一起送达。'
const REPLY_FAILED = 'TA 暂时没回上，这封回信已经替你留好了。'
const EMPTY_STATE = '第一封信，会在这一周结束后写给你。'
const TOOLTIP_TEXT = '一周情书：TA 把这一周想对你说的话写成一封信。你可以立刻回信，也可以选择慢信。'
const BANNER_REPLIED = '新的回信也一起到了，等你慢慢拆开。'
const SLOW_LETTER_NOTE = '全局慢信模式已开启，这一封会等到下一封一周情书时一起送达。'
const MODE_LOCKED_NOTE = '这封信已经寄出，回复方式不能再切换。'

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
  onBack: () => void
  onGoSettings: () => void
}

type LetterReply = NonNullable<WeeklyReview['myReply']> & { openedAt?: number }
type LetterPendingReply = NonNullable<WeeklyReview['replies']>[number] & { openedAt?: number }
type LetterReview = Omit<WeeklyReview, 'myReply' | 'replies'> & {
  myReply?: LetterReply
  replies?: LetterPendingReply[]
}

function letterPreview(r: WeeklyReview): string {
  const clean = r.content.replace(/\s+/g, ' ').trim()
  if (!clean) return r.title
  return clean.length > 56 ? `${clean.slice(0, 56)}…` : clean
}

export default function WeeklyPage({ onBack, onGoSettings }: Props) {
  const sid = getActiveSessionId() || undefined
  const [reviews, setReviews] = useState<LetterReview[]>(() => getWeeklyReviews(sid) as LetterReview[])
  const [view, setView] = useState<'list' | 'detail'>('list')
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [generating, setGenerating] = useState(false)
  const [genError, setGenError] = useState<string | null>(null)
  const [replyText, setReplyText] = useState('')
  const [replyMode, setReplyMode] = useState<'immediate' | 'sealed'>('immediate')
  const [modeChosen, setModeChosen] = useState(false)
  const slowLetter = isSlowLetterMode()
  const [hint, setHint] = useState<string | null>(null)
  const [taReplying, setTaReplying] = useState(false)
  const [showTooltip, setShowTooltip] = useState(false)
  const [justReplied, setJustReplied] = useState(false)

  const settings = loadSettings()
  const hasKey = Boolean(settings.apiKey?.trim() && settings.baseUrl?.trim() && settings.model?.trim())
  const cooldown = cooldownInfo(Date.now(), sid)
  const canGenerate = cooldown.canGenerate

  const selectedReview = useMemo(
    () => (selectedId ? reviews.find((r) => r.id === selectedId) ?? null : null),
    [reviews, selectedId],
  )

  const lockedMode = selectedReview
    ? (selectedReview.reviewMode ??
      (selectedReview.myReply
        ? 'immediate'
        : Array.isArray(selectedReview.replies) && selectedReview.replies.length > 0
          ? 'sealed'
          : null))
    : null
  const modeLocked = modeChosen || lockedMode != null
  const alreadyReplied = (r?: LetterReview | null): boolean =>
    Boolean(r?.myReply) || (Array.isArray(r?.replies) && (r?.replies ?? []).length > 0)
  const effectiveMode = (modeChosen ? replyMode : null) ?? lockedMode ?? (slowLetter ? 'sealed' : replyMode)

  const persona = useMemo(() => {
    const currentSid = getActiveSessionId()
    return resolveRolePersona(currentSid, getSessionsCache(), loadPersona()).trim()
  }, [])

  const persist = (next: LetterReview[]) => {
    saveWeeklyReviews(next as WeeklyReview[], sid)
    setReviews(next)
  }

  const openDetail = (r: LetterReview) => {
    setSelectedId(r.id)
    setReplyText('')
    setReplyMode('immediate')
    setModeChosen(false)
    setHint(null)
    setTaReplying(false)
    setShowTooltip(false)
    setJustReplied(false)
    setView('detail')
  }

  const handleGenerate = async () => {
    if (generating) return
    if (!cooldownInfo(Date.now(), sid).canGenerate) return
    const s = loadSettings()
    if (!s.apiKey?.trim() || !s.baseUrl?.trim() || !s.model?.trim()) {
      setGenError('还没接上大脑，去「我的」页填一下 API Key 就能写信了')
      return
    }
    setGenerating(true)
    setGenError(null)
    setJustReplied(false)
    try {
      const ts = Date.now()
      const week = getWeekRange(ts, getFirstSeen(getActiveSessionId() || undefined))
      const currentSid = getActiveSessionId()
      const weekMsgs = (currentSid ? getMessagesCache(currentSid) : loadMessages())
        .filter((m) => m.ts >= week.startTs && m.ts <= week.endTs)
        .sort((a, b) => a.ts - b.ts)
        .slice(-40)
      const summaryLines = weekMsgs.map((m) => formatMessageLine(m))
      const newMemories = (currentSid ? getMemoriesCache(currentSid) : loadMemory())
        .filter((m) => m.createdAt >= week.startTs && m.createdAt <= week.endTs)
        .map((m) => m.text)
      const curReviews = getWeeklyReviews(currentSid) as LetterReview[]
      const lastReply = curReviews[0]?.myReply?.content
      const pending = getPendingReplies(curReviews as WeeklyReview[])
      const pendingTexts = pending.map((p) => p.content)
      const weekPosts = loadCurrentPosts(currentSid || undefined)
        .filter((p) => p.at >= week.startTs && p.at <= week.endTs)
        .slice(0, 5)
        .map((p) => p.text)
      const weekAgenda = loadChatTopics(currentSid || undefined)
        .filter((t) => typeof t.futureDay === 'string' && t.futureDay >= dayKeyOf(week.startTs) && t.futureDay <= dayKeyOf(week.endTs))
        .map((t) => `${t.t}（约在 ${t.futureDay}）`)
      const weekEvents = getEventsForWeek(currentSid || undefined, week.startTs, week.endTs)
        .slice(0, 5)
        .map((e) => (e.description ? `${e.title}（${e.description}）` : e.title))

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
              daysKnown: getKnownDays(ts, currentSid),
              ...(lastReply?.trim() ? { lastReply: lastReply.trim() } : {}),
              ...(pendingTexts.length > 0 ? { pendingReplies: pendingTexts } : {}),
              ...(weekPosts.length > 0 ? { weekPosts } : {}),
              ...(weekAgenda.length > 0 ? { weekAgenda } : {}),
              ...(weekEvents.length > 0 ? { weekEvents } : {}),
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
      const review: LetterReview = {
        id: newWeeklyReviewId(),
        weekLabel: week.weekLabel,
        title: parsed.title,
        content: parsed.content,
        createdAt: ts,
        generatedFrom: { startTs: week.startTs, endTs: week.endTs },
      }
      let answered = curReviews
      if (pending.length > 0) {
        answered = answerPendingReplies(
          curReviews as WeeklyReview[],
          pending,
          parsed.replies,
          ts,
        ) as LetterReview[]
        setJustReplied(true)
      }
      const next = [review, ...answered]
      persist(next)
      setSelectedId(review.id)
      setView('detail')
    } catch (e) {
      setGenError(e instanceof Error ? e.message : '生成失败了，稍后再试试')
    } finally {
      setGenerating(false)
    }
  }

  const handleSaveReply = async () => {
    const t = replyText.trim()
    if (!t || !selectedReview || taReplying) return
    if (alreadyReplied(selectedReview)) return
    const now = Date.now()

    if (effectiveMode === 'sealed') {
      const pending: LetterPendingReply = { id: newWeeklyReviewId(), content: t, repliedAt: now }
      const next: LetterReview[] = reviews.map((r) =>
        r.id === selectedReview.id
          ? { ...r, reviewMode: 'sealed', replies: [...(r.replies ?? []), pending] }
          : r,
      )
      persist(next)
      setHint(SUCCESS_SEALED)
      setReplyText('')
      setModeChosen(true)
      return
    }

    const base: LetterReview[] = reviews.map((r) =>
      r.id === selectedReview.id
        ? { ...r, reviewMode: 'immediate', myReply: { content: t, repliedAt: now } }
        : r,
    )
    persist(base)
    setReplyText('')
    setHint(SUCCESS_IMMEDIATE)
    setModeChosen(true)
    setTaReplying(true)
    try {
      const s = loadSettings()
      if (!s.apiKey?.trim() || !s.baseUrl?.trim() || !s.model?.trim()) throw new Error('no-key')
      const reviewContext = `这封一周情书《${selectedReview.title}》：\n${selectedReview.content}`
      const reply = await chatCompletion(
        s,
        [
          { role: 'system', content: WEEKLY_REPLY_SYSTEM_PROMPT },
          { role: 'user', content: `${reviewContext}\n\n对方写给你的回信：${t}` },
        ],
        { maxTokens: 100, timeoutMs: 30000 },
      )
      const clean = reply.trim()
      if (!clean) throw new Error('empty')
      const withReply: LetterReview[] = base.map((r) =>
        r.id === selectedReview.id
          ? {
              ...r,
              reviewMode: 'immediate',
              myReply: { content: t, repliedAt: now, taReply: clean, taReplyFailed: false },
            }
          : r,
      )
      persist(withReply)
    } catch {
      const failed: LetterReview[] = base.map((r) =>
        r.id === selectedReview.id
          ? { ...r, reviewMode: 'immediate', myReply: { content: t, repliedAt: now, taReplyFailed: true } }
          : r,
      )
      persist(failed)
    } finally {
      setTaReplying(false)
    }
  }

  const openImmediateReply = (reviewId: string) => {
    const next = reviews.map((r) =>
      r.id === reviewId && r.myReply?.taReply
        ? { ...r, myReply: { ...r.myReply, openedAt: r.myReply.openedAt ?? Date.now() } }
        : r,
    )
    persist(next)
  }

  const openSealedReply = (reviewId: string, replyId: string) => {
    const next = reviews.map((r) =>
      r.id === reviewId
        ? {
            ...r,
            replies: r.replies?.map((p) =>
              p.id === replyId && p.replied
                ? { ...p, openedAt: p.openedAt ?? Date.now() }
                : p,
            ),
          }
        : r,
    )
    persist(next)
  }

  const renderList = () => (
    <div className="page weekly-page weekly-letter-page">
      <div className="detail-header weekly-letter-header">
        <button type="button" className="detail-back detail-back-text" onClick={onBack} aria-label="返回">
          <BackIcon />
          返回
        </button>
        <h2 className="detail-title">一周情书</h2>
        <button
          type="button"
          className="weekly-tooltip-btn"
          onClick={() => setShowTooltip((s) => !s)}
          aria-expanded={showTooltip}
          aria-label="一周情书说明"
        >
          <QuestionIcon />
        </button>
      </div>

      {showTooltip && <div className="weekly-tooltip" role="tooltip">{TOOLTIP_TEXT}</div>}
      {genError && <p className="weekly-error">{genError}</p>}

      {!hasKey ? (
        <div className="weekly-guide-card weekly-letter-guide">
          <p className="weekly-guide-title">还没有第一封信</p>
          <p className="weekly-guide-desc">接上大脑后，TA 才能把这一周写成一封信。</p>
          <button type="button" className="btn btn-primary" onClick={onGoSettings}>去配置</button>
        </div>
      ) : canGenerate ? (
        <div className="weekly-guide-card weekly-letter-guide">
          <p className="weekly-guide-desc">{reviews.length === 0 ? EMPTY_STATE : '这一周的新信还没有落笔。'}</p>
          <button type="button" className="btn btn-primary" onClick={handleGenerate} disabled={generating}>
            {generating ? 'TA 正在写信…' : '让 TA 写这一周'}
          </button>
        </div>
      ) : (
        <div className="weekly-guide-card weekly-letter-guide">
          <p className="weekly-guide-desc">下一封信还在慢慢酝酿，距离可以再次落笔还有 {cooldown.remainText}。</p>
          <button type="button" className="btn btn-primary" disabled>还没到下一封</button>
        </div>
      )}

      {reviews.length > 0 && (
        <ul className="weekly-list weekly-letter-list">
          {reviews.map((r) => {
            const immediateWaiting = Boolean(r.myReply?.taReply && !r.myReply.openedAt)
            const sealedWaiting = Boolean(r.replies?.some((p) => p.replied && !p.openedAt))
            const sealedOnRoad = Boolean(r.replies?.some((p) => !p.replied))
            return (
              <li key={r.id}>
                <button type="button" className="weekly-card weekly-envelope-card" onClick={() => openDetail(r)}>
                  <span className="weekly-envelope-paper">
                    <span className="weekly-card-label">{r.weekLabel}</span>
                    <span className="weekly-card-title">{letterPreview(r)}</span>
                  </span>
                  <span className="weekly-envelope-flap" aria-hidden="true" />
                  <span className="weekly-envelope-seal" aria-hidden="true">♡</span>
                  {(immediateWaiting || sealedWaiting) && <span className="weekly-card-reply">回信待拆</span>}
                  {sealedOnRoad && !sealedWaiting && <span className="weekly-card-reply weekly-card-reply-pending">慢信在路上</span>}
                </button>
              </li>
            )
          })}
        </ul>
      )}
    </div>
  )

  if (view === 'detail') {
    const r = selectedReview
    if (!r) return renderList()
    const immediateWaiting = Boolean(r.myReply?.taReply && !r.myReply.openedAt)

    return (
      <div className="page weekly-page weekly-letter-page">
        <div className="detail-header weekly-letter-header">
          <button
            type="button"
            className="detail-back detail-back-text"
            onClick={() => {
              setView('list')
              setSelectedId(null)
            }}
            aria-label="返回一周情书"
          >
            <BackIcon />
            返回
          </button>
          <h2 className="detail-title">一周情书</h2>
          <span className="detail-spacer" aria-hidden="true" />
        </div>

        {justReplied && <p className="weekly-banner">{BANNER_REPLIED}</p>}

        <article className="weekly-letter-sheet">
          <span className="weekly-letter-watermark" aria-hidden="true">忆文</span>
          <h1 className="weekly-letter-title">这一周，写给你。</h1>
          <p className="weekly-letter-date">{r.weekLabel}</p>
          <div className="weekly-letter-body">
            {r.content
              .split('\n')
              .map((p) => p.trim())
              .filter(Boolean)
              .map((p, i) => <p key={i}>{p}</p>)}
          </div>
          <p className="weekly-letter-sign">Always with you. ♡</p>
        </article>

        <section className="weekly-reply weekly-letter-reply">
          <div className="weekly-letter-reply-head">
            <h3 className="weekly-reply-title">我也想回一封</h3>
            <span>把此刻的心情写下来…</span>
          </div>

          {hint && <p className="weekly-reply-hint">{hint}</p>}

          {!alreadyReplied(r) ? (
            <div className="weekly-reply-edit">
              <textarea
                className="input weekly-reply-input"
                rows={5}
                maxLength={500}
                placeholder={REPLY_PLACEHOLDER}
                value={replyText}
                onChange={(e) => {
                  setReplyText(e.target.value)
                  setHint(null)
                }}
              />
              <div className="weekly-letter-counter">{replyText.length}/500</div>
              {slowLetter ? (
                <p className="weekly-reply-mode-note">{SLOW_LETTER_NOTE}</p>
              ) : (
                <div className="weekly-reply-mode" role="radiogroup" aria-label="回信方式">
                  <label className={`weekly-reply-mode-option${effectiveMode === 'immediate' ? ' selected' : ''}${modeLocked ? ' is-locked' : ''}`}>
                    <input
                      type="radio"
                      name="weekly-reply-mode"
                      checked={effectiveMode === 'immediate'}
                      disabled={modeLocked}
                      onChange={() => setReplyMode('immediate')}
                    />
                    <span>{OPTION_IMMEDIATE}</span>
                  </label>
                  <label className={`weekly-reply-mode-option${effectiveMode === 'sealed' ? ' selected' : ''}${modeLocked ? ' is-locked' : ''}`}>
                    <input
                      type="radio"
                      name="weekly-reply-mode"
                      checked={effectiveMode === 'sealed'}
                      disabled={modeLocked}
                      onChange={() => setReplyMode('sealed')}
                    />
                    <span>{OPTION_SEALED}</span>
                  </label>
                  <p className="weekly-reply-mode-note">{modeLocked ? MODE_LOCKED_NOTE : SEALED_NOTE}</p>
                </div>
              )}
              <button
                type="button"
                className="weekly-letter-send"
                onClick={() => void handleSaveReply()}
                disabled={!replyText.trim() || taReplying}
              >
                {effectiveMode === 'sealed' ? '寄出慢信' : '寄出回信'}
              </button>
            </div>
          ) : (
            <div className="weekly-reply-show weekly-letter-sent">
              {r.myReply && <p className="weekly-reply-content">你写的回信：{r.myReply.content}</p>}
              {Array.isArray(r.replies) && r.replies.length > 0 && (
                <p className="weekly-reply-content">你的慢信已经寄出。</p>
              )}
            </div>
          )}

          {taReplying && <p className="weekly-reply-ta">TA 正在写回信…</p>}

          {r.myReply?.taReplyFailed && <p className="weekly-reply-ta weekly-reply-ta-fail">{REPLY_FAILED}</p>}

          {immediateWaiting && (
            <button type="button" className="weekly-letter-arrived" onClick={() => openImmediateReply(r.id)}>
              <span className="weekly-letter-arrived-icon"><EnvelopeIcon /></span>
              <span>
                <strong>已收到回信，等你拆开</strong>
                <small>写下的心情，值得被好好打开。</small>
              </span>
              <span className="weekly-letter-arrived-action">拆开看看 ›</span>
            </button>
          )}

          {r.myReply?.taReply && r.myReply.openedAt && (
            <div className="weekly-letter-opened-reply">
              <p className="weekly-letter-opened-label">TA 的回信</p>
              <p>{r.myReply.taReply}</p>
            </div>
          )}

          {Array.isArray(r.replies) && r.replies.length > 0 && (
            <div className="weekly-reply-sealed-list">
              {r.replies.map((p) => (
                <div className="weekly-reply-sealed" key={p.id}>
                  {p.replied ? (
                    p.openedAt ? (
                      <div className="weekly-letter-opened-reply">
                        <p className="weekly-letter-opened-label">TA 的慢信</p>
                        <p>{p.reply}</p>
                      </div>
                    ) : (
                      <button type="button" className="weekly-letter-arrived" onClick={() => openSealedReply(r.id, p.id)}>
                        <span className="weekly-letter-arrived-icon"><EnvelopeIcon /></span>
                        <span>
                          <strong>慢信到了，等你拆开</strong>
                          <small>这一封，也想让你亲手打开。</small>
                        </span>
                        <span className="weekly-letter-arrived-action">拆开看看 ›</span>
                      </button>
                    )
                  ) : (
                    <span className="weekly-reply-pending">
                      <EnvelopeIcon />
                      慢信在路上
                    </span>
                  )}
                </div>
              ))}
            </div>
          )}
        </section>
      </div>
    )
  }

  return renderList()
}
