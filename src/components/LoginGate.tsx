// 登录墙（B2b）：游客想进聊天/忆览/工作台/我的等使用页时，整屏拦住先登录。
// 顶部有人味的引导文案 + 复用 LoginForm 登录/注册；登录成功调 onDone 回跳目标页。
// 提供「先看看教程」小链接，游客可以先去逛使用指南。

import LoginForm from './LoginForm'
import { forceRefresh } from '../lib/forceRefresh'

interface Props {
  /** 登录成功后回跳目标页 */
  onDone: () => void
  /** 去使用指南（游客可逛） */
  onGoGuide: () => void
  /** 返回（暂不登录，回欢迎页） */
  onBack: () => void
}

export default function LoginGate({ onDone, onGoGuide, onBack }: Props) {
  const handleForceRefresh = () => {
    if (!window.confirm('强制刷新会清除页面缓存并重新加载，继续吗？')) return
    void forceRefresh()
  }

  return (
    <div className="login-gate">
      <div className="login-gate-header">
        <button type="button" className="detail-back" onClick={onBack} aria-label="返回">
          <svg
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.5"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden="true"
          >
            <path d="M19 12H5" />
            <path d="M12 19l-7-7 7-7" />
          </svg>
        </button>
      </div>

      <div className="login-gate-inner">
        <img
          className="login-gate-logo"
          src="/brand/eluvin-book-icon-cutout.png"
          alt="忆文"
        />

        <h1 className="login-gate-title">欢迎回来</h1>
        <p className="login-gate-sub">登录后，TA 才能继续记得你。</p>

        <div className="login-gate-card">
          <LoginForm onSuccess={onDone} variant="gate" />
        </div>

        <div className="login-gate-weak-actions">
          <button type="button" className="login-gate-guide" onClick={onGoGuide}>
            先看看教程
          </button>
          <span aria-hidden="true">·</span>
          <button type="button" className="login-gate-refresh" onClick={handleForceRefresh}>
            强制刷新
          </button>
        </div>
      </div>
    </div>
  )
}
