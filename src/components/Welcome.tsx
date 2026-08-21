interface Props {
  onStart: () => void
}

const FEATURES = ['对话', '长期记忆', '工作台']

export default function Welcome({ onStart }: Props) {
  return (
    <div className="welcome-page">
      <div className="welcome-inner">
        <div className="welcome-logo" aria-hidden="true">
          <span className="welcome-logo-mark">忆</span>
        </div>

        <h1 className="welcome-name">忆文</h1>
        <p className="welcome-en">Eluvin</p>
        <p className="welcome-slogan">忆过往，成文思</p>

        <div className="welcome-features">
          {FEATURES.map((f) => (
            <span key={f} className="welcome-feature">
              {f}
            </span>
          ))}
        </div>

        <button className="btn btn-primary welcome-start" onClick={onStart}>
          开始使用
        </button>

        <p className="welcome-foot">记得住你，也帮得上你</p>

        <p className="welcome-count">
          已有 <span id="busuanzi_value_site_uv">0</span> 人访问
        </p>
      </div>
    </div>
  )
}
