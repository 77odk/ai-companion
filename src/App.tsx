import { useCallback, useEffect, useRef, useState } from 'react'
import Welcome from './components/Welcome'
import RolePicker from './components/RolePicker'
import Chat from './components/Chat'
import Memory from './components/Memory'
import Work from './components/Work'
import Settings, { type SettingsPage } from './components/Settings'
import AISpace from './components/AISpace'
import AnniversaryPage from './components/AnniversaryPage'
import WeeklyPage from './components/WeeklyPage'
import GuideDetail from './components/Guide'
import LoginGate from './components/LoginGate'
import SessionSidebar from './components/SessionSidebar'
import { loadMessages, loadPersona } from './lib/storage'
import { getToken, isLoggedIn, isPublicView } from './lib/auth'
import { deleteSession, listSessions, patchSession, type Session } from './lib/sessionApi'
import {
  clearMemoriesCache,
  clearMessagesCache,
  getActiveSessionId,
  getSessionsCache,
  setActiveSessionId,
  setSessionsCache,
} from './lib/sessionStore'
import { hasLocalLegacyData, hasMigratedFlag, runLocalMigration, setLocalMigratedFlag } from './lib/migrateLocal'
import {
  decideLoginTarget,
  displaySessionName,
  pickMostRecentSession,
  pickNextSessionAfterDelete,
  resolveSessionName,
  type RolePickMode,
} from './lib/sessionFlow'
import { ELUVIN_AUTH_CHANGE } from './lib/dataChange'

type View = 'welcome' | 'role' | 'chat' | 'memory' | 'work' | 'settings' | 'aispace' | 'anniversary' | 'weekly' | 'guide' | 'loading'

// 老数据迁移状态：idle=无/结束；running=正在把本地旧数据搬成第一个云端会话；failed=失败（可重试/跳过）
type MigrationState = 'idle' | 'running' | 'failed'

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
  // 老数据一键迁移状态（无云端会话 + 本地有旧数据时触发，见 redirectBySessions）
  const [migration, setMigration] = useState<MigrationState>('idle')
  // 已登录用户首次拉会话列表只做一次（StrictMode 双跑防重）
  const redirectStarted = useRef(false)
  const titleClicks = useRef<number[]>([])
  const loggedIn = useAuthState()
  // 会话侧边栏（B3 + S1）：面板开关 + 会话列表（缓存初始化，打开时从后端刷新）
  const [sidebarOpen, setSidebarOpen] = useState(false)
  const [sessions, setSessions] = useState<Session[]>(() => getSessionsCache())
  const [deleting, setDeleting] = useState(false)
  // 刚新建会话的标题：列表还没拉回时，头部入口先显示它（兜底解析）
  const [createdTitle, setCreatedTitle] = useState('')

  // 老数据一键迁移：建云端会话 → 按升序传消息 → 传记忆（单条失败跳过不中断）→
  // 置位 → 进聊天。本地数据只读不删（红线）；createSession 失败才算整个迁移失败（不置位，可重试）。
  const runMigration = useCallback(async (token: string) => {
    const result = await runLocalMigration(token, '我们的开始')
    if (!result.ok) {
      setMigration('failed')
      return
    }
    setActiveSessionId(String(result.sessionId))
    setLocalMigratedFlag()
    setMigration('idle')
    setView('chat')
  }, [])

  // 迁移失败后的「重试」：重新走一遍迁移（本地旧数据仍在）
  const retryMigration = () => {
    const token = getToken()
    if (!token) {
      setView('welcome')
      return
    }
    setMigration('running')
    void runMigration(token)
  }

  // 迁移失败后的「先跳过，直接新建」：进选角色页，不置位——下次登录有旧数据还会再迁
  const skipMigration = () => {
    setMigration('idle')
    setRoleMode('first')
    setView('role')
  }

  // 登录用户分流：拉会话列表 → 有会话进最近会话聊天；没有但有本地旧数据（且没迁过）→ 自动迁移；
  // 没有也没数据 → 进选角色页新建。
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
      const sessions = res.data.sessions
      // S1 头部入口要显示当前角色名：列表直接落缓存，切换/重进不用等侧边栏打开
      setSessionsCache(sessions)
      setSessions(sessions)
      const latest = pickMostRecentSession(sessions)
      if (latest) {
        // 有云端会话 → 正常进聊天
        setActiveSessionId(String(latest.id))
        setMigration('idle')
        setView('chat')
      } else if (!hasMigratedFlag() && hasLocalLegacyData()) {
        // 无云端会话 + 本地有旧数据 + 没迁过 → 自动把本地数据搬成第一个会话
        setActiveSessionId('')
        setRoleMode('first')
        setMigration('running')
        await runMigration(token)
      } else {
        // 无云端会话且无本地数据（或已迁过）→ 正常进选角色页新建
        setActiveSessionId('')
        setMigration('idle')
        const target = decideLoginTarget(sessions)
        if (target === 'role') setRoleMode('first')
        setView(target)
      }
    } else if (getActiveSessionId()) {
      setView('chat')
    } else if (needsRolePick()) {
      setRoleMode('first')
      setView('role')
    } else {
      setView('chat')
    }
  }, [runMigration])

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

  // ---- 会话侧边栏（B3） ----

  // 打开侧边栏：先拉后端会话列表刷新缓存，再展示（拉取失败用本地缓存兜底）
  const refreshSessions = useCallback(async () => {
    const token = getToken()
    if (!token) return
    const res = await listSessions(token)
    if (res.ok) {
      setSessionsCache(res.data.sessions)
      setSessions(res.data.sessions)
    }
  }, [])

  const openSidebar = () => {
    setSidebarOpen(true)
    void refreshSessions()
  }

  // 切换会话：整套环境跟着切（消息/记忆/人设），Chat 挂载/激活后按新 id 拉数据
  const handleSwitchSession = (id: string) => {
    setActiveSessionId(id)
    setSidebarOpen(false)
    setView('chat')
  }

  // 新建会话：关侧边栏 → 选角色页（first=新建）
  const handleNewSession = () => {
    setSidebarOpen(false)
    setRoleMode('first')
    setView('role')
  }

  // 删除会话：后端级联删 → 清该会话消息/记忆缓存 → 刷新列表 →
  // 删的是当前会话时：剩>0 切最近一个，无会话进选角色页；删失败提示、列表不刷新（401 走登录墙）
  const handleDeleteSession = async (id: string) => {
    const token = getToken()
    if (!token) return
    setDeleting(true)
    try {
      const res = await deleteSession(token, id)
      if (!res.ok) {
        window.alert('没删掉，网络开小差了，稍后再试试。')
        return
      }
      clearMessagesCache(id)
      clearMemoriesCache(id)
      const remaining = sessions.filter((s) => String(s.id) !== id)
      setSessionsCache(remaining)
      setSessions(remaining)
      setSidebarOpen(false)
      if (getActiveSessionId() === id) {
        const next = pickNextSessionAfterDelete(remaining, id)
        if (next) {
          setActiveSessionId(String(next.id))
          setView('chat')
        } else {
          setActiveSessionId('')
          setRoleMode('first')
          setView('role')
        }
      }
    } finally {
      setDeleting(false)
    }
  }

  // 改名（S1 微信备注式）：PATCH title → 更新列表与缓存 → 头部入口即时显示新名字
  const handleRenameSession = async (id: string, title: string) => {
    const token = getToken()
    const t = title.trim()
    if (!token || !t) return
    const res = await patchSession(token, id, { title: t })
    if (!res.ok) {
      window.alert('没改掉，网络开小差了，稍后再试试。')
      return
    }
    const updated = sessions.map((s) => (String(s.id) === id ? { ...s, title: t } : s))
    setSessionsCache(updated)
    setSessions(updated)
    if (getActiveSessionId() === id) setCreatedTitle(t)
  }

  // 头部入口显示当前角色名：列表里找当前会话 → 占位标题从 persona 兜底 → 刚新建的标题 → 全局解析
  const currentSession = sessions.find((s) => String(s.id) === getActiveSessionId())
  const headerName =
    (currentSession ? displaySessionName(currentSession) : '') || createdTitle || resolveSessionName(loadPersona()) || 'TA'

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
        <RolePicker
          mode={roleMode}
          onDone={(info) => {
            if (info?.title) setCreatedTitle(info.title)
            navigate('chat')
            // 新建会话后顺手拉一次列表：侧边栏/头部入口都能立刻显示新角色名
            void refreshSessions()
          }}
          onBack={() => navigate(roleMode === 'first' ? 'welcome' : 'settings')}
        />
      ) : view === 'aispace' ? (
        <AISpace onBack={backFromSpace} onGoMine={() => navigate('settings')} />
      ) : view === 'anniversary' ? (
        <AnniversaryPage onBack={() => navigate('memory')} />
      ) : view === 'weekly' ? (
        <WeeklyPage onBack={() => navigate('memory')} onGoSettings={() => openSettings('provider')} />
      ) : view === 'loading' ? (
        <div className="session-loading">
          {migration === 'failed' ? (
            <>
              <p>记录没带完，点重试再试一次。</p>
              <div className="migrate-actions">
                <button type="button" className="btn btn-primary" onClick={retryMigration}>
                  重试
                </button>
                <button type="button" className="btn btn-ghost" onClick={skipMigration}>
                  先跳过，直接新建
                </button>
              </div>
            </>
          ) : migration === 'running' ? (
            <p>正在把你的记录带过来…</p>
          ) : (
            <p>正在打开记忆…</p>
          )}
        </div>
      ) : (
        <>
          <header className="app-header">
            {view === 'chat' && loggedIn && (
              <button
                type="button"
                className="session-list-entry"
                onClick={openSidebar}
                aria-label="会话列表"
                title="会话列表"
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
                  <path d="M4 6h16" />
                  <path d="M4 12h16" />
                  <path d="M4 18h10" />
                </svg>
                <span className="session-list-entry-name">{headerName}</span>
              </button>
            )}
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
            {view === 'memory' && (
              <Memory
                onOpenAnniversary={() => navigate('anniversary')}
                onOpenWeekly={() => navigate('weekly')}
              />
            )}
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

      {loggedIn && sidebarOpen && (
        <SessionSidebar
          open={sidebarOpen}
          onClose={() => setSidebarOpen(false)}
          sessions={sessions}
          activeId={getActiveSessionId()}
          onSwitch={handleSwitchSession}
          onNew={handleNewSession}
          onDelete={(id) => void handleDeleteSession(id)}
          onRename={(id, title) => void handleRenameSession(id, title)}
          deleting={deleting}
        />
      )}
    </div>
  )
}
