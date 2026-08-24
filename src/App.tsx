import { useCallback, useEffect, useRef, useState } from 'react'
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
import { getToken, isLoggedIn, isPublicView } from './lib/auth'
import { listSessions } from './lib/sessionApi'
import { getActiveSessionId, setActiveSessionId } from './lib/sessionStore'
import { decideLoginTarget, pickMostRecentSession, type RolePickMode } from './lib/sessionFlow'
import { ELUVIN_AUTH_CHANGE } from './lib/dataChange'

type View = 'welcome' | 'role' | 'chat' | 'memory' | 'work' | 'settings' | 'aispace' | 'anniversary' | 'guide' | 'loading'

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
// 优先级：开机页 > 游客先看欢迎页（逛展示内容）> 已登录用户异步拉会话分流（loading 过渡，不白屏）
// 已登录不再用 needsRolePick 判初始页：有没有会话由云端 sessions 决定，拉回结果后再进聊天/选角色
const initialView: View = bootWelcome ? 'welcome' : !isLoggedIn() ? 'welcome' : 'loading'

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
  // 游客想进需登录页时记下的目标 view：仅登录墙展示用（登录成功后改为按云端会话分流，不再硬回跳）
  const [gateTarget, setGateTarget] = useState<View | null>(null)
  // 从登录墙去逛指南时，暂时收起来的回跳目标（指南返回时放回登录墙）
  const [pendingTarget, setPendingTarget] = useState<View | null>(null)
  // 使用指南独立 view：返回时回到来源（欢迎页 / 我的 / 登录墙）
  const [guideBack, setGuideBack] = useState<'welcome' | 'settings' | 'gate'>('welcome')
  // 选角色页的用途：first=首次/游客新建；current=换个TA·当前会话换人设；new=换个TA·开新会话换TA
  const [roleMode, setRoleMode] = useState<RolePickMode>('first')
  // 已登录用户首次拉会话列表只做一次（StrictMode 双跑防重）
  const redirectStarted = useRef(false)
  const titleClicks = useRef<number[]>([])
  const loggedIn = useAuthState()

  // 登录用户分流：拉会话列表 → 有会话进最近会话聊天，没有进选角色页新建。
  // 拉列表失败（断网等）走本地兜底：有缓存的当前会话进聊天，否则按本地记录判断。
  // 这里就把 redirectStarted 置位，避免 view 切到 loading 后下面的挂载 effect 再触发一次重复拉取。
  const redirectBySessions = useCallback(async () => {
    redirectStarted.current = true
    setView('loading')
    const token = getToken()
    if (!token) {
      setView('welcome')
      return
    }
    const res = await listSessions(token)
    if (res.ok) {
      const latest = pickMostRecentSession(res.data.sessions)
      if (latest) setActiveSessionId(String(latest.id))
      else setActiveSessionId('')
      // 无会话进选角色页时，重置为「首次新建」用途（上次「换个 TA」留下的 current/new 不该带到这）
      const target = decideLoginTarget(res.data.sessions)
      if (target === 'role') setRoleMode('first')
      setView(target)
    } else if (getActiveSessionId()) {
      setView('chat')
    } else if (needsRolePick()) {
      setRoleMode('first')
      setView('role')
    } else {
      setView('chat')
    }
  }, [])

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

  // 登录墙登录成功：按云端会话分流（有会话进聊天，无会话进选角色新建），
  // 不再硬回登录前的 gateTarget——游客点聊天被拦，登录后也是"有会话的聊天"或"选角色"
  const handleGateDone = () => {
    setGateTarget(null)
    setPendingTarget(null)
    void redirectBySessions()
  }

  // 欢迎页「开始使用」：登录用户按云端会话分流；游客维持原流程（选角色或直接聊天）
  const handleWelcomeStart = () => {
    if (isLoggedIn()) {
      void redirectBySessions()
    } else {
      navigate(needsRolePick() ? 'role' : 'chat')
    }
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

  // 已登录用户首次挂载（initialView='loading'）时拉会话分流；开机欢迎页时等「开始使用」再分流。
  // redirectBySessions 内部已置位 redirectStarted，这里只需判重。
  useEffect(() => {
    if (!loggedIn || redirectStarted.current || view !== 'loading') return
    void redirectBySessions()
  }, [loggedIn, view, redirectBySessions])

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
          onStart={handleWelcomeStart}
          onGoGuide={() => openGuide('welcome')}
        />
      ) : view === 'role' ? (
        <RolePicker mode={roleMode} onDone={() => navigate('chat')} />
      ) : view === 'aispace' ? (
        <AISpace onBack={backFromSpace} onGoMine={() => navigate('settings')} />
      ) : view === 'anniversary' ? (
        <AnniversaryPage onBack={() => navigate('memory')} />
      ) : view === 'loading' ? (
        <div className="session-loading">
          <p>正在打开记忆…</p>
        </div>
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
                onSwitchRole={(mode) => {
                  setRoleMode(mode)
                  navigate('role')
                }}
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
