import { Component, type ErrorInfo, type ReactNode } from 'react'

interface Props {
  children: ReactNode
}

interface State {
  hasError: boolean
  error: Error | null
}

/**
 * 全局崩溃兜底：任何子组件抛未捕获异常时，显示兜底页而不是白屏。
 * 放在 App 最外层，整棵树都被覆盖。
 */
export default class ErrorBoundary extends Component<Props, State> {
  constructor(props: Props) {
    super(props)
    this.state = { hasError: false, error: null }
  }

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error }
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    // 这里可以接错误上报（Sentry / 自建日志），现阶段先打 console 方便排查
    console.error('[ErrorBoundary] 捕获到崩溃:', error, info.componentStack)
  }

  handleReload = (): void => {
    location.reload()
  }

  handleClearAndReload = (): void => {
    // 极端情况：localStorage 数据损坏导致反复崩溃，清掉关键数据再刷新
    try {
      localStorage.removeItem('ai_companion_settings')
      localStorage.removeItem('ai_companion_messages')
      localStorage.removeItem('ai_companion_memory')
    } catch {
      // 清不掉就算了，至少能刷新
    }
    location.reload()
  }

  render(): ReactNode {
    if (this.state.hasError) {
      return (
        <div className="error-boundary">
          <div className="error-boundary-card">
            <div className="error-boundary-icon" aria-hidden="true">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                <path d="M12 9v4" />
                <path d="M12 17h.01" />
                <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" />
              </svg>
            </div>
            <h2 className="error-boundary-title">出了点小问题</h2>
            <p className="error-boundary-desc">
              TA 刚才卡住了，刷新一下就能继续。聊天记录和记忆都在，不会丢。
            </p>
            <div className="error-boundary-actions">
              <button type="button" className="btn btn-primary" onClick={this.handleReload}>
                刷新页面
              </button>
              <button type="button" className="btn btn-ghost" onClick={this.handleClearAndReload}>
                清除缓存后刷新
              </button>
            </div>
            <p className="error-boundary-hint">
              如果刷新后还是这样，点「清除缓存后刷新」——可能是本地数据出了问题。
            </p>
          </div>
        </div>
      )
    }
    return this.props.children
  }
}
