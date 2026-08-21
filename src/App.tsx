import { useRef, useState } from 'react'
import Welcome from './components/Welcome'
import Chat from './components/Chat'
import Memory from './components/Memory'
import Work from './components/Work'
import Settings from './components/Settings'
import AISpace from './components/AISpace'

type View = 'welcome' | 'chat' | 'memory' | 'work' | 'settings' | 'aispace'

// ---- 开机页判定：新会话或隔太久（>6 小时）才算重新开机 ----
const BOOT_INTERVAL_MS = 6 * 60 * 60 * 1000
const SESSION_BOOT_KEY = 'eluvin_boot_seen'
const LAST_VISIT_KEY = 'eluvin_last_visit_at'

function decideBoot(): boolean {
  const now = Date.now()
  try {
    const seen = sessionStorage.getItem(SESSION_BOOT_KEY)
    if (!seen) {
      // 新会话（关过标签/浏览器再开）：这次算开机
      sessionStorage.setItem(SESSION_BOOT_KEY, '1')
      localStorage.setItem(LAST_VISIT_KEY, String(now))
      return true
    }
    const last = Number(localStorage.getItem(LAST_VISIT_KEY) || 0)
    if (last && now - last > BOOT_INTERVAL_MS) {
      // 距上次访问超过 6 小时：也算重新开机
      localStorage.setItem(LAST_VISIT_KEY, String(now))
      return true
    }
    // 刷新、短时间来回：直接进主界面
    localStorage.setItem(LAST_VISIT_KEY, String(now))
    return false
  } catch {
    return true
  }
}

// 模块加载时判一次开机页，保证先读标记再渲染，也不会被 StrictMode 的二次初始化干扰
const bootWelcome = decideBoot()

// ---- 连点 3 下强刷：清 PWA 缓存 + 注销 Service Worker + 重新加载 ----
async function forceRefresh(): Promise<void> {
  try {
    if ('caches' in window) {
      const keys = await caches.keys()
      await Promise.all(keys.map((k) => caches.delete(k)))
    }
    if (navigator.serviceWorker?.getRegistrations) {
      const regs = await navigator.serviceWorker.getRegistrations()
      await Promise.all(regs.map((r) => r.unregister()))
    }
  } catch {
    // 兜底：没网或不支持时，能刷新就好
  }
  location.reload()
}

export default function App() {
  const [view, setView] = useState<View>(bootWelcome ? 'welcome' : 'chat')
  const [spaceFrom, setSpaceFrom] = useState<View>('chat')
  const titleClicks = useRef<number[]>([])

  const openSpace = (from: View) => {
    setSpaceFrom(from)
    setView('aispace')
  }

  const backFromSpace = () => setView(spaceFrom)

  const handleTitleClick = () => {
    const now = Date.now()
    const recent = titleClicks.current.filter((t) => now - t < 2000)
    recent.push(now)
    titleClicks.current = recent
    if (recent.length >= 3) {
      titleClicks.current = []
      void forceRefresh()
    }
  }

  return (
    <div className="app">
      {view === 'welcome' ? (
        <Welcome onStart={() => setView('chat')} />
      ) : view === 'aispace' ? (
        <AISpace onBack={backFromSpace} />
      ) : (
        <>
          <header className="app-header">
            {view === 'chat' && (
              <button
                type="button"
                className="space-entry"
                onClick={() => openSpace('chat')}
                aria-label="进入 TA 的空间"
                title="TA 的空间"
              >
                <svg
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.5"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  aria-hidden="true"
                >
                  <circle cx="12" cy="12" r="5.5" />
                  <path d="M6.8 8.2C4.6 7.2 3.2 7.6 2.6 9c-.6 1.4.6 3 2.6 3.6M15.4 7.4c1.8-1.4 3.4-1.5 4.2-.3.8 1.2-.2 3-2.6 4M10.4 15.8c-.6 2.2-.2 3.6 1.2 4.2 1.4.6 3-.6 3.6-2.6" />
                  <circle cx="16.4" cy="5.8" r="0.7" fill="currentColor" stroke="none" />
                </svg>
              </button>
            )}
            <h1 className="app-title" onClick={handleTitleClick}>
              忆文
            </h1>
            <p className="app-subtitle">忆过往，成文思</p>
          </header>

          <main className="app-main">
            {view === 'chat' && <Chat onGoSettings={() => setView('settings')} />}
            {view === 'memory' && <Memory />}
            {view === 'work' && <Work />}
            {view === 'settings' && (
              <Settings onOpenSpace={() => openSpace('settings')} onGoWelcome={() => setView('welcome')} />
            )}
          </main>

          <nav className="app-nav">
            <button
              className={`nav-btn${view === 'chat' ? ' active' : ''}`}
              onClick={() => setView('chat')}
            >
              聊天
            </button>
            <button
              className={`nav-btn${view === 'memory' ? ' active' : ''}`}
              onClick={() => setView('memory')}
            >
              记忆
            </button>
            <button
              className={`nav-btn${view === 'work' ? ' active' : ''}`}
              onClick={() => setView('work')}
            >
              工作台
            </button>
            <button
              className={`nav-btn${view === 'settings' ? ' active' : ''}`}
              onClick={() => setView('settings')}
            >
              我的
            </button>
          </nav>
        </>
      )}
    </div>
  )
}
