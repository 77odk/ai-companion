import { useEffect, useState } from 'react'
import { fetchSiteStats } from '../lib/siteStats'
import { API_BASE } from '../lib/sync'

interface Props {
  onGoGuide: () => void
  onLogin: () => void
}

// UI2-02 返修：Web ↻ 语义 = 更新当前 Web 客户端，不是「确认已看过 Welcome」。
// Welcome 刷新保持 Welcome 由 visitState 的会话级 visit marker 承担；forceRefresh 只负责更新客户端。
function handleRefresh(): void {
  void import('../lib/forceRefresh').then((m) => m.forceRefresh())
}

export default function Welcome({ onGoGuide, onLogin }: Props) {
  // 站点访问数字走我们自己的后端（第一方），取不到就不显示，不填 0 也不编数字。
  const [visitors, setVisitors] = useState<number | null>(null)
  useEffect(() => {
    let alive = true
    void fetchSiteStats(API_BASE).then((stats) => {
      if (alive && stats && stats.uv > 0) setVisitors(stats.uv)
    })
    return () => {
      alive = false
    }
  }, [])

  return (
    <div className="welcome-page welcome-reference-page">
      <img
        className="welcome-reference-scene"
        src="/brand/welcome-scene.svg"
        alt=""
        aria-hidden="true"
      />

      <button
        type="button"
        className="welcome-refresh"
        onClick={handleRefresh}
      >
        ↻ 检查更新
      </button>

      <main className="welcome-reference-content">
        <div className="welcome-reference-logo-frame">
          <img
            className="welcome-reference-logo"
            src="/brand/eluvin-book-icon-cutout.png"
            alt="忆文"
          />
        </div>

        <h1>忆文</h1>
        <p className="welcome-reference-en">ELUVIN</p>
        <p className="welcome-reference-slogan">忆过往，成文思</p>

        <span className="welcome-reference-divider" aria-hidden="true" />

        <p className="welcome-reference-lead">
          不只是记忆，
          <br />
          而是我们一起走过的每一天。
        </p>

        <div className="welcome-reference-actions">
          <button type="button" className="welcome-reference-primary" onClick={onGoGuide}>
            <span>先了解一下</span>
            <span aria-hidden="true">→</span>
          </button>

          <button type="button" className="welcome-reference-login" onClick={onLogin}>
            已有账号，登录
          </button>
        </div>
      </main>

      <p className="welcome-reference-note" aria-hidden="true">
        记录时光，<br />也记录我们
      </p>

      {/* 页尾：关键词行 + 第一方访问人数（访问人数在最下） */}
      <div className="welcome-reference-footer" aria-hidden="true">
        <p className="welcome-reference-keywords">记忆 · 陪伴 · 成长 · 更久的我们</p>
        {visitors !== null && (
          <p className="welcome-reference-count">已有 {visitors} 人访问</p>
        )}
      </div>
    </div>
  )
}
