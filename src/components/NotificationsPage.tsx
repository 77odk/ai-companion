import { useEffect, useState } from 'react'

interface Props {
  onBack: () => void
}

type OfficialNotificationKind = 'update' | 'announcement'

interface OfficialNotification {
  id: string
  kind: OfficialNotificationKind
  title: string
  body: string
  publishedAt: string
}

type LoadState = 'loading' | 'ready' | 'error'

function normalizeNotification(value: unknown): OfficialNotification | null {
  if (!value || typeof value !== 'object') return null
  const item = value as Record<string, unknown>
  if (typeof item.id !== 'string' || !item.id.trim()) return null
  if (item.kind !== 'update' && item.kind !== 'announcement') return null
  if (typeof item.title !== 'string' || !item.title.trim()) return null
  if (typeof item.body !== 'string' || !item.body.trim()) return null
  if (typeof item.publishedAt !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(item.publishedAt)) return null
  return {
    id: item.id.trim(),
    kind: item.kind,
    title: item.title.trim(),
    body: item.body.trim(),
    publishedAt: item.publishedAt,
  }
}

function kindLabel(kind: OfficialNotificationKind): string {
  return kind === 'update' ? '版本更新' : '系统公告'
}

function dateLabel(value: string): string {
  const [year, month, day] = value.split('-')
  return `${year}年${month}月${day}日`
}

export default function NotificationsPage({ onBack }: Props) {
  const [items, setItems] = useState<OfficialNotification[]>([])
  const [loadState, setLoadState] = useState<LoadState>('loading')
  const [reloadKey, setReloadKey] = useState(0)

  useEffect(() => {
    const controller = new AbortController()
    setLoadState('loading')

    void fetch(`${import.meta.env.BASE_URL}notifications.json`, {
      cache: 'no-store',
      signal: controller.signal,
    })
      .then(async (response) => {
        if (!response.ok) throw new Error(`notification feed ${response.status}`)
        const payload = await response.json() as { schemaVersion?: unknown; items?: unknown }
        if (payload.schemaVersion !== 1 || !Array.isArray(payload.items)) {
          throw new Error('invalid notification feed')
        }
        const next = payload.items
          .map(normalizeNotification)
          .filter((item): item is OfficialNotification => item !== null)
          .sort((a, b) => b.publishedAt.localeCompare(a.publishedAt))
        setItems(next)
        setLoadState('ready')
      })
      .catch((error: unknown) => {
        if (error instanceof DOMException && error.name === 'AbortError') return
        setItems([])
        setLoadState('error')
      })

    return () => controller.abort()
  }, [reloadKey])

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
        <h2>消息与通知</h2>
        <span className="detail-header-spacer" aria-hidden="true" />
      </div>

      {loadState === 'loading' ? (
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
