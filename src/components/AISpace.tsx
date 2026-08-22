import { useEffect, useRef, useState } from 'react'
import { loadAIProfile, loadUserProfile } from '../lib/storage'
import { refreshSpace } from '../lib/aiSpace'
import { KIND_LABEL, type SpacePost } from '../lib/aiSpaceCore'
import DefaultAvatar from './DefaultAvatar'
import SpaceArt from './SpaceArt'

interface Props {
  onBack: () => void
}

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

export default function AISpace({ onBack }: Props) {
  const ai = loadAIProfile()
  const user = loadUserProfile()
  const yourName = user.nickname || '你'

  // 进入页面即刷新：按上次访问时间补新动态，没有新内容也不会打扰
  const [posts, setPosts] = useState<SpacePost[]>(() => refreshSpace(ai.nickname, yourName).posts)
  const [hint, setHint] = useState<string | null>(null)
  const hintTimer = useRef<number | undefined>(undefined)

  useEffect(() => () => window.clearTimeout(hintTimer.current), [])

  const handleRefresh = () => {
    const result = refreshSpace(ai.nickname, yourName)
    setPosts(result.posts)
    if (result.created === 0) {
      setHint('TA 刚更新过，晚点再来看看')
      window.clearTimeout(hintTimer.current)
      hintTimer.current = window.setTimeout(() => setHint(null), 2600)
    }
  }

  const latestAt = posts.length > 0 ? posts[0].at : null

  return (
    <div className="page ai-space-page">
      <div className="ai-space-head">
        <div className="ai-space-topbar">
          <button type="button" className="link-btn ai-space-back" onClick={onBack}>
            ‹ 返回
          </button>
          <h1 className="ai-space-title">TA 的空间</h1>
          <span className="ai-space-topbar-spacer" aria-hidden="true" />
        </div>

        <div className="ai-space-avatar" aria-hidden="true">
          {ai.avatar.startsWith('data:') ? (
            <img src={ai.avatar} alt="" />
          ) : (
            <DefaultAvatar kind="ai" className="avatar-default" />
          )}
        </div>
        <h2 className="ai-space-name">{ai.nickname}</h2>
        <p className="ai-space-bio">
          只属于{yourName}的 TA · 这里记录着 TA 的日常、想法，和没说出口的心事
        </p>
      </div>

      <div className="ai-space-timeline">
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
      </div>

      <p className="ai-space-foot">这里是 TA 的生活 · 内容会随你们的相处慢慢生长</p>
    </div>
  )
}
