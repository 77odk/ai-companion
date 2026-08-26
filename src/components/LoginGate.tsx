// 登录墙（B2b）：游客想进聊天/忆览/工作台/我的等使用页时，整屏拦住先登录。
// 顶部有人味的引导文案 + 复用 LoginForm 登录/注册；登录成功调 onDone 回跳目标页。
// 提供「先看看教程」小链接，游客可以先去逛使用指南。

import { useRef } from 'react'
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
  const logoClicks = useRef<number[]>([])

  // 「忆文」logo 连点 3 下强刷（同顶栏逻辑）：清 caches + 注销 SW + reload，排查更新问题用
  const handleLogoClick = () => {
    const now = Date.now()
    const recent = logoClicks.current.filter((t) => now - t < 2000)
    recent.push(now)
    logoClicks.current = recent
    if (recent.length >= 3) {
      logoClicks.current = []
      void forceRefresh()
    }
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
        <button type="button" className="login-gate-logo" onClick={handleLogoClick} aria-label="忆文">
          <span>忆</span>
        </button>

        <h1 className="login-gate-title">登录后，TA 才会记得你</h1>
        <p className="login-gate-sub">
          聊天、记忆、纪念日都会跟着你的账号走，换个设备也能找回来。
        </p>

        <div className="login-gate-card">
          <LoginForm onSuccess={onDone} />
        </div>

        <button type="button" className="login-gate-guide" onClick={onGoGuide}>
          先看看教程
        </button>

        <button type="button" className="login-gate-refresh" onClick={() => void forceRefresh()}>
          页面没更新？点这里强制刷新
        </button>
      </div>
    </div>
  )
}
