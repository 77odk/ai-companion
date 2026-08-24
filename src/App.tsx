import { useEffect, useRef, useState } from 'react'
import Welcome from './components/Welcome'
import RolePicker from './components/RolePicker'
import Chat from './components/Chat'
import Memory from './components/Memory'
import Work from './components/Work'
import Settings, { type SettingsPage } from './components/Settings'
import AISpace from './components/AISpace'
import AnniversaryPage from './components/AnniversaryPage'
import GuideDetail from './components/Guide'
import LoginGate from './components/LoginGate'
import { loadMessages, loadPersona } from './lib/storage'
import { isLoggedIn, isPublicView } from './lib/auth'
import { ELUVIN_AUTH_CHANGE } from './lib/dataChange'

type View = 'welcome' | 'role' | 'chat' | 'memory' | 'work' | 'settings' | 'aispace' | 'anniversary' | 'guide'

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

// 是否需要先选角色：没有专属人设且没有聊天记录 = 全新用户，进聊天前必须选一个 TA
function needsRolePick(): boolean {
  try {
    return loadPersona().trim() === '' && loadMessages().length === 0
  } catch {
    return false
  }
}

// 模块加载时判一次开机页，保证先读标记再渲染，也不会被 StrictMode 的二次初始化干扰
const bootWelcome = decideBoot()
// 优先级：开机页 > 游客先看欢迎页（逛展示内容）> 角色选择 > 聊天
const initialView: View = bootWelcome ? 'welcome' : !isLoggedIn() ? 'welcome' : needsRolePick() ? 'role' : 'chat'

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

// ---- 监听登录状态变化：登录/登出后重算登录墙与已登录态 ----
function useAuthState(): boolean {
  const [loggedIn, setLoggedIn] = useState<boolean>(() => isLoggedIn())
  useEffect(() => {
    if (typeof window === 'undefined' || typeof window.addEventListener !== 'function') return
    const onChange = () => setLoggedIn(isLoggedIn())
    window.addEventListener(ELUVIN_AUTH_CHANGE, onChange)
    return () => window.removeEventListener(ELUVIN_AUTH_CHANGE, onChange)
  }, [])
  return loggedIn
}

export default function App() {
  const [view, setView] = useState<View>(initialView)
  const [spaceFrom, setSpaceFrom] = useState<View>('chat')
  const [settingsTarget, setSettingsTarget] = useState<SettingsPage>('main')
  // 游客想进需登录页时记下的目标 view：登录墙展示 + 登录成功回跳用
  const [gateTarget, setGateTarget] = useState<View | null>(null)
  // 从登录墙去逛指南时，暂时收起来的回跳目标（指南返回时放回登录墙）
  const [pendingTarget, setPendingTarget] = useState<View | null>(null)
  // 使用指南独立 view：返回时回到来源（欢迎页 / 我的 / 登录墙）
  const [guideBack, setGuideBack] = useState<'welcome' | 'settings' | 'gate'>('welcome')
  const titleClicks = useRef<number[]>([])
  const loggedIn = useAuthState()

  // 访问门禁：需登录 view 且未登录 → 记下目标交给登录墙；游客可看的直接进
  const navigate = (v: View) => {
    if (!isPublicView(v) && !loggedIn) {
      setGateTarget(v)
      return
    }
    if (isPublicView(v)) {
      setGateTarget(null) // 回到公开页 = 取消待登录的目标
      setPendingTarget(null)
    }
    setView(v)
  }

  const openSettings = (target: SettingsPage) => {
    setSettingsTarget(target)
    navigate('settings')
  }

  const openSpace = (from: View) => {
    setSpaceFrom(from)
    navigate('aispace')
  }

  const backFromSpace = () => navigate(spaceFrom)

  const openGuide = (from: 'welcome' | 'settings' | 'gate') => {
    if (from === 'gate') {
      // 登录墙 → 指南：把回跳目标收起来，返回时再放回登录墙
      setPendingTarget(gateTarget ?? (!isPublicView(view) ? view : null))
      setGateTarget(null)
    }
    setGuideBack(from)
    setView('guide')
  }

  const handleGuideBack = () => {
    if (guideBack === 'gate') {
      const target = pendingTarget
      setPendingTarget(null)
      if (target) {
        setGateTarget(target)
        setView(target)
      } else {
        setView('welcome')
      }
      return
    }
    navigate(guideBack)
  }

  // 登录墙登录成功：回跳目标 view
  const handleGateDone = () => {
    if (gateTarget) {
      setView(gateTarget)
      setGateTarget(null)
    }
    setPendingTarget(null)
    // gateTarget 为空（从已登录页退出、落在需登录 view）时，view 就是目标页，登录后自然显示
  }

  // 登录墙返回：不登录，回欢迎页继续逛展示内容
  const handleGateBack = () => {
    setGateTarget(null)
    setPendingTarget(null)
    setView('welcome')
  }

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

  // 登录墙是否展示：正在请求需登录 view 且未登录；或已登录页退出后落在需登录 view
  const gateShown = (gateTarget !== null || !isPublicView(view)) && !loggedIn

  return (
    <div className="app">
      {gateShown ? (
        <LoginGate onDone={handleGateDone} onGoGuide={() => openGuide('gate')} onBack={handleGateBack} />
      ) : view === 'guide' ? (
        <GuideDetail onBack={handleGuideBack} onGoProvider={() => openSettings('provider')} />
      ) : view === 'welcome' ? (
        <Welcome
          onStart={() => navigate(needsRolePick() ? 'role' : 'chat')}
          onGoGuide={() => openGuide('welcome')}
        />
      ) : view === 'role' ? (
        <RolePicker onDone={() => navigate('chat')} />
      ) : view === 'aispace' ? (
        <AISpace onBack={backFromSpace} onGoMine={() => navigate('settings')} />
      ) : view === 'anniversary' ? (
        <AnniversaryPage onBack={() => navigate('memory')} />
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
            {view === 'chat' && (
              <Chat
                onGoSettings={() => openSettings('main')}
                onGoGuide={() => openGuide('settings')}
              />
            )}
            {view === 'memory' && <Memory onOpenAnniversary={() => navigate('anniversary')} />}
            {view === 'work' && <Work onGoChat={() => navigate('chat')} />}
            {view === 'settings' && (
              <Settings
                initialPage={settingsTarget}
                onOpenSpace={() => openSpace('settings')}
                onGoWelcome={() => navigate('welcome')}
                onSwitchRole={() => navigate('role')}
                onGoGuide={() => openGuide('settings')}
              />
            )}
          </main>

          <nav className="app-nav">
            <button
              className={`nav-btn${view === 'chat' ? ' active' : ''}`}
              onClick={() => navigate('chat')}
            >
              聊天
            </button>
            <button
              className={`nav-btn${view === 'memory' ? ' active' : ''}`}
              onClick={() => navigate('memory')}
            >
              记忆
            </button>
            <button
              className={`nav-btn${view === 'work' ? ' active' : ''}`}
              onClick={() => navigate('work')}
            >
              工作台
            </button>
            <button
              className={`nav-btn${view === 'settings' ? ' active' : ''}`}
              onClick={() => navigate('settings')}
            >
              我的
            </button>
          </nav>
        </>
      )}
    </div>
  )
}
