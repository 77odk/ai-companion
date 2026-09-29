import { useEffect, useState } from 'react'
import { API_BASE } from '../lib/sync'
import { getToken, logout } from '../lib/auth'

interface Props {
  onBack: () => void
  onRead?: (revision: number) => void
}

type OfficialNotificationKind = 'update' | 'announcement' | 'account'

interface OfficialNotification {
  id: string
  kind: OfficialNotificationKind
  title: string
  body: string
  publishedAt: string
}

type LoadState = 'loading' | 'ready' | 'error' | 'signedout'

/** publishedAt 兼容 ISO 时间与 YYYY-MM-DD 两种写法；解析不出来返回 null */
function publishedAtDate(value: string): Date | null {
  const trimmed = value.trim()
  if (!trimmed) return null
  const iso = /^\d{4}-\d{2}-\d{2}$/.test(trimmed) ? `${trimmed}T00:00:00Z` : trimmed
  const time = Date.parse(iso)
  return Number.isNaN(time) ? null : new Date(time)
}

function normalizeNotification(value: unknown): OfficialNotification | null {
  if (!value || typeof value !== 'object') return null
  const item = value as Record<string, unknown>
  let id: string | null = null
  if (typeof item.id === 'string' && item.id.trim()) {
    id = item.id.trim()
  } else if (typeof item.id === 'number' && Number.isSafeInteger(item.id) && item.id >= 0) {
    id = String(item.id)
  }
  if (!id) return null
  if (item.kind !== 'update' && item.kind !== 'announcement' && item.kind !== 'account') return null
  if (typeof item.title !== 'string' || !item.title.trim()) return null
  if (typeof item.body !== 'string' || !item.body.trim()) return null
  if (typeof item.publishedAt !== 'string' || !publishedAtDate(item.publishedAt)) return null
  return {
    id,
    kind: item.kind,
    title: item.title.trim(),
    body: item.body.trim(),
    publishedAt: item.publishedAt.trim(),
  }
}

function kindLabel(kind: OfficialNotificationKind): string {
  if (kind === 'update') return '版本更新'
  if (kind === 'announcement') return '系统公告'
  return '账号提醒'
}

function dateLabel(value: string): string {
  const trimmed = value.trim()
  const dateOnly = /^(\d{4})-(\d{2})-(\d{2})$/.exec(trimmed)
  if (dateOnly) {
    return `${dateOnly[1]}年${dateOnly[2]}月${dateOnly[3]}日`
  }
  const date = publishedAtDate(trimmed)
  if (!date) return value
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${date.getFullYear()}年${month}月${day}日`
}

/**
 * 消息与通知：数据来自后端 GET /api/notifications（未登录不请求、不发红点）。
 * 拉到数据即视为已读，回执上抛给 App 统一 POST /api/notifications/read。
 */
export default function NotificationsPage({ onBack, onRead }: Props) {
  const [items, setItems] = useState<OfficialNotification[]>([])
  const [loadState, setLoadState] = useState<LoadState>('loading')
  const [reloadKey, setReloadKey] = useState(0)

  useEffect(() => {
    const token = getToken()
    if (!token) {
      // 未登录：不请求后端、不发红点（红点由 App 按登录态决定）
      setItems([])
      setLoadState('signedout')
      return
    }

    const controller = new AbortController()
    setLoadState('loading')

    void fetch(`${API_BASE}/api/notifications`, {
      cache: 'no-store',
      headers: { Authorization: `Bearer ${token}` },
      signal: controller.signal,
    })
      .then(async (response) => {
        if (response.status === 401) {
          logout()
          return
        }
        if (!response.ok) throw new Error(`notifications ${response.status}`)
        const payload = await response.json() as { revision?: unknown; items?: unknown }
        const revision = payload.revision
        if (
          typeof revision !== 'number' ||
          !Number.isInteger(revision) ||
          revision < 0 ||
          !Array.isArray(payload.items)
        ) {
          throw new Error('invalid notifications payload')
        }
        const next = payload.items
          .map(normalizeNotification)
          .filter((item): item is OfficialNotification => item !== null)
          .sort((a, b) => {
            const bTime = publishedAtDate(b.publishedAt)?.getTime() ?? 0
            const aTime = publishedAtDate(a.publishedAt)?.getTime() ?? 0
            return bTime - aTime
          })
        setItems(next)
        setLoadState('ready')
        onRead?.(revision)
      })
      .catch((error: unknown) => {
        if (error instanceof DOMException && error.name === 'AbortError') return
        setItems([])
        setLoadState('error')
      })

    return () => controller.abort()
  }, [onRead, reloadKey])

  return (
    <div className="page settings-page notifications-page">
      <div className="detail-header">
        <button type="button" className="detail-back detail-back-text" onClick={onBack} aria-label="返回">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M19 12H5" />
            <path d="M12 19l-7-7 7-7" />
          </svg>
          返回
        </button>
        <h2 className="detail-title">消息与通知</h2>
        <span className="detail-spacer" aria-hidden="true" />
      </div>

      {loadState === 'signedout' ? (
        <div className="settings-card notification-status-card" role="status">
          登录之后，这里会显示忆文给你的消息。
        </div>
      ) : loadState === 'loading' ? (
        <div className="settings-card notification-status-card" role="status">
          正在加载消息…
        </div>
      ) : loadState === 'error' ? (
        <div className="settings-card notification-status-card" role="status">
          <strong>消息暂时没有加载出来</strong>
          <button type="button" className="btn btn-ghost notification-retry" onClick={() => setReloadKey((key) => key + 1)}>
            重新加载
          </button>
        </div>
      ) : items.length === 0 ? (
        <div className="settings-card notification-empty-card">
          <strong>暂时没有新消息</strong>
          <p className="hint">版本更新和系统公告会集中在这里。TA 想对你说的话仍然只在聊天里。</p>
        </div>
      ) : (
        <div className="notification-list" aria-live="polite">
          {items.map((item) => (
            <article className="notification-card" key={item.id}>
              <div className="notification-card-meta">
                <span className="notification-kind">{kindLabel(item.kind)}</span>
                <time dateTime={item.publishedAt}>{dateLabel(item.publishedAt)}</time>
              </div>
              <h3>{item.title}</h3>
              <p>{item.body}</p>
            </article>
          ))}
        </div>
      )}
    </div>
  )
}
