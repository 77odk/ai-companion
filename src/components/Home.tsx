import { loadPersona } from '../lib/storage'

interface Props {
  onGoChat: () => void
  onGoSettings: () => void
}

export default function Home({ onGoChat, onGoSettings }: Props) {
  const hasPersona = loadPersona().trim().length > 0

  return (
    <div className="home-page">
      <div className="home-inner">
        <div className="home-avatar" aria-hidden="true">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              d="M8 10h.01M12 10h.01M16 10h.01M21 12c0 4.42-4.03 8-9 8a9.86 9.86 0 01-4-.83L3 21l1.09-4.06A7.5 7.5 0 013 12c0-4.42 4.03-8 9-8s9 3.58 9 8z"
            />
          </svg>
        </div>

        <h2 className="home-name">你的 TA</h2>
        <p className="home-greeting">我在呢，随时想聊就聊</p>

        <button className="btn btn-primary home-start" onClick={onGoChat}>
          开始聊天
        </button>

        {hasPersona && <p className="home-persona-note">已按你的专属设定陪伴你</p>}

        <div className="home-links">
          <button className="link-btn" onClick={onGoSettings}>
            设置
          </button>
        </div>
      </div>

      <p className="home-tip">TA 记得你说过的话 · 不只是聊天</p>
    </div>
  )
}
