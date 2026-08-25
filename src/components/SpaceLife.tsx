// TA 的生活子页（P3 从 AISpace 抽出，资料卡里复用）：
// TASK_UI_BATCH2 改版：对标微信朋友圈——TA 头像 + 名字 + 时间 + 文字/配图 + [点赞][评论] 操作行。
// 纯文字动态不套大文本框，就文字本身；配图是 canvas 生成的 dataURL（src/lib/aiSpaceImage.ts）。
// 点赞/评论随 posts 一起存 localStorage，云端同步沿用 collectAllSpacePosts。

import { useCallback, useEffect, useRef, useState } from 'react'
import {
  addUserComment,
  generatePendingPosts,
  generateTaReply,
  loadCurrentPosts,
  refreshSpace,
  togglePostLike,
  type RefreshPlan,
} from '../lib/aiSpace'
import type { SpaceComment, SpacePost } from '../lib/aiSpaceCore'
import { loadAIProfile } from '../lib/storage'

/** 点赞心形：未赞描边，已赞实心（currentColor 上色） */
function HeartIcon({ filled = false }: { filled?: boolean }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill={filled ? 'currentColor' : 'none'}
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M12 21.35l-1.45-1.32C5.4 15.36 2 12.28 2 8.5 2 5.42 4.42 3 7.5 3c1.74 0 3.41.81 4.5 2.09C13.09 3.81 14.76 3 16.5 3 19.58 3 22 5.42 22 8.5c0 3.78-3.4 6.86-8.55 11.54L12 21.35z" />
    </svg>
  )
}

/** 评论气泡 */
function CommentIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M21 11.5a8.38 8.38 0 0 1-8.5 8.5c-1.36 0-2.66-.32-3.8-.9L3 20l.9-3.7A8.5 8.5 0 1 1 21 11.5z" />
    </svg>
  )
}

function timeAgo(ts: number): string {
  const diff = Date.now() - ts
  const m = Math.floor(diff / 60000)
  if (m < 1) return '刚刚'
  if (m < 60) return `${m} 分钟前`
  const h = Math.floor(m / 60)
  if (h < 24) return `${h} 小时前`
  return `${Math.floor(h / 24)} 天前`
}

interface Props {
  /** TA 昵称（生成动态/回复用） */
  aiNickname: string
  /** 用户昵称（生成动态/回复用，展示评论归属） */
  yourName: string
  /** 当前会话 id（有会话按角色隔离，无会话回落全局） */
  sessionId?: string
  /** 有没有人设：没人设时展示「先写人设」引导卡 */
  hasPersona: boolean
  /** 引导「去写人设」跳「我的」页（App 里即 settings 视图） */
  onGoMine?: () => void
  /** 返回资料卡 */
  onBack: () => void
}

export default function SpaceLife({ aiNickname, yourName, sessionId, hasPersona, onGoMine, onBack }: Props) {
  const ai = loadAIProfile()
  const name = aiNickname || 'TA'
  const displayName = name.slice(0, 1)

  // 进空间先立即显示已有动态（不阻塞），需要补的新动态异步生成、写完自动追加（TASK-UI2 按角色隔离）
  const [posts, setPosts] = useState<SpacePost[]>(() => loadCurrentPosts(sessionId))
  const [hint, setHint] = useState<string | null>(null)
  const [pendingLlm, setPendingLlm] = useState(false)
  // 当前展开评论输入框的动态 id（同时只开一个）
  const [replyingPostId, setReplyingPostId] = useState<string | null>(null)
  // 各动态的评论草稿
  const [drafts, setDrafts] = useState<Record<string, string>>({})
  // TA 正在回复的动态 id（显示「TA 正在回复…」）
  const [taReplying, setTaReplying] = useState<Record<string, boolean>>({})
  const hintTimer = useRef<number | undefined>(undefined)
  const planRef = useRef<RefreshPlan | null>(null)
  const generatingRef = useRef(false)
  const cancelledRef = useRef(false)

  const flashHint = useCallback((msg: string) => {
    setHint(msg)
    window.clearTimeout(hintTimer.current)
    hintTimer.current = window.setTimeout(() => setHint(null), 2600)
  }, [])

  useEffect(() => () => window.clearTimeout(hintTimer.current), [])

  /** 应用一次刷新计划：更新列表、按模式决定是否异步生成 */
  const applyPlan = useCallback(
    (plan: RefreshPlan) => {
      setPosts(plan.posts)
      if (plan.mode === 'template' && plan.created > 0) {
        flashHint('TA 这次用了旧日记凑数')
      }
      if (plan.mode === 'llm' && plan.pending.length > 0 && !plan.started && !generatingRef.current) {
        plan.started = true
        generatingRef.current = true
        setPendingLlm(true)
        void generatePendingPosts(plan, aiNickname, yourName, sessionId)
          .then((res) => {
            if (cancelledRef.current) return
            setPosts(res.posts)
            if (res.usedFallback) flashHint('TA 这次用了旧日记凑数')
          })
          .catch(() => {})
          .finally(() => {
            generatingRef.current = false
            setPendingLlm(false)
          })
      }
    },
    [aiNickname, yourName, flashHint, sessionId],
  )

  // 进入页面即刷新：已有动态立即显示，LLM 补的新动态异步追加
  useEffect(() => {
    cancelledRef.current = false
    if (!planRef.current) {
      planRef.current = refreshSpace(aiNickname, yourName, Date.now(), sessionId)
    }
    applyPlan(planRef.current)
    return () => {
      cancelledRef.current = true
    }
  }, [applyPlan, aiNickname, yourName, sessionId])

  const handleRefresh = () => {
    const plan = refreshSpace(aiNickname, yourName, Date.now(), sessionId)
    planRef.current = plan
    applyPlan(plan)
    if (plan.pending.length === 0 && plan.created === 0) {
      flashHint('TA 刚更新过，晚点再来看看')
    }
  }

  /* ---- 点赞 + 评论 ---- */

  const handleToggleLike = (postId: string) => {
    setPosts(togglePostLike(postId, sessionId))
  }

  const toggleCommentInput = (postId: string) => {
    setReplyingPostId((cur) => (cur === postId ? null : postId))
  }

  const submitComment = (postId: string) => {
    const text = (drafts[postId] ?? '').trim()
    if (!text) return
    const { posts: updated, comment } = addUserComment(postId, text, sessionId)
    setPosts(updated)
    setDrafts((d) => ({ ...d, [postId]: '' }))
    setReplyingPostId(null)
    setTaReplying((r) => ({ ...r, [postId]: true }))
    generateTaReply(postId, comment.id, aiNickname, yourName, sessionId)
      .then((res) => {
        if (cancelledRef.current) return
        setPosts(res)
      })
      .catch(() => {})
      .finally(() => {
        setTaReplying((r) => ({ ...r, [postId]: false }))
      })
  }

  /** 评论列表：用户留言 + 每条下面 TA 的回复（标注「TA 回复」） */
  const renderComments = (p: SpacePost) => {
    const list: Array<{ comment: SpaceComment; reply?: SpaceComment }> = []
    for (const c of p.comments ?? []) {
      if (c.from === 'user') {
        list.push({ comment: c, reply: (p.comments ?? []).find((x) => x.from === 'ta' && x.replyTo === c.id) })
      }
    }
    if (list.length === 0) return null
    return (
      <div className="space-life-comment-list">
        {list.map(({ comment: c, reply }) => (
          <div key={c.id}>
            <div className="space-life-comment">
              <span className="space-life-comment-name">{yourName || '你'}：</span>
              <span className="space-life-comment-text">{c.text}</span>
            </div>
            {reply && (
              <div className="space-life-comment space-life-comment-ta">
                <span className="space-life-comment-name">TA 回复：</span>
                <span className="space-life-comment-text">{reply.text}</span>
              </div>
            )}
          </div>
        ))}
      </div>
    )
  }

  const latestAt = posts.length > 0 ? posts[0].at : null

  return (
    <div className="page ai-space-page ai-space-page-sub">
      <div className="ai-space-topbar ai-space-sub-bar">
        <button type="button" className="link-btn ai-space-back" onClick={onBack}>
          ‹ 返回
        </button>
        <h2 className="ai-space-sub-title">TA 的生活</h2>
        <span className="ai-space-topbar-spacer" aria-hidden="true" />
      </div>

      <div className="ai-space-timeline space-life-list">
        {!hasPersona && (
          <div className="ai-space-guide">
            <p className="ai-space-guide-text">先给 TA 写个人设，TA 才会开始分享生活</p>
            {onGoMine && (
              <button type="button" className="btn btn-ghost ai-space-guide-btn" onClick={onGoMine}>
                去「我的」写人设
              </button>
            )}
          </div>
        )}

        {latestAt != null && (
          <div className="ai-space-update-row">
            <span className="ai-space-update">TA 最近更新于 · {timeAgo(latestAt)}</span>
            <button
              type="button"
              className="ai-space-refresh"
              onClick={handleRefresh}
              aria-label="刷新动态"
              title="刷新"
            >
              <svg
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.5"
                strokeLinecap="round"
                strokeLinejoin="round"
                aria-hidden="true"
              >
                <path d="M20 11a8 8 0 1 0-2.34 5.66" />
                <path d="M20 5v6h-6" />
              </svg>
            </button>
          </div>
        )}
        {pendingLlm && <p className="ai-space-hint">TA 正在写新的生活…</p>}
        {hint && <p className="ai-space-hint">{hint}</p>}

        {posts.map((p) => {
          const hasInteractions = p.liked === true || (p.comments != null && p.comments.length > 0)
          const isReplying = replyingPostId === p.id
          const draft = drafts[p.id] ?? ''
          return (
            <article key={p.id} className="space-life-post">
              <div className="space-life-post-head">
                {ai.avatar.startsWith('data:') ? (
                  <img className="space-life-avatar-img" src={ai.avatar} alt="" />
                ) : (
                  <span className="space-life-avatar-letter">{displayName}</span>
                )}
                <div className="space-life-post-title">
                  <span className="space-life-name">{name}</span>
                  <span className="space-life-time">{timeAgo(p.at)}</span>
                </div>
              </div>

              <div className="space-life-content">
                <p className="space-life-text">{p.text}</p>
                {p.img && <img className="space-life-img" src={p.img} alt="" loading="lazy" />}
              </div>

              <div className="space-life-actions">
                <button
                  type="button"
                  className={`space-life-action${p.liked === true ? ' is-liked' : ''}`}
                  onClick={() => handleToggleLike(p.id)}
                  aria-pressed={p.liked === true}
                >
                  <HeartIcon filled={p.liked === true} />
                  <span>点赞</span>
                </button>
                <button type="button" className="space-life-action" onClick={() => toggleCommentInput(p.id)}>
                  <CommentIcon />
                  <span>评论</span>
                </button>
              </div>

              {hasInteractions && (
                <div className="space-life-interactions">
                  {p.liked === true && (
                    <div className="space-life-likes">
                      <HeartIcon filled />
                      <span>{yourName || '你'}</span>
                    </div>
                  )}
                  {renderComments(p)}
                  {taReplying[p.id] === true && <p className="space-life-ta-typing">TA 正在回复…</p>}
                </div>
              )}

              {isReplying && (
                <div className="space-life-comment-input-row">
                  <input
                    className="space-life-comment-input"
                    value={draft}
                    onChange={(e) => setDrafts((d) => ({ ...d, [p.id]: e.target.value }))}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') submitComment(p.id)
                    }}
                    placeholder="说点什么…"
                    autoFocus
                  />
                  <button
                    type="button"
                    className="space-life-comment-send"
                    onClick={() => submitComment(p.id)}
                    disabled={!draft.trim()}
                  >
                    发送
                  </button>
                </div>
              )}
            </article>
          )
        })}

        <p className="ai-space-foot">这里是 TA 的生活 · 内容会随你们的相处慢慢生长</p>
      </div>
    </div>
  )
}
