interface Props {
  onStart: () => void
  onGoGuide: () => void
}

// Welcome 视觉按用户确认参考图复刻。
// 保留既有 onStart / onGoGuide 行为，只替换展示层。
export default function Welcome({ onStart, onGoGuide }: Props) {
  return (
    <div className="welcome-page welcome-reference-page">
      <img
        className="welcome-reference-art"
        src="/brand/welcome-reference-mobile.jpg"
        alt=""
        aria-hidden="true"
      />

      <p className="welcome-reference-slogan">忆过往，成文思</p>

      <button
        type="button"
        className="welcome-reference-hit welcome-reference-primary"
        onClick={onStart}
        aria-label="登录 / 注册"
      />

      <button
        type="button"
        className="welcome-reference-hit welcome-reference-secondary"
        onClick={onGoGuide}
        aria-label="先了解一下"
      />
    </div>
  )
}
