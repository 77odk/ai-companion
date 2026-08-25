// TA 的生活子页（P3 从 AISpace 抽出，资料卡里复用）：
// 现有动态引擎整块搬进来（LLM 生成/降级/引导卡逻辑原样不动），会话感知按角色隔离。
// 组件自持动态状态（posts/生成中提示），进页面即刷新、异步补新动态。

import { useCallback, useEffect, useRef, useState } from 'react'
import {
  generatePendingPosts,
  loadCurrentPosts,
  refreshSpace,
  type RefreshPlan,
} from '../lib/aiSpace'
import { KIND_LABEL, type SpacePost } from '../lib/aiSpaceCore'
import SpaceArt from './SpaceArt'

/** 配图区柔和渐变：每种 kind 一个色系，跟记忆页主题色块同一组配色 */
const ART_TONE: Record<string, string> = {
  日常: 'art-tone-0',
  心情: 'art-tone-1',
  钻研: 'art-tone-2',
  天气: 'art-tone-3',
  想你: 'art-tone-4',
  小确幸: 'art-tone-5',
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
  /** TA 昵称（生成动态用） */
  aiNickname: string
  /** 用户昵称（生成动态用） */
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
  // 进空间先立即显示已有动态（不阻塞），需要补的新动态异步生成、写完自动追加（TASK-UI2 按角色隔离）
  const [posts, setPosts] = useState<SpacePost[]>(() => loadCurrentPosts(sessionId))
  const [hint, setHint] = useState<string | null>(null)
  const [pendingLlm, setPendingLlm] = useState(false)
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

      <div className="ai-space-timeline">
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

        {posts.map((p) => (
          <article key={p.id} className="ai-space-post">
            <div className={`ai-space-art ${ART_TONE[p.kind] ?? 'art-tone-0'}`}>
              <SpaceArt kind={p.kind} variant={p.art} />
            </div>
            <div className="ai-space-post-body">
              <div className="ai-space-post-head">
                <span className="ai-space-post-kind">{KIND_LABEL[p.kind] ?? p.kind}</span>
                <span className="ai-space-post-time">{timeAgo(p.at)}</span>
              </div>
              <p className="ai-space-post-text">{p.text}</p>
            </div>
          </article>
        ))}

        <p className="ai-space-foot">这里是 TA 的生活 · 内容会随你们的相处慢慢生长</p>
      </div>
    </div>
  )
}
