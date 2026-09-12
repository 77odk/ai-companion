interface Props {
  onStart: () => void
  onGoGuide: () => void
}

// UI2-02：Welcome 是「进入 Eluvin 世界之前的一扇门」。
// 移除 feature pills 展示（对应功能仍在，只是品牌入口不再陈列）；
// 保留：忆文 / ELUVIN / 官方 slogan「忆过往，成文思」/ 既有 onStart / onGoGuide / 强刷入口（复用 forceRefresh）。
export default function Welcome({ onStart, onGoGuide }: Props) {
  return (
    <div className="welcome-page">
      <button
        type="button"
        className="welcome-refresh"
        onClick={() => void import('../lib/forceRefresh').then((m) => m.forceRefresh())}
      >
        ↻ 检查更新
      </button>

      <div className="welcome-inner">
        <div className="welcome-logo" aria-hidden="true">
          <span className="welcome-logo-mark">忆</span>
        </div>

        <p className="welcome-en">ELUVIN</p>
        <h1 className="welcome-name">忆文</h1>
        <p className="welcome-slogan">忆过往，成文思</p>

        {/* 时间轨迹：两条逐渐靠近的线 + 微弱节点（Warm 品牌光） */}
        <div className="welcome-track" aria-hidden="true">
          <span className="welcome-track-line welcome-track-line-l" />
          <span className="welcome-track-node" />
          <span className="welcome-track-line welcome-track-line-r" />
        </div>

        <button className="welcome-start" onClick={onStart}>
          开始遇见 TA
        </button>

        <button type="button" className="welcome-guide-link" onClick={onGoGuide}>
          第一次来？先花 30 秒看看教程
        </button>

        <p className="welcome-foot">这里会有一个 TA，和你一起经过时间，并记得。</p>

        <p className="welcome-count">
          已有 <span id="busuanzi_value_site_uv">0</span> 人访问
        </p>
      </div>
    </div>
  )
}
