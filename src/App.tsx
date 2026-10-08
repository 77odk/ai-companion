import { lazy, Suspense, useCallback, useEffect, useRef, useState } from 'react'
import { flushSync } from 'react-dom'
import Welcome from './components/Welcome'
import type { NaturalSetup } from './components/RolePicker'
import type { FeedbackDraft } from './components/FeedbackPage'
import Chat from './components/Chat'
import type { SettingsPage } from './components/Settings'
import LoginGate from './components/LoginGate'
import WellbeingGuard from './components/WellbeingGuard'
import ConsentGate, { consentGateNeeded } from './components/ConsentGate'
import { getAccount, API_BASE } from './lib/sync'
import { pingSiteHit } from './lib/siteStats'
import { PlanetIcon } from './components/spaceIcons'
import type { ChatJumpTarget, MemoryReturnTarget } from './lib/chatJump'
import {
  loadMessages,
  loadPersona,
  loadAIProfile,
  loadUserProfile,
  getNotificationReadRevision,
  setNotificationReadRevision as persistNotificationReadRevision,
  saveAIProfile,
  saveAIRemark,
  saveAIGender,
  savePersona,
  getInitiativePreference,
  saveInitiativePreference,
  loadSettings,
  recordLocalModelUsageTurn,
} from './lib/storage'
import { getToken, isLoggedIn, isPublicView, logout } from './lib/auth'
import { createSession, listSessions } from './lib/sessionApi'
import {
  getActiveSessionId,
  getBusyState,
  getSessionLang,
  getSessionsCache,
  getMessagesCache,
  setActiveSessionId,
  setSessionsCache,
} from './lib/sessionStore'
import { hasLocalLegacyData, hasMigratedFlag, runLocalMigration, setLocalMigratedFlag } from './lib/migrateLocal'
import {
  clearVisitWelcome,
  getLastPrimaryView,
  isPrimaryView,
  markPrimaryView,
  markVisitWelcome,
} from './lib/visitState'
import {
  decideLoginTarget,
  displaySessionName,
  resolveActiveSession,
  type RolePickMode,
} from './lib/sessionFlow'
import { ELUVIN_AUTH_CHANGE, ELUVIN_DATA_CHANGE } from './lib/dataChange'
import { forceRefresh, refreshToLatest } from './lib/forceRefresh'
import { checkDeployedBuild, getCurrentBuildVersion, subscribeDeployedBuild } from './lib/appVersion'
import Home from './components/Home'
import { hydrateCloudState, initCloudStateSync, syncCloudState } from './lib/cloudState'
import { queueLegacyCloudStateBackfill } from './lib/cloudStateResources'
import { closeOldestCandidateWindowOnStartup } from './lib/eventDetector'
import { getOrAdvanceTaRuntime, getSessionPersona, getTaContinuity, runtimeDisplayLabel } from './lib/taRuntime'
import { branchIdForNewMessage, loadConversationState, resolveConversationMessages } from './lib/conversationState'
import { futureTopicsFromMessages } from './lib/chatTopics'
import { getEvents } from './lib/eventStore'
import { getAnniversaries } from './lib/anniversary'
import { evaluateInitiativeResponse } from './lib/initiativePolicy'
import { runInitiativeCatchUp } from './lib/initiativeRuntime'
import { commitInitiativeMessage } from './lib/initiativeCommit'
import { chatCompletion, type ModelUsage } from './lib/api'
import { estimateToken } from './lib/token'
import { resolveIdentityMode } from './lib/companionPolicy'
import { captureLatestTaCommitment, collectDueTaCommitments, markCommitmentReminded, nextTaCommitmentCheckAt, type TaCommitment } from './lib/commitmentStore'
import { showSystemNotification } from './lib/systemNotification'
import { captureTaStateEvidenceFromLatestReply, getTaStateView, recordTaStateInteraction } from './lib/taState'
import { settleTaThoughts } from './lib/taThoughts'

// Secondary views are loaded only when opened. Same components and routes; this only removes them from the startup bundle.
const RolePicker = lazy(() => import('./components/RolePicker'))
const loadSettingsView = () => import('./components/Settings')
const loadAISpaceView = () => import('./components/AISpace')
const loadMemoryView = () => import('./components/Memory')

const Settings = lazy(loadSettingsView)
const AISpace = lazy(loadAISpaceView)
const ChatProfile = lazy(() => import('./components/ChatProfile'))
const ChatSettings = lazy(() => import('./components/ChatSettings'))
const AboutMe = lazy(() => import('./components/AboutMe'))
const WeeklyPage = lazy(() => import('./components/WeeklyPage'))
const ThoughtBook = lazy(() => import('./components/ThoughtBook'))
const ListenTogether = lazy(() => import('./components/ListenTogether'))
const StarJar = lazy(() => import('./components/StarJar'))
const GuideDetail = lazy(() => import('./components/Guide'))
const ProductIntro = lazy(() => import('./components/ProductIntro'))
const RolesPage = lazy(() => import('./components/RolesPage'))
const SpaceLife = lazy(() => import('./components/SpaceLife'))
const Memory = lazy(loadMemoryView)
const NotificationsPage = lazy(() => import('./components/NotificationsPage'))
const FeedbackPage = lazy(() => import('./components/FeedbackPage'))

type View = 'welcome' | 'productintro' | 'role' | 'roles' | 'home' | 'chat' | 'chatsettings' | 'settings' | 'memory' | 'aispace' | 'chatprofile' | 'aboutme' | 'weekly' | 'thoughts' | 'listen' | 'starjar' | 'spacelife' | 'guide' | 'notifications' | 'feedback' | 'loading'

interface InitiativeNotice {
  accountId: string
  sessionId: string
  taName: string
  content: string
}

const emptyFeedbackDraft = (): FeedbackDraft => ({ type: 'bug', content: '', images: [] })

// 公开路由 = auth 的游客白名单 + App 层例外（产品介绍页）。
// 「产品介绍页」的公开特例只留在 App 层，不写进 src/lib/auth.ts 的 PUBLIC_VIEWS。
const isPublicRoute = (v: string) => v === 'productintro' || isPublicView(v)

function systemNotificationTargetUrl(sessionId: string): string {
  const url = new URL(window.location.href)
  url.searchParams.set('notificationSession', sessionId)
  return url.toString()
}

function switchActiveSession(sessionId: string): void {
  // 播放器属于用户，不属于 TA；切换会话只切聊天上下文，不打断音乐。
  setActiveSessionId(String(sessionId ?? ''))
}

// 底部四 tab 的常显范围：主视图（TA/空间/记忆/我的）带底部导航；Chat 等全屏页不带。
// UI2-02 NAV-03：Chat 是 Secondary 全屏 view，Bottom Nav 只属于 home/aispace/memory/settings。
// 用函数判断避免 TS 对嵌套 view 比较做过度收窄（误报不可达比较）。
function isNavView(v: View): boolean {
  return v === 'home' || v === 'aispace' || v === 'settings' || v === 'memory'
}

type EluvinViewTransitionDocument = Document & {
  startViewTransition?: (update: () => void) => unknown
}

/**
 * P5-E Carry: only the four persistent primary views participate.
 * Chat / auth / setup / detail flows keep their existing instant navigation.
 */
function commitPrimaryViewWithCarry(from: View, to: View, commit: () => void): void {
  let committed = false
  const commitOnce = () => {
    if (committed) return
    committed = true
    commit()
  }

  if (!isNavView(from) || !isNavView(to)) {
    commitOnce()
    return
  }
  if (typeof document === 'undefined' || document.visibilityState !== 'visible') {
    commitOnce()
    return
  }
  if (typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) {
    commitOnce()
    return
  }

  const doc = document as EluvinViewTransitionDocument
  if (typeof doc.startViewTransition !== 'function') {
    commitOnce()
    return
  }

  try {
    doc.startViewTransition(() => {
      // React must commit the new primary view inside the native transition capture.
      flushSync(commitOnce)
    })
  } catch {
    // Unsupported / interrupted transitions must never block or double-commit navigation.
    commitOnce()
  }
}

// 四 tab 高亮：TA=首页/聊天，空间=AI Space，记忆=独立 Memory，我的=设置。
function navTabActive(v: View, tab: 'ta' | 'space' | 'memory' | 'mine'): boolean {
  if (tab === 'ta') return v === 'home' || v === 'chat' || v === 'spacelife'
  if (tab === 'space') return v === 'aispace'
  if (tab === 'memory') return v === 'memory'
  return v === 'settings'
}


/** Chat 页头「TA 此刻」：复用 Home 的 Persistent Runtime / Busy State，不新造状态。 */
function ChatHeaderPresence({ sessionId }: { sessionId: string | null }) {
  const [now, setNow] = useState(() => Date.now())

  useEffect(() => {
    if (!sessionId) return
    const refresh = () => setNow(Date.now())
    refresh()
    const timer = window.setInterval(refresh, 10_000)
    const onReplyCommitted = (event: Event) => {
      const sid = (event as CustomEvent<{ sid?: string }>).detail?.sid
      if (!sid || String(sid) === sessionId) refresh()
    }
    window.addEventListener('yiwem:ai-reply-committed', onReplyCommitted)
    return () => {
      window.clearInterval(timer)
      window.removeEventListener('yiwem:ai-reply-committed', onReplyCommitted)
    }
  }, [sessionId])

  if (!sessionId) return null

  const busy = getBusyState(sessionId)
  const lang = getSessionLang(sessionId)
  const label =
    busy.status === 'busy' && busy.busyUntil > now && busy.busyReason
      ? busy.busyReason
      : runtimeDisplayLabel(
          getOrAdvanceTaRuntime(sessionId, getSessionPersona(sessionId), now),
          lang,
        )

  if (!label) return null

  const ariaLabel = lang === 'en' ? `TA right now: ${label}` : `TA 此刻：${label}`

  return (
    <p className="chat-header-presence" aria-label={ariaLabel}>
      <span className="chat-header-presence-dot" aria-hidden="true" />
      <span>{label}</span>
    </p>
  )
}

// 老数据迁移状态：idle=无/结束；running=正在把本地旧数据搬成第一个云端会话；failed=失败（可重试/跳过）
type MigrationState = 'idle' | 'running' | 'failed'

// ---- 开机页判定：认证态优先 ----
// 已登录：永远跳过 Welcome / ProductIntro，先进入 loading 再按云端 sessions 分流。
// 未登录：进入 Welcome；产品介绍不写本地 seen 标记，避免多设备状态漂移。
const initialView: View = isLoggedIn() ? 'loading' : 'welcome'

// 是否需要先选角色：没有专属人设且没有聊天记录 = 全新用户，进聊天前必须选一个 TA
function needsRolePick(): boolean {
  try {
    return loadPersona().trim() === '' && loadMessages().length === 0
  } catch {
    return false
  }
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
  const loggedIn = useAuthState()

  useEffect(() => {
    initCloudStateSync()
  }, [])

  // P5-E performance closure: continuous visual ambience pauses explicitly while the page is hidden.
  // This DOM-only marker stores no user state and does not participate in sync.
  useEffect(() => {
    const root = document.documentElement
    const syncVisibility = () => {
      if (document.visibilityState === 'hidden') root.setAttribute('data-el-page-hidden', 'true')
      else root.removeAttribute('data-el-page-hidden')
    }
    syncVisibility()
    document.addEventListener('visibilitychange', syncVisibility)
    return () => {
      document.removeEventListener('visibilitychange', syncVisibility)
      root.removeAttribute('data-el-page-hidden')
    }
  }, [])

  useEffect(() => {
    if (!loggedIn) return
    const preloadPrimaryViews = () => {
      void Promise.allSettled([loadAISpaceView(), loadMemoryView(), loadSettingsView()])
    }
    const idleWindow = window as Window & {
      requestIdleCallback?: (callback: IdleRequestCallback, options?: IdleRequestOptions) => number
      cancelIdleCallback?: (handle: number) => void
    }
    if (typeof idleWindow.requestIdleCallback === 'function') {
      const id = idleWindow.requestIdleCallback(preloadPrimaryViews, { timeout: 1200 })
      return () => idleWindow.cancelIdleCallback?.(id)
    }
    const timer = globalThis.setTimeout(preloadPrimaryViews, 500)
    return () => globalThis.clearTimeout(timer)
  }, [loggedIn])

  // ---- 导航历史 + 滚动位置（修正批第 2/3 条）----
  // 浏览器后退/侧滑返回不白屏：goView 入栈 + pushState，popstate 时弹出上一页，栈空回首页。
  // 所有页面统一恢复离开时的滚动位置（切 view 时捕获，回来时还原）。
  const viewRef = useRef<View>(view)
  viewRef.current = view
  const carryRevisionRef = useRef(0)
  const viewStackRef = useRef<View[]>([])
  const scrollPosRef = useRef<Map<string, { cls: string; idx: number; top: number }[]>>(new Map())
  const captureScroll = useCallback((v: View) => {
    if (!v) return
    const container = document.querySelector('.app-main')
    if (!container) return
    const els = container.querySelectorAll<HTMLElement>('*')
    const items: { cls: string; idx: number; top: number }[] = []
    const counts = new Map<string, number>()
    for (const el of els) {
      const cls = typeof el.className === 'string' && el.className ? el.className : el.tagName
      const idx = counts.get(cls) ?? 0
      counts.set(cls, idx + 1)
      if (el.scrollTop > 0) items.push({ cls, idx, top: el.scrollTop })
    }
    scrollPosRef.current.set(v, items)
  }, [])

  const restoreScroll = useCallback((v: View) => {
    const items = scrollPosRef.current.get(v)
    if (!items || items.length === 0) return
    window.setTimeout(() => {
      const container = document.querySelector('.app-main')
      if (!container) return
      const wanted = new Map<string, Map<number, number>>()
      for (const { cls, idx, top } of items) {
        const byIndex = wanted.get(cls) ?? new Map<number, number>()
        byIndex.set(idx, top)
        wanted.set(cls, byIndex)
      }
      const counts = new Map<string, number>()
      for (const el of container.querySelectorAll<HTMLElement>('*')) {
        const cls = typeof el.className === 'string' && el.className ? el.className : el.tagName
        const idx = counts.get(cls) ?? 0
        counts.set(cls, idx + 1)
        const top = wanted.get(cls)?.get(idx)
        if (top !== undefined && el.scrollTop === 0) el.scrollTop = top
      }
    }, 0)
  }, [])

  /** 用户主动导航：入历史栈（可后退） */
  const goView = useCallback(
    (v: View) => {
      const from = viewRef.current
      if (from === v) return
      captureScroll(from)
      viewStackRef.current.push(from)
      window.history.pushState({ v }, '')
      const carryRevision = ++carryRevisionRef.current
      // Preserve the old navigation invariant immediately; the DOM commit may wait for a native snapshot.
      viewRef.current = v
      commitPrimaryViewWithCarry(from, v, () => {
        if (carryRevisionRef.current !== carryRevision) return
        setView(v)
      })
    },
    [captureScroll],
  )

  /** 流程性跳转（登录分流/迁移等）：不入历史栈，后退不回到流程中间 */
  const replaceView = useCallback(
    (v: View) => {
      if (viewRef.current === v) return
      captureScroll(viewRef.current)
      carryRevisionRef.current += 1
      viewRef.current = v
      setView(v)
    },
    [captureScroll],
  )

  // 挂载时初始化历史 state；popstate = 浏览器后退/侧滑返回 → 弹出上一页，栈空回首页
  useEffect(() => {
    window.history.replaceState({ v: viewRef.current }, '')
    const onPop = () => {
      const prev = viewStackRef.current.pop()
      const target = prev ?? 'home'
      const from = viewRef.current
      const carryRevision = ++carryRevisionRef.current
      viewRef.current = target
      commitPrimaryViewWithCarry(from, target, () => {
        if (carryRevisionRef.current !== carryRevision) return
        setView(target)
      })
    }
    window.addEventListener('popstate', onPop)
    return () => window.removeEventListener('popstate', onPop)
  }, [])

  // 进入 view 后还原滚动位置（页面渲染完再写）
  useEffect(() => {
    restoreScroll(view)
  }, [view, restoreScroll])

  // UI2-02 NAV：主视图记 lastPrimaryView（只允许 home/aispace/memory/settings）。
  // Welcome marker 只服务未登录展示；一旦有登录态立即清掉，避免认证用户刷新又回营销页。
  useEffect(() => {
    if (view === 'welcome' && !loggedIn) {
      markVisitWelcome()
    } else if (view !== 'loading' || loggedIn) {
      clearVisitWelcome()
    }
    if (isPrimaryView(view)) markPrimaryView(view)
  }, [view, loggedIn])

  // 二级页（资料卡/关于我/周记）的来源：从哪进返回哪（聊天/忆览/空间/我的）
  const [detailFrom, setDetailFrom] = useState<View>('chat')
  // 角色管理「角色详情」只看不切：临时查看的会话 id（chatprofile 优先读它；聊天/我的入口进资料卡时为 null）
  const [profileTarget, setProfileTarget] = useState<string | null>(null)
  // 从「我的 → TA 记得的」进记忆墙时，底部高亮算在「我的」上（旧记账项修复）；其余入口算「空间」
  const [spaceFrom, setSpaceFrom] = useState<'space' | 'settings'>('space')
  const navActive = (tab: 'ta' | 'space' | 'memory' | 'mine'): boolean => {
    if (view === 'aispace' && spaceFrom === 'settings') return tab === 'mine'
    return navTabActive(view, tab)
  }
  const [settingsTarget, setSettingsTarget] = useState<SettingsPage>('main')
  const [settingsPrivacyOpen, setSettingsPrivacyOpen] = useState(false)
  const [feedbackDraft, setFeedbackDraft] = useState<FeedbackDraft>(() => emptyFeedbackDraft())
  // 401 发生时只保留原账号身份；下一次登录若换了账号，就走严格隔离路径。
  const expiredAccountRef = useRef<string | null>(null)
  const rememberExpiredAccount = useCallback(() => {
    expiredAccountRef.current = getAccount()?.account ?? null
  }, [])
  const [, setNotificationFrom] = useState<'home' | 'settings'>('home')
  const [notificationRevision, setNotificationRevision] = useState(0)
  const [notificationReadRevision, setNotificationReadRevisionState] = useState(() => getNotificationReadRevision())
  // V3：未读以服务端 GET /api/notifications 的 unread 为准；本地 read revision 只作离线首帧镜像。
  const [notificationServerUnread, setNotificationServerUnread] = useState(false)
  // 防止“较早发出的未读探测”在用户刚读完消息后晚到，又把红点点亮。
  // 只记录本次 App 生命周期里真实执行过的 read，不拿历史本地 revision 压服务端事实。
  const notificationReadGuardRef = useRef({ epoch: 0, revision: 0 })
  // visibility / online 可能同时发起多个 GET；只允许较新的请求结果覆盖状态。
  const notificationRefreshGuardRef = useRef({ next: 0, applied: 0 })
  const hasUnreadNotifications = loggedIn && (notificationServerUnread || notificationRevision > notificationReadRevision)
  const [initiativeNotice, setInitiativeNotice] = useState<InitiativeNotice | null>(null)
  const [commitmentReminder, setCommitmentReminder] = useState<TaCommitment | null>(null)
  const commitmentReminderRef = useRef<TaCommitment | null>(null)
  const [settingsRootKey, setSettingsRootKey] = useState(0)
  const [spaceRootKey, setSpaceRootKey] = useState(0)
  const [memoryRootKey, setMemoryRootKey] = useState(0)
  // UI2-03B-1「看原对话」：Memory → 完整聊天记录的一次性目标（transient，不持久化）。
  const [pendingChatLogJump, setPendingChatLogJump] = useState<ChatJumpTarget | null>(null)
  // 「看原对话」的返回目标：只存内存（不进 localStorage / sync / backend / URL），返回时由 Memory 消费一次即清
  const [pendingMemoryReturn, setPendingMemoryReturn] = useState<MemoryReturnTarget | null>(null)
  // 游客想进需登录页时记下的目标 view：仅登录墙展示用（登录成功后改为按云端会话分流，不再硬回跳）
  const [gateTarget, setGateTarget] = useState<View | null>(null)
  // 从登录墙去逛指南时，暂时收起来的回跳目标（指南返回时放回登录墙）
  const [pendingTarget, setPendingTarget] = useState<View | null>(null)
  // Natural 游客草稿只存当前 App 内存；刷新丢失时按 V1 要求回正常 RolePicker。
  const [pendingNatural, setPendingNatural] = useState<NaturalSetup | null>(null)
  const [pendingNaturalError, setPendingNaturalError] = useState<string | null>(null)
  // 使用指南独立 view：返回时回到来源（欢迎页 / 我的 / 登录墙）
  const [guideBack, setGuideBack] = useState<'welcome' | 'settings' | 'gate' | 'chat'>('welcome')

  const checkDueCommitment = useCallback(async () => {
    if (!loggedIn || commitmentReminderRef.current) return
    const due = collectDueTaCommitments(Date.now())[0]
    if (!due) return

    const taName = loadAIProfile(due.sessionId).nickname?.trim() || 'TA'
    if (document.visibilityState !== 'visible') {
      // 后台时只有系统通知真实送达才算“提醒过”；关闭通知/权限失败时保持 pending，
      // 下次回前台或重新打开应用仍会出现应用内提醒，不吞掉承诺。
      commitmentReminderRef.current = due
      const delivered = await showSystemNotification(
        taName,
        '有一件答应你的事到时间了，打开忆文看看。',
        'eluvin-promise-' + due.id,
        systemNotificationTargetUrl(due.sessionId),
      )
      if (!delivered) {
        if (commitmentReminderRef.current?.id === due.id) commitmentReminderRef.current = null
        return
      }
      markCommitmentReminded(due.id)
      if (commitmentReminderRef.current?.id === due.id) commitmentReminderRef.current = null
      return
    }

    const marked = markCommitmentReminded(due.id)
    if (!marked) return
    commitmentReminderRef.current = marked
    setCommitmentReminder(marked)
  }, [loggedIn])

  useEffect(() => {
    if (!loggedIn) {
      commitmentReminderRef.current = null
      setCommitmentReminder(null)
      return
    }

    let dueTimer: number | null = null
    const clearDueTimer = () => {
      if (dueTimer !== null) window.clearTimeout(dueTimer)
      dueTimer = null
    }
    const armDueTimer = () => {
      clearDueTimer()
      const nextAt = nextTaCommitmentCheckAt(Date.now())
      if (nextAt == null) return
      const delay = Math.min(Math.max(0, nextAt - Date.now()), 2_147_000_000)
      dueTimer = window.setTimeout(() => {
        void checkDueCommitment()
        armDueTimer()
      }, delay)
    }

    const settleCompanionContinuity = (sid: string) => {
      if (!sid) return
      // S4：一次真实对话先记作“发生过互动”，再读取 TA 最终自述作为情绪证据。
      // 全程纯本地规则，不发模型请求；thought 只接收 state service 的粗粒度 signal。
      recordTaStateInteraction(sid)
      captureTaStateEvidenceFromLatestReply(sid)
      settleTaThoughts(sid)
    }

    const onReplyCommitted = (event: Event) => {
      const sid = String((event as CustomEvent<{ sid?: string }>).detail?.sid ?? '')
      if (sid) {
        captureLatestTaCommitment(sid)
        settleCompanionContinuity(sid)
      }
      void checkDueCommitment()
      armDueTimer()
    }

    const onVisibility = () => {
      if (document.visibilityState === 'visible') {
        checkDueCommitment()
        const sid = getActiveSessionId()
        if (sid) {
          // 离开期间不轮询；回来按 lastSettledAt 懒补算，等价于规则时钟持续走。
          getTaStateView(sid)
          settleTaThoughts(sid)
        }
      }
      armDueTimer()
    }

    const onDataChange = () => {
      // Cloud State 可能在启动 hydration 时拉回“已经到期”的承诺。
      // 先立即检查 overdue，再重排未来 timer；否则 nextTaCommitmentCheckAt 会跳过已过期时间点。
      void checkDueCommitment()
      armDueTimer()
    }

    window.addEventListener('yiwem:ai-reply-committed', onReplyCommitted)
    window.addEventListener(ELUVIN_DATA_CHANGE, onDataChange)
    document.addEventListener('visibilitychange', onVisibility)
    void checkDueCommitment()
    armDueTimer()
    return () => {
      clearDueTimer()
      window.removeEventListener('yiwem:ai-reply-committed', onReplyCommitted)
      window.removeEventListener(ELUVIN_DATA_CHANGE, onDataChange)
      document.removeEventListener('visibilitychange', onVisibility)
    }
  }, [loggedIn, checkDueCommitment])

  const recordInitiativeBackground = useCallback(() => {
    if (!loggedIn) return
    const sessionId = getActiveSessionId()
    if (!sessionId) return
    if (!getSessionsCache().some((session) => String(session.id) === sessionId)) return

    const accountId = getAccount()?.account ?? ''
    if (!accountId) return
    const preference = getInitiativePreference(accountId, sessionId)
    if (!preference.enabled) return

    const latestUserMessageAt = getMessagesCache(sessionId)
      .filter((message) => message.role === 'user' && Number.isFinite(message.ts))
      .reduce((latest, message) => Math.max(latest, message.ts), 0)
    const evaluated = evaluateInitiativeResponse(preference, latestUserMessageAt)
    const leftAt = evaluated.lastBackgroundAt > 0 ? evaluated.lastBackgroundAt : Date.now()
    saveInitiativePreference(accountId, sessionId, {
      ...evaluated,
      lastBackgroundAt: leftAt,
    })
  }, [loggedIn])

  const runInitiativeCatchUpNow = useCallback(async () => {
    if (!loggedIn || document.visibilityState !== 'visible') return
    const sessionId = getActiveSessionId()
    if (!sessionId) return
    const sessions = getSessionsCache()
    const session = sessions.find((item) => String(item.id) === sessionId)
    if (!session) return

    const account = getAccount()
    const token = getToken()
    if (!account?.account || !token) return

    const preference = getInitiativePreference(account.account, sessionId)
    if (!preference.enabled || preference.lastBackgroundAt <= 0) return

    const settings = loadSettings()
    if (!settings.apiKey || !settings.baseUrl || !settings.model) return

    const conversationState = loadConversationState(sessionId)
    const rawMessages = getMessagesCache(sessionId)
    const activeMessages = resolveConversationMessages(conversationState, rawMessages)
    const conversationBranchId = branchIdForNewMessage(conversationState)
    const now = Date.now()
    const latestUserMessageAt = activeMessages
      .filter((message) => message.role === 'user' && Number.isFinite(message.ts))
      .reduce((latest, message) => Math.max(latest, message.ts), 0)
    if (activeMessages.some((message) => message.replyState === 'pending' || message.replyState === 'streaming')) return
    const busy = getBusyState(sessionId)
    if (busy.status === 'busy' && busy.busyUntil > now) return
    const taName = displaySessionName(session)
    const accountId = account.account

    await runInitiativeCatchUp(
      {
        preference,
        leftAt: preference.lastBackgroundAt,
        now,
        futureTopics: futureTopicsFromMessages(activeMessages),
        events: getEvents(sessionId),
        anniversaries: getAnniversaries(sessionId),
        continuity: getTaContinuity(sessionId, now),
        latestUserMessageAt,
      },
      {
        sessionId,
        taName,
        persona: session.persona ?? '',
        lang: getSessionLang(sessionId),
        identityMode: resolveIdentityMode(sessionId),
      },
      {
        estimateTokens: estimateToken,
        generate: async (messages) => {
          let usage: ModelUsage | undefined
          const text = await chatCompletion(settings, messages, {
            maxTokens: 100,
            temperature: 0.85,
            timeoutMs: 20_000,
            onUsage: (value) => { usage = value },
          })
          return { text, ...(usage ? { usage } : {}) }
        },
        commit: async (content) => {
          const stillCommittable = () => {
            if (getAccount()?.account !== accountId || getToken() !== token) return false
            if (getActiveSessionId() !== sessionId) return false
            if (!getInitiativePreference(accountId, sessionId).enabled) return false
            const latestState = loadConversationState(sessionId)
            if (branchIdForNewMessage(latestState) !== conversationBranchId) return false
            const latestMessages = resolveConversationMessages(latestState, getMessagesCache(sessionId))
            if (latestMessages.some((message) => message.replyState === 'pending' || message.replyState === 'streaming')) return false
            if (latestMessages.some((message) => Number.isFinite(message.ts) && message.ts > now)) return false
            return true
          }
          if (!stillCommittable()) return false

          const message = await commitInitiativeMessage({
            sessionId,
            content,
            token,
            accountId,
            ...(conversationBranchId ? { conversationBranchId } : {}),
            shouldCommit: stillCommittable,
          })
          return message != null
        },
        recordUsage: (usage) => {
          if (getAccount()?.account !== accountId || getToken() !== token) return
          recordLocalModelUsageTurn(sessionId, usage, settings)
        },
        savePreference: (next) => {
          if (getAccount()?.account !== accountId || getToken() !== token) return false
          return saveInitiativePreference(accountId, sessionId, next)
        },
        getPreference: () => getInitiativePreference(accountId, sessionId),
        onDelivered: (content) => {
          // 只触达原账号 / 原 TA；生成途中切账号时 commit 已经会拒绝。
          if (getAccount()?.account !== accountId) return
          if (!getSessionsCache().some((item) => String(item.id) === sessionId)) return

          setInitiativeNotice({ accountId, sessionId, taName, content })

          // 系统通知和「TA 主动来找你」是两个独立开关。
          // 系统层只显示通用敲门文案，不把聊天正文暴露在锁屏上；正文仍只在忆文里打开后看。
          void showSystemNotification(
            taName,
            '有一条新消息，打开忆文看看。',
            'eluvin-initiative-' + sessionId,
            systemNotificationTargetUrl(sessionId),
          )
        },
      },
    )
  }, [loggedIn, replaceView])

  useEffect(() => {
    if (!loggedIn) {
      setInitiativeNotice(null)
      return
    }
    const onVisibility = () => {
      if (document.visibilityState === 'hidden') {
        recordInitiativeBackground()
      } else if (document.visibilityState === 'visible') {
        void runInitiativeCatchUpNow()
      }
    }
    const onPageHide = () => recordInitiativeBackground()
    document.addEventListener('visibilitychange', onVisibility)
    window.addEventListener('pagehide', onPageHide)
    return () => {
      document.removeEventListener('visibilitychange', onVisibility)
      window.removeEventListener('pagehide', onPageHide)
    }
  }, [loggedIn, recordInitiativeBackground, runInitiativeCatchUpNow])

  // 登录恢复 / 会话初始化完成后也补一次：真正离开时间来自 lastBackgroundAt，不拿“进 App 时间”冒充。
  useEffect(() => {
    if (!loggedIn || view === 'loading' || document.visibilityState !== 'visible') return
    void runInitiativeCatchUpNow()
  }, [loggedIn, view, runInitiativeCatchUpNow])

  const openInitiativeNotice = useCallback(() => {
    if (!initiativeNotice) return
    const sessionId = initiativeNotice.sessionId
    if (getAccount()?.account !== initiativeNotice.accountId) {
      setInitiativeNotice(null)
      return
    }
    if (!getSessionsCache().some((session) => String(session.id) === sessionId)) {
      setInitiativeNotice(null)
      return
    }
    switchActiveSession(sessionId)
    setInitiativeNotice(null)
    goView('chat')
  }, [initiativeNotice, goView])

  // 选角色页的用途：first=首次/游客新建；current=换个TA·当前会话换人设；new=换个TA·开新会话换TA
  const [roleMode, setRoleMode] = useState<RolePickMode>('first')
  // 选角色页的返回去向：首次/游客/无会话回欢迎页，「换个 TA」回「我的」，角色列表页新建回角色列表
  const [roleBack, setRoleBack] = useState<'welcome' | 'settings' | 'roles' | 'chatprofile'>('welcome')
  // 老数据一键迁移状态（无云端会话 + 本地有旧数据时触发，见 redirectBySessions）
  const [migration, setMigration] = useState<MigrationState>('idle')
  // 已有云端会话恢复时，Conversation Branch 属于“写前必须知道”的状态；首次权威 pull 失败时停在 loading。
  const [startupHydrationFailed, setStartupHydrationFailed] = useState(false)
  const startupHydrationAllowLegacyRef = useRef(true)
  // 已登录用户首次拉会话列表只做一次（StrictMode 双跑防重）
  const redirectStarted = useRef(false)
  const titleClicks = useRef<number[]>([])
  // ConsentGate V1：首次使用先过「开始之前」安全说明（本机已同意当前版本则直接跳过）
  const [firstConsentDone, setFirstConsentDone] = useState<boolean>(() => !consentGateNeeded())
  // 老用户轻量补确认：初始化就按当前账号判断，避免首帧先误打统计再盖 light consent。
  const [needLightConsent, setNeedLightConsent] = useState<boolean>(() => {
    const acct = getAccount()
    return Boolean(isLoggedIn() && acct && !acct.consentVersion)
  })
  useEffect(() => {
    if (!loggedIn) {
      setNeedLightConsent(false)
      return
    }
    const acct = getAccount()
    setNeedLightConsent(Boolean(acct && !acct.consentVersion))
  }, [loggedIn])

  // 第一方访问统计：只有当前版本 consent 已完成，且不处于老用户 light consent 阶段才允许打点。
  // pingSiteHit 自身还会做正式域名 allowlist + 单页防重，双层防线避免预览环境/StrictMode 污染统计。
  useEffect(() => {
    if (!firstConsentDone || needLightConsent) return
    pingSiteHit(API_BASE)
  }, [firstConsentDone, needLightConsent])
  // #21：旧 PWA 与线上 build SHA 不一致时提示刷新；“稍后”只在本次页面内生效，不落 storage。
  const [deployedUpdateVersion, setDeployedUpdateVersion] = useState<string | null>(null)
  const dismissedUpdateVersionRef = useRef<string | null>(null)

  useEffect(() => {
    let cancelled = false
    const currentVersion = getCurrentBuildVersion()
    if (!currentVersion) return () => { cancelled = true }

    // 探测统一走 checkDeployedBuild：「我的 → 检查更新」用的是同一个函数，两处判定不会各写一套。
    const applyDeployed = (version: string | null) => {
      if (cancelled) return
      setDeployedUpdateVersion(version && dismissedUpdateVersionRef.current !== version ? version : null)
    }
    const unsubscribe = subscribeDeployedBuild(applyDeployed)

    const checkVersion = () => {
      void checkDeployedBuild()
    }

    const onVisible = () => {
      if (document.visibilityState === 'visible') checkVersion()
    }
    const onOnline = () => checkVersion()
    const onControllerChange = () => checkVersion()

    checkVersion()
    document.addEventListener('visibilitychange', onVisible)
    window.addEventListener('online', onOnline)
    navigator.serviceWorker?.addEventListener('controllerchange', onControllerChange)
    return () => {
      cancelled = true
      unsubscribe()
      document.removeEventListener('visibilitychange', onVisible)
      window.removeEventListener('online', onOnline)
      navigator.serviceWorker?.removeEventListener('controllerchange', onControllerChange)
    }
  }, [])

  useEffect(() => {
    if (loggedIn) {
      void syncCloudState()
      void closeOldestCandidateWindowOnStartup()
    }
  }, [loggedIn])

  useEffect(() => {
    let active = true
    const refresh = () => {
      const token = getToken()
      if (!token) return
      const requestId = notificationRefreshGuardRef.current.next + 1
      notificationRefreshGuardRef.current.next = requestId
      // V3：消息与通知的事实来源是后端 GET /api/notifications（不再依赖 public 下的静态 feed 文件）。
      void fetch(`${API_BASE}/api/notifications`, {
        cache: 'no-store',
        headers: { Authorization: `Bearer ${token}` },
      })
        .then(async (response) => {
          if (!active) return
          if (response.status === 401) {
            const account = getAccount()
            if (account?.token === token) {
              expiredAccountRef.current = account.account
              logout()
            }
            return
          }
          if (!response.ok) return
          const payload = await response.json() as { revision?: unknown; unread?: unknown }
          const revision = payload.revision
          if (typeof revision !== 'number' || !Number.isInteger(revision) || revision < 0) {
            return
          }
          const refreshGuard = notificationRefreshGuardRef.current
          if (requestId < refreshGuard.applied) return
          refreshGuard.applied = requestId
          setNotificationRevision(revision)
          const unread = payload.unread === true
          const readGuard = notificationReadGuardRef.current
          const staleUnread = unread && revision <= readGuard.revision
          if (!staleUnread) {
            setNotificationServerUnread(unread)
          }
          if (!unread) {
            // 服务端已读：本地镜像对齐，离线首帧也不再冒红点
            persistNotificationReadRevision(revision)
            setNotificationReadRevisionState((current) => Math.max(current, revision))
          }
        })
        .catch(() => {
          // 通知探测失败不影响首页/我的正常使用。
        })
    }

    if (!loggedIn) {
      notificationReadGuardRef.current = { epoch: 0, revision: 0 }
      notificationRefreshGuardRef.current = { next: 0, applied: 0 }
      setNotificationRevision(0)
      setNotificationServerUnread(false)
      return () => { active = false }
    }

    setNotificationReadRevisionState(getNotificationReadRevision())
    refresh()
    const onVisible = () => {
      if (document.visibilityState === 'visible') refresh()
    }
    const onOnline = () => refresh()
    document.addEventListener('visibilitychange', onVisible)
    window.addEventListener('online', onOnline)
    return () => {
      active = false
      document.removeEventListener('visibilitychange', onVisible)
      window.removeEventListener('online', onOnline)
    }
  }, [loggedIn])

  // 已读回写：本地镜像立即生效（红点立刻消失）+ POST /api/notifications/read 落到服务端（只增不减）。
  const markNotificationsRead = useCallback((revision: number) => {
    const readGuard = notificationReadGuardRef.current
    notificationReadGuardRef.current = {
      epoch: readGuard.epoch + 1,
      revision: Math.max(readGuard.revision, revision),
    }
    persistNotificationReadRevision(revision)
    setNotificationReadRevisionState((current) => Math.max(current, revision))
    setNotificationServerUnread(false)
    const token = getToken()
    if (!token) return
    void fetch(`${API_BASE}/api/notifications/read`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({ revision }),
    })
      .then((response) => {
        if (response.status !== 401) return
        const account = getAccount()
        if (account?.token === token) {
          expiredAccountRef.current = account.account
          logout()
        }
      })
      .catch(() => {
        // 回写失败不影响本次浏览：下次进页会再回写一次。
      })
  }, [])

  // 聊天页头部：返回箭头 + 小星球资料卡入口；顶栏标题 = 当前角色名（微信式）
  // controls 只需要 active session id，不依赖 session cache 已经补齐；避免新建/离线会话首帧缺 controls 与底部 safe-area。
  const activeChatSessionId = getActiveSessionId()
  const headerSession = activeChatSessionId
    ? getSessionsCache().find((s) => String(s.id) === activeChatSessionId) ?? null
    : null

  // 老数据一键迁移：建云端会话 → 按升序传消息 → 传记忆（单条失败跳过不中断）→
  // 置位 → 进聊天。本地数据只读不删（红线）；createSession 失败才算整个迁移失败（不置位，可重试）。
  const runMigration = useCallback(async (token: string) => {
    const result = await runLocalMigration(token, '我们的开始')
    if (!result.ok) {
      setMigration('failed')
      return
    }
    switchActiveSession(String(result.sessionId))
    setLocalMigratedFlag()
    setMigration('idle')
    replaceView('chat')
  }, [])

  // 迁移失败后的「重试」：重新走一遍迁移（本地旧数据仍在）
  const retryMigration = () => {
    const token = getToken()
    if (!token) {
      replaceView('welcome')
      return
    }
    setMigration('running')
    void runMigration(token)
  }

  // 迁移失败后的「先跳过，直接新建」：进选角色页，不置位——下次登录有旧数据还会再迁
  const skipMigration = () => {
    setMigration('idle')
    setRoleMode('first')
    setRoleBack('welcome')
    replaceView('role')
  }

  // 已有会话进入“可写”前统一经过这一个门：Cloud State 至少完成一次权威 pull；
  // 真离线时只有本机已经有 conversation state 才允许继续写，未知状态宁可停在 loading。
  const ensureStartupConversationReady = useCallback(async (sessionId: string): Promise<boolean> => {
    try {
      await hydrateCloudState()
      return true
    } catch {
      if (loadConversationState(sessionId)) return true
      setMigration('idle')
      setStartupHydrationFailed(true)
      return false
    }
  }, [])

  // 登录用户分流：拉会话列表 → 有会话进最近会话聊天；没有但有本地旧数据（且没迁过）→ 自动迁移；
  // 没有也没数据 → 进选角色页新建。
  // 拉列表失败（断网等）走本地兜底：只有本机已知 branch 状态的缓存会话可继续写；
  // 本机没有 branch 状态时保持 loading，避免离线先写 root、联网后远端 branch 到达导致消息消失。
  // 这里就把 redirectStarted 置位，避免 view 切到 loading 后下面的挂载 effect 再触发一次重复拉取。
  const redirectBySessions = useCallback(async (options: { allowLegacyFallback?: boolean } = {}) => {
    const allowLegacyFallback = options.allowLegacyFallback !== false
    startupHydrationAllowLegacyRef.current = allowLegacyFallback
    setStartupHydrationFailed(false)
    redirectStarted.current = true
    replaceView('loading')
    const token = getToken()
    if (!token) {
      replaceView('welcome')
      return
    }
    const res = await listSessions(token)
    if (res.ok) {
      const sessions = res.data.sessions
      // S1 头部入口要显示当前角色名：列表直接落缓存，切换/重进不用等角色列表页
      setSessionsCache(sessions)
      // 只有同账号正常启动才允许补种 legacy Cloud State。
      // 跨账号恢复时，旧账号留在浏览器里的 legacy 值绝不能排队到新账号。
      if (allowLegacyFallback) queueLegacyCloudStateBackfill()
      const active = resolveActiveSession(sessions, allowLegacyFallback ? getActiveSessionId() : '')
      if (active) {
        const activeId = String(active.id)
        // Cloud State 已在登录 effect 里并行启动；这里把它提升成“进入可写会话前必须完成”的 barrier。
        // 若另一个标签页正在 pull，hydrateCloudState 会等锁并从最新 cursor 再确认一次。
        if (!await ensureStartupConversationReady(activeId)) return
        // 跨账号恢复只接受这次服务端返回的 session，并从 Home 干净进入；
        // 同账号正常启动仍恢复上次主视图。
        switchActiveSession(activeId)
        setMigration('idle')
        replaceView(allowLegacyFallback ? (getLastPrimaryView() ?? 'home') : 'home')
      } else if (allowLegacyFallback && !hasMigratedFlag() && hasLocalLegacyData()) {
        // 无云端会话 + 本地有旧数据 + 没迁过 → 自动把本地数据搬成第一个会话
        switchActiveSession('')
        setRoleMode('first')
        setMigration('running')
        await runMigration(token)
      } else {
        // 无云端会话且无本地数据（或已迁过）→ 正常进选角色页新建
        switchActiveSession('')
        setMigration('idle')
        const target = decideLoginTarget(sessions)
        if (target === 'role') {
          setRoleMode('first')
          setRoleBack('welcome')
        }
        replaceView(target)
      }
    } else if (!allowLegacyFallback) {
      // 跨账号重登时，绝不读取全局 legacy persona/messages 兜底。
      // 云端 sessions 暂时不可验证，就停在干净的新建 TA 流程，避免把上一账号本地聊天暴露给新账号。
      switchActiveSession('')
      setSessionsCache([])
      setMigration('idle')
      setRoleMode('first')
      setRoleBack('welcome')
      replaceView('role')
    } else if (getActiveSessionId()) {
      const fallbackSessionId = getActiveSessionId()
      if (!await ensureStartupConversationReady(fallbackSessionId)) return
      replaceView('chat')
    } else if (needsRolePick()) {
      setRoleMode('first')
      setRoleBack('welcome')
      replaceView('role')
    } else {
      replaceView('chat')
    }
  }, [runMigration, ensureStartupConversationReady])

  // 访问门禁：需登录 view 且未登录 → 记下目标交给登录墙；游客可看的直接进
  const navigate = (v: View) => {
    if (!isPublicRoute(v) && !loggedIn) {
      setGateTarget(v)
      return
    }
    if (isPublicRoute(v)) {
      setGateTarget(null) // 回到公开页 = 取消待登录的目标
      setPendingTarget(null)
    }
    goView(v)
  }

  useEffect(() => {
    if (!loggedIn) return
    const url = new URL(window.location.href)
    const sessionId = url.searchParams.get('notificationSession')?.trim() || ''
    if (!sessionId) return
    if (!getSessionsCache().some((session) => String(session.id) === sessionId)) return

    switchActiveSession(sessionId)
    url.searchParams.delete('notificationSession')
    window.history.replaceState(window.history.state, '', `${url.pathname}${url.search}${url.hash}`)
    replaceView('chat')
  }, [loggedIn, view, replaceView])

  const openSettings = (target: SettingsPage) => {
    setSettingsTarget(target)
    navigate('settings')
  }

  const openNotifications = (from: 'home' | 'settings') => {
    setNotificationFrom(from)
    navigate('notifications')
  }

  // 反馈与建议：独立全屏页，返回走历史栈（与通知页一致）
  const openFeedback = () => {
    setFeedbackDraft(emptyFeedbackDraft())
    navigate('feedback')
  }

  const openSettingsRoot = () => {
    setSettingsTarget('main')
    setSettingsRootKey((key) => key + 1)
    navigate('settings')
  }

  const openSpaceRoot = () => {
    setSpaceFrom('space')
    setSpaceRootKey((key) => key + 1)
    navigate('aispace')
  }

  const openMemoryRoot = () => {
    setMemoryRootKey((key) => key + 1)
    navigate('memory')
  }

  const openGuide = (from: 'welcome' | 'settings' | 'gate' | 'chat') => {
    if (from === 'gate') {
      // 登录墙 → 指南：把回跳目标收起来，返回时再放回登录墙
      setPendingTarget(gateTarget ?? (!isPublicRoute(view) ? view : null))
      setGateTarget(null)
    }
    setGuideBack(from)
    goView('guide')
  }

  const handleGuideBack = () => {
    if (guideBack === 'gate') {
      const target = pendingTarget
      setPendingTarget(null)
      if (target) {
        setGateTarget(target)
        replaceView(target)
      } else {
        replaceView('welcome')
      }
      return
    }
    window.history.back()
  }

  // 登录墙登录成功：按云端会话分流（有会话进聊天，无会话进选角色新建），
  // 不再硬回登录前的 gateTarget——游客点聊天被拦，登录后也是"有会话的聊天"或"选角色"
  const handleGateDone = async (): Promise<boolean | void> => {
    setGateTarget(null)
    setPendingTarget(null)
    const expiredAccount = expiredAccountRef.current
    expiredAccountRef.current = null
    const currentAccount = getAccount()?.account ?? null

    // 任意受保护页面都可能被后台通知探测打出 401。
    // 若重新登录的是另一个账号，必须先清掉上一账号的会话/草稿，再走正常云端初始化；
    // 即使 listSessions 失败，也不能让 fallback 打开上一账号的本地缓存。
    if (expiredAccount && currentAccount !== expiredAccount) {
      setFeedbackDraft(emptyFeedbackDraft())
      switchActiveSession('')
      setSessionsCache([])
      setPendingChatLogJump(null)
      setPendingMemoryReturn(null)
      setProfileTarget(null)
      setPendingNatural(null)
      setPendingNaturalError(null)
      void redirectBySessions({ allowLegacyFallback: false })
      // LoginForm 会据此跳过旧 /api/sync blob；跨账号恢复只走上面的 server-only 路径。
      return false
    }

    if (view === 'feedback' || view === 'notifications') {
      if (expiredAccount && currentAccount === expiredAccount) {
        replaceView(view)
        return
      }
      // 非“过期后同账号恢复”的普通登录，按现有账号初始化流程走。
      setFeedbackDraft(emptyFeedbackDraft())
      void redirectBySessions()
      return
    }
    const natural = pendingNatural
    if (!natural) {
      void redirectBySessions()
      return
    }

    const activeBefore = getActiveSessionId()
    const created = await createSession(getToken(), { persona: '', title: natural.nickname })
    if (!created.ok) {
      // 不动 activeSession；回 RolePicker 恢复原表单，用户可直接重试。
      switchActiveSession(activeBefore)
      setPendingNaturalError(created.message)
      setRoleMode('first')
      setRoleBack('welcome')
      replaceView('role')
      return
    }

    const sid = String(created.data.id)
    switchActiveSession(sid)
    saveAIProfile({ nickname: natural.nickname, avatar: natural.avatar }, sid)
    saveAIRemark(natural.remark, sid)
    saveAIGender(natural.gender, sid)
    savePersona('')
    setSessionsCache([...getSessionsCache().filter((session) => String(session.id) !== sid), created.data])
    setPendingNatural(null)
    setPendingNaturalError(null)
    replaceView('chat')
  }

  // 产品介绍最后一幕「开始遇见 TA」：游客看完介绍后进入现有首次使用流程。
  // 已登录态通常不会进入 ProductIntro；若登录态变化发生在页面停留期间，仍按云端 sessions 分流。
  const handleWelcomeStart = () => {
    clearVisitWelcome()
    if (isLoggedIn()) {
      void redirectBySessions()
    } else {
      navigate(needsRolePick() ? 'role' : 'chat')
    }
  }

  // Welcome 老用户旁路：不要求重看产品介绍，直接进入现有登录墙。
  const handleWelcomeLogin = () => {
    setPendingTarget(null)
    setGateTarget('chat')
  }

  // 登录墙返回：不登录，回欢迎页继续逛展示内容
  const handleGateBack = () => {
    if (view === 'feedback') setFeedbackDraft(emptyFeedbackDraft())
    // 保留 401 前的账号身份；用户之后若登录另一个账号，仍会进入严格隔离路径。
    setGateTarget(null)
    setPendingTarget(null)
    setPendingNatural(null)
    setPendingNaturalError(null)
    replaceView('welcome')
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

  // ---- 会话列表（微信式主页：底部导航「聊天」tab 内容） ----
  // 会话列表嵌在 main 里（带底部导航），改名/删除/切换都由 RolesPage 自持，
  // App 只保留「拉列表刷新缓存」（新建会话后用）和三个导航回调（返回/新建/切完回聊天）。

  // 拉后端会话列表刷新缓存（角色列表页新建会话后用，让聊天页头部入口显示最新角色名）
  const refreshSessions = useCallback(async () => {
    const token = getToken()
    if (!token) return
    const res = await listSessions(token)
    if (res.ok) {
      setSessionsCache(res.data.sessions)
    }
  }, [])

  // 角色列表页「新建」：进选角色页（first=新建），返回时回角色列表页
  const handleRolesNew = () => {
    setRoleBack('roles')
    setRoleMode('first')
    goView('role')
  }

  // 已登录用户首次挂载直接从 loading 拉云端会话分流；登录成功后同样走这条会话恢复链。
  // redirectBySessions 内部已置位 redirectStarted，这里只需判重。
  useEffect(() => {
    if (!loggedIn || redirectStarted.current || view !== 'loading') return
    void redirectBySessions()
  }, [loggedIn, view, redirectBySessions])

  useEffect(() => {
    const applyPageVisibilityClass = () => {
      document.documentElement.classList.toggle('eluvin-page-hidden', document.visibilityState !== 'visible')
    }
    applyPageVisibilityClass()
    document.addEventListener('visibilitychange', applyPageVisibilityClass)
    return () => {
      document.removeEventListener('visibilitychange', applyPageVisibilityClass)
      document.documentElement.classList.remove('eluvin-page-hidden')
    }
  }, [])

  // 登录墙是否展示：正在请求需登录 view 且未登录；或已登录页退出后落在需登录 view
  const gateShown = (gateTarget !== null || !isPublicRoute(view)) && !loggedIn

  // Responsive App Shell：由 React 明确告诉样式“主导航是否真的存在”，不让 CSS 猜 DOM。
  const primaryNavVisible =
    loggedIn &&
    !needLightConsent &&
    !gateShown &&
    isNavView(view) &&
    !(view === 'settings' && settingsPrivacyOpen)

  return (
    <div className={`app${primaryNavVisible ? ' app--with-primary-nav' : ''}`}>
      {deployedUpdateVersion && (
        <div className="version-update-notice" role="status" aria-live="polite">
          <span className="version-update-notice-copy">发现新版本，刷新后即可使用</span>
          <div className="version-update-notice-actions">
            <button type="button" className="version-update-now" onClick={() => void refreshToLatest()}>
              立即刷新
            </button>
            <button
              type="button"
              className="version-update-later"
              onClick={() => {
                dismissedUpdateVersionRef.current = deployedUpdateVersion
                setDeployedUpdateVersion(null)
              }}
            >
              稍后
            </button>
          </div>
        </div>
      )}
      <WellbeingGuard enabled={loggedIn && !gateShown && !needLightConsent} />
            {commitmentReminder && loggedIn && !gateShown && !needLightConsent && (
        <div className="commitment-reminder" role="status" aria-live="polite">
          <div>
            <strong>{loadAIProfile(commitmentReminder.sessionId).nickname || 'TA'} 答应你的事</strong>
            <span>{commitmentReminder.text}</span>
          </div>
          <button
            type="button"
            onClick={() => {
              commitmentReminderRef.current = null
              setCommitmentReminder(null)
              window.setTimeout(checkDueCommitment, 0)
            }}
            aria-label="收起"
          >
            ×
          </button>
        </div>
      )}
      {initiativeNotice && loggedIn && !gateShown && !needLightConsent && (
        <div className="initiative-notice" role="status" aria-live="polite">
          <button type="button" className="initiative-notice-main" onClick={openInitiativeNotice}>
            <strong>{initiativeNotice.taName}</strong>
            <span>{initiativeNotice.content}</span>
          </button>
          <button
            type="button"
            className="initiative-notice-close"
            aria-label="收起"
            onClick={() => setInitiativeNotice(null)}
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" aria-hidden="true">
              <path d="M6 6l12 12" />
              <path d="M18 6L6 18" />
            </svg>
          </button>
        </div>
      )}
      <Suspense fallback={<div className="session-loading" />}>
      {loggedIn && needLightConsent ? (
        // ConsentGate V1：老用户/登录态无服务端 consent 记录 → 轻量补确认（同意后上报服务端留档）
        <ConsentGate mode="light" onDone={() => setNeedLightConsent(false)} />
      ) : gateShown ? (
        // ConsentGate V1：首次进入先过「开始之前」安全说明（双勾选+同意），过了才进登录/注册
        !firstConsentDone ? (
          <ConsentGate
            mode="full"
            onDone={() => {
              // 记住「本次进站已经过完整披露」：注册新账号时要用它区分
              // 「刚在本机勾过」和「复用旧账号留下的同意记录」（后者必须重新勾）
              try {
                sessionStorage.setItem('eluvin_consent_session', '1')
              } catch {
                // 隐私模式下不可用：不阻塞，注册那一步会再弹一次
              }
              setFirstConsentDone(true)
            }}
          />
        ) : (
          <LoginGate onDone={handleGateDone} onGoGuide={() => openGuide('gate')} onBack={handleGateBack} />
        )
      ) : view === 'productintro' ? (
        <ProductIntro onBack={() => window.history.back()} onStart={handleWelcomeStart} />
      ) : view === 'guide' ? (
        <GuideDetail onBack={handleGuideBack} onGoProvider={() => openSettings('provider')} />
      ) : view === 'welcome' ? (
        <Welcome
          onGoGuide={() => navigate('productintro')}
          onLogin={handleWelcomeLogin}
          loggedIn={loggedIn}
          onGoHome={() => navigate('home')}
        />
      ) : view === 'role' ? (
        <RolePicker
          mode={roleMode}
          onDone={(info) => {
            // Natural 创建后直接进聊天；其他登录用户保留新建后回首页的原流程。
            // 游客 Natural 填完资料会走 LoginGate：这时 info?.startChat 也可能为真，
            // 但不能把待用的草稿清掉——只有已登录并真的建出 Natural session 才清（TA-NATURAL-01 blocker）。
            if (info?.startChat && loggedIn) {
              setPendingNatural(null)
              setPendingNaturalError(null)
            }
            navigate(info?.startChat || !loggedIn ? 'chat' : 'home')
            // 新建会话后顺手拉一次列表：角色列表/头部入口都能立刻显示新角色名
            void refreshSessions()
          }}
          onNaturalLogin={(setup) => {
            setPendingNatural(setup)
            setPendingNaturalError(null)
          }}
          initialNatural={pendingNatural ?? undefined}
          initialNaturalError={pendingNaturalError ?? undefined}
          onBack={() => navigate(loggedIn && roleBack === 'welcome' ? 'home' : roleBack)}
          onLogin={() => setGateTarget('chat')}
        />
      ) : view === 'chatsettings' ? (
        <ChatSettings
          onBack={() => window.history.back()}
          onRefreshed={() => window.history.back()}
        />
      ) : view === 'chatprofile' ? (
        <ChatProfile
          sessionIdOverride={pendingChatLogJump?.sessionId ?? profileTarget ?? undefined}
          initialPage={pendingChatLogJump ? 'chats' : 'home'}
          chatLogTarget={pendingChatLogJump}
          onClose={() => {
            setProfileTarget(null)
            if (pendingChatLogJump) {
              window.history.back()
              return
            }
            window.history.back()
          }}
          onGoMine={() => navigate('settings')}
          fromRoles={detailFrom === 'roles'}
          onChat={() => {
            // 资料卡「和 TA 聊天」：临时查看的角色先落成当前会话，再进聊天
            if (profileTarget) {
              switchActiveSession(profileTarget)
              setProfileTarget(null)
            }
            goView('chat')
          }}
        />
      ) : view === 'aboutme' ? (
        <AboutMe onBack={() => window.history.back()} />
      ) : view === 'weekly' ? (
        <WeeklyPage onBack={() => window.history.back()} onGoSettings={() => openSettings('provider')} />
      ) : view === 'thoughts' ? (
        <ThoughtBook onBack={() => window.history.back()} />
      ) : view === 'listen' ? (
        <ListenTogether onBack={() => window.history.back()} />
      ) : view === 'starjar' ? (
        <StarJar onBack={() => window.history.back()} />
      ) : view === 'spacelife' ? (
        <SpaceLife
          aiNickname={loadAIProfile(getActiveSessionId() || undefined).nickname}
          yourName={loadUserProfile().nickname || '你'}
          sessionId={getActiveSessionId() || undefined}
          hasPersona={Boolean(getActiveSessionId()) || Boolean(loadPersona().trim())}
          onGoMine={() => openSettings('main')}
          onBack={() => window.history.back()}
        />
      ) : view === 'feedback' ? (
        <FeedbackPage
          initialDraft={feedbackDraft}
          onDraftChange={setFeedbackDraft}
          onAuthExpired={rememberExpiredAccount}
          onBack={() => {
            setFeedbackDraft(emptyFeedbackDraft())
            window.history.back()
          }}
        />
      ) : view === 'loading' ? (
        <div className="session-loading">
          {startupHydrationFailed ? (
            <>
              <p>聊天还没接上，点重试再试一次。</p>
              <div className="migrate-actions">
                <button
                  type="button"
                  className="btn btn-primary"
                  onClick={() => {
                    setStartupHydrationFailed(false)
                    void redirectBySessions({ allowLegacyFallback: startupHydrationAllowLegacyRef.current })
                  }}
                >
                  重试
                </button>
              </div>
            </>
          ) : migration === 'failed' ? (
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
          {/* UI2-03 Visual Closure V2 / BUG-B：Memory 页删除旧全局品牌题头「忆文 / 忆过往，成文思」——
              不渲染、不占位（Home 本就无 header；memory 与 notifications 独立全屏页不再渲染，其余视图品牌展示不受影响） */}
          {view === 'home' || view === 'aispace' || view === 'memory' || view === 'notifications' ? null : (
            <header className="app-header">
              {view === 'chat' && loggedIn && (
                <button
                  type="button"
                  className="session-list-entry"
                  onClick={() => navigate('home')}
                  aria-label="返回首页"
                  title="返回首页"
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
                    <path d="M15 18l-6-6 6-6" />
                  </svg>
                </button>
              )}
              {view === 'chat' && (
                <button
                  type="button"
                  className="chat-header-planet"
                  onClick={() => {
                    setDetailFrom('chat')
                    setProfileTarget(null)
                    goView('chatprofile')
                  }}
                  aria-label="打开 TA 的资料卡"
                  title="TA 的资料卡"
                >
                  <PlanetIcon />
                </button>
              )}
              {view === 'chat' && loggedIn && (
                <button
                  type="button"
                  className="chat-header-settings"
                  onClick={() => goView('chatsettings')}
                  aria-label="打开聊天设置"
                  title="聊天设置"
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
                    <circle cx="12" cy="12" r="3" />
                    <path d="M19.4 15a1.7 1.7 0 0 0 .34 1.88l.06.06-2.12 2.12-.06-.06a1.7 1.7 0 0 0-1.88-.34 1.7 1.7 0 0 0-1.03 1.56V20.3h-3v-.08a1.7 1.7 0 0 0-1.03-1.56 1.7 1.7 0 0 0-1.88.34l-.06.06-2.12-2.12.06-.06A1.7 1.7 0 0 0 7 15a1.7 1.7 0 0 0-1.56-1.03H5.3v-3h.14A1.7 1.7 0 0 0 7 9.94a1.7 1.7 0 0 0-.34-1.88L6.6 8l2.12-2.12.06.06A1.7 1.7 0 0 0 10.66 6a1.7 1.7 0 0 0 1.03-1.56V4.3h3v.14A1.7 1.7 0 0 0 15.72 6a1.7 1.7 0 0 0 1.88-.34l.06-.06 2.12 2.12-.06.06a1.7 1.7 0 0 0-.34 1.88 1.7 1.7 0 0 0 1.56 1.03h.14v3h-.14A1.7 1.7 0 0 0 19.4 15z" />
                  </svg>
                </button>
              )}
              {view === 'chat' ? (
                <div className="chat-header-identity">
                  <div className="chat-header-name-row">
                    <h1 className="app-title chat-header-name">{headerSession ? displaySessionName(headerSession) : ''}</h1>
                    <span className="chat-header-ai-badge" title="AI 陪伴服务">AI</span>
                  </div>
                  <ChatHeaderPresence sessionId={headerSession ? String(headerSession.id) : null} />
                </div>
              ) : (
                <h1 className="app-title" onClick={handleTitleClick}>
                  忆文
                </h1>
              )}
              {view !== 'chat' && <p className="app-subtitle">忆过往，成文思</p>}
            </header>
          )}

          <main className="app-main">
            {view === 'home' && (
              <Home
                onGoChat={() => navigate('chat')}
                onGoLife={() => goView('spacelife')}
                onGoAnniversary={() => openSettings('anniversary')}
                onGoNotifications={() => openNotifications('home')}
                hasUnreadNotifications={hasUnreadNotifications}
              />
            )}
            {view === 'roles' && (
              <RolesPage
                onBack={() => window.history.back()}
                onNew={handleRolesNew}
                onSwitch={() => navigate('home')}
                onOpenProfile={(sid) => {
                  setDetailFrom('roles')
                  setProfileTarget(sid)
                  goView('chatprofile')
                }}
                onSelectDone={() => navigate('home')}
                standalone
              />
            )}
            {view === 'chat' && (
              <div className="chat-shell">
                <Chat
                  key={headerSession ? String(headerSession.id) : 'no-session'}
                  // 空态「现在就去配置」直接进服务商配置页（原来落到「我的」主页，用户找不到配置在哪）
                  onGoSettings={() => openSettings('provider')}
                  // 「先看使用指南」从聊天页进入的，返回就回聊天页（原来返回落到「我的」）
                  onGoGuide={() => openGuide('chat')}
                  onOpenProfile={() => {
                    setDetailFrom('chat')
                    goView('chatprofile')
                  }}
                />
              </div>
            )}
            {view === 'settings' && (
              <Settings
                key={`${settingsTarget}-${settingsRootKey}`}
                initialPage={settingsTarget}
                onInitialPageBack={() => window.history.back()}
                onPrivacyOpenChange={setSettingsPrivacyOpen}
                onGoFeedback={openFeedback}
                onGoWelcome={() => navigate('welcome')}
                onGoGuide={() => openGuide('settings')}
                onGoWorkChat={() => navigate('chat')}
                onGoRoles={() => navigate('roles')}
                onGoAboutMe={() => {
                  setDetailFrom('settings')
                  navigate('aboutme')
                }}
                onGoSpace={() => {
                  setSpaceFrom('space')
                  navigate('aispace')
                }}
                onGoProfile={() => {
                  setDetailFrom('settings')
                  setProfileTarget(null)
                  navigate('chatprofile')
                }}
              />
            )}
            {view === 'notifications' && (
              <NotificationsPage
                onBack={() => window.history.back()}
                onRead={markNotificationsRead}
                onAuthExpired={rememberExpiredAccount}
              />
            )}
            {view === 'aispace' && (
              <AISpace
                key={spaceRootKey}
                onOpenStarJar={() => navigate('starjar')}
                onOpenThoughts={() => navigate('thoughts')}
                onOpenListen={() => navigate('listen')}
                onOpenWeekly={() => {
                  setDetailFrom('aispace')
                  navigate('weekly')
                }}
              />
            )}
            {view === 'memory' && (
              <Memory
                key={memoryRootKey}
                onJumpToChatLog={(target, returnTarget) => {
                  setPendingChatLogJump(target)
                  // 只有真的跳转成功才记录返回目标（失败路径不会走到这里，不会污染 target）
                  setPendingMemoryReturn(returnTarget ?? null)
                  setDetailFrom('memory')
                  goView('chatprofile')
                }}
                initialDetail={pendingMemoryReturn}
                onInitialDetailConsumed={() => {
                  setPendingMemoryReturn(null)
                  setPendingChatLogJump(null)
                }}
              />
            )}
          </main>

          {primaryNavVisible && (
            <nav className="app-nav">
              <button
                className={`nav-btn${navActive('ta') ? ' active' : ''}`}
                onClick={() => navigate('home')}
              >
                TA
              </button>
              <button
                className={`nav-btn${navActive('space') ? ' active' : ''}`}
                onClick={openSpaceRoot}
              >
                空间
              </button>
              <button
                className={`nav-btn${navActive('memory') ? ' active' : ''}`}
                onClick={openMemoryRoot}
              >
                记忆
              </button>
              <button
                className={`nav-btn${navActive('mine') ? ' active' : ''}`}
                onClick={openSettingsRoot}
              >
                我的
              </button>
            </nav>
          )}
        </>
      )}
      </Suspense>
    </div>
  )
}
