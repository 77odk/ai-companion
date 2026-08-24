import { useMemo, useState } from 'react'
import {
  WEEKLY_SYSTEM_PROMPT,
  buildWeeklyPrompt,
  extractTitle,
  formatMessageLine,
  getWeekRange,
  getWeeklyReviews,
  newWeeklyReviewId,
  saveWeeklyReviews,
  shouldGenerateWeekly,
  stripTitleLine,
  type WeeklyReview,
} from '../lib/weeklyReview'
import { getKnownDays } from '../lib/milestone'
import { getFirstSeen, loadMessages, loadPersona, loadSettings } from '../lib/storage'
import { chatCompletion } from '../lib/api'
import { getActiveSessionId, getMemoriesCache, getMessagesCache, getSessionsCache } from '../lib/sessionStore'
import { loadMemory } from '../lib/memory'

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

  const settings = loadSettings()
  const hasKey = Boolean(settings.apiKey?.trim() && settings.baseUrl?.trim() && settings.model?.trim())
  const canGenerate = shouldGenerateWeekly(Date.now())

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
    setView('detail')
  }

  // 生成本周周记：调用户 key 非流式（复用 chatCompletion），成功后保存 + 跳详情；429 走现有重试逻辑
  const handleGenerate = async () => {
    if (generating) return
    const s = loadSettings()
    if (!s.apiKey?.trim() || !s.baseUrl?.trim() || !s.model?.trim()) {
      setGenError('还没接上大脑，去「我的」页填一下 API Key 就能写周记了')
      return
    }
    setGenerating(true)
    setGenError(null)
    try {
      const ts = Date.now()
      const week = getWeekRange(ts, getFirstSeen())
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
              daysKnown: getKnownDays(ts),
              ...(lastReply?.trim() ? { lastReply: lastReply.trim() } : {}),
              ...(persona ? { persona } : {}),
            }),
          },
        ],
        { maxTokens: 600, timeoutMs: 60000 },
      )

      const title = extractTitle(raw, `第 ${week.weekNumber} 周`)
      const content = stripTitleLine(raw)
      if (!content) {
        setGenError('TA 这周没写出来，再试一次？')
        return
      }
      const review: WeeklyReview = {
        id: newWeeklyReviewId(),
        weekLabel: week.weekLabel,
        title,
        content,
        createdAt: ts,
        generatedFrom: { startTs: week.startTs, endTs: week.endTs },
      }
      const next = [review, ...curReviews]
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

  // 批注保存：纯本地（不调 API、不花钱），更新 localStorage + 上屏
  const handleSaveReply = () => {
    const t = replyText.trim()
    if (!t || !selectedReview) return
    const next = reviews.map((r) =>
      r.id === selectedReview.id ? { ...r, myReply: { content: t, repliedAt: Date.now() } } : r,
    )
    saveWeeklyReviews(next)
    setReviews(next)
    setEditingReply(false)
    setReplyText('')
  }

  // ---- 列表视图 ----
  const renderList = () => (
    <div className="page weekly-page">
      <div className="detail-header">
        <button type="button" className="detail-back" onClick={onBack} aria-label="返回记忆页">
          <BackIcon />
        </button>
        <h2 className="detail-title">TA 的周记</h2>
        <span className="detail-spacer" aria-hidden="true" />
      </div>

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
          <p className="weekly-guide-desc">{reviews.length === 0 ? 'TA 还没写过周记。' : '这周的周记还没写。'}</p>
          <button
            type="button"
            className="btn btn-primary"
            onClick={handleGenerate}
            disabled={generating}
          >
            {generating ? 'TA 正在写…' : '让 TA 写这周的周记'}
          </button>
        </div>
      ) : (
        <div className="weekly-done-hint">
          <p>TA 这周的周记已经写好了。</p>
          {reviews[0] && (
            <button type="button" className="link-btn" onClick={() => openDetail(reviews[0])}>
              看看这周
            </button>
          )}
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
          {r.myReply && !editingReply ? (
            <div className="weekly-reply-show">
              <p className="weekly-reply-content">你的批注：{r.myReply.content}</p>
              <div className="weekly-reply-foot">
                <span className="weekly-reply-meta">TA 下周会看到</span>
                <button
                  type="button"
                  className="link-btn"
                  onClick={() => {
                    setReplyText(r.myReply?.content ?? '')
                    setEditingReply(true)
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
                placeholder="写点批注（TA 下周会看到）"
                value={replyText}
                onChange={(e) => setReplyText(e.target.value)}
                autoFocus={editingReply}
              />
              <div className="weekly-reply-actions">
                <button
                  type="button"
                  className="btn btn-primary btn-sm"
                  onClick={handleSaveReply}
                  disabled={!replyText.trim()}
                >
                  保存批注
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
        </div>
      </div>
    )
  }

  return renderList()
}
