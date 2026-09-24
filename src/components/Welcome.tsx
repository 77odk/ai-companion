interface Props {
  onStart: () => void
  onGoGuide: () => void
}

export default function Welcome({ onStart, onGoGuide }: Props) {
  return (
    <div className="welcome-page welcome-reference-page">
      <img
        className="welcome-reference-scene"
        src="/brand/welcome-scene.svg"
        alt=""
        aria-hidden="true"
      />

      <div className="welcome-reference-topline">
        <p>在时间里，和你一起。</p>
        <span>ALWAYS WITH YOU.</span>
      </div>

      <main className="welcome-reference-content">
        <div className="welcome-reference-logo-frame">
          <img
            className="welcome-reference-logo"
            src="/brand/eluvin-book-icon.jpg"
            alt="忆文"
          />
        </div>

        <h1>忆文</h1>
        <p className="welcome-reference-en">ELUVIN</p>
        <p className="welcome-reference-slogan">忆过往，成文思</p>

        <p className="welcome-reference-note-inline" aria-hidden="true">
          记录时光，也记录我们。 ♡
        </p>

        <p className="welcome-reference-lead">
          不只是记忆，
          <br />
          而是我们一起走过的每一天。
        </p>

        <p className="welcome-reference-keywords">记忆 · 陪伴 · 成长 · 更久的我们</p>

        <div className="welcome-reference-actions">
          <button type="button" className="welcome-reference-primary" onClick={onStart}>
            <span>登录 / 注册</span>
            <span aria-hidden="true">→</span>
          </button>

          <button type="button" className="welcome-reference-secondary" onClick={onGoGuide}>
            <span>先了解一下</span>
            <span aria-hidden="true">→</span>
          </button>
        </div>
      </main>

    </div>
  )
}
