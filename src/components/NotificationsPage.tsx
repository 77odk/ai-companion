interface Props {
  onBack: () => void
}

export default function NotificationsPage({ onBack }: Props) {
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
      <div className="settings-card notification-empty-card">
        <strong>暂时没有新消息</strong>
        <p className="hint">版本更新、系统公告和重要账号提醒会集中在这里。TA 想对你说的话仍然只在聊天里。</p>
      </div>
    </div>
  )
}
