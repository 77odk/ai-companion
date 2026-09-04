import { useEffect, useRef, useState, type ReactNode } from 'react'
import ProviderSelect from './ProviderSelect'
import AvatarPicker from './AvatarPicker'
import DefaultAvatar from './DefaultAvatar'
import Account from './Account'
import GenderSelect from './GenderSelect'
import Work from './Work'
import Appearance from './Appearance'
import {
  DEFAULT_SETTINGS,
  isSlowLetterMode,
  loadSettings,
  loadPersona,
  loadUserProfile,
  loadAIProfile,
  loadAIRemark,
  loadAIGender,
  saveSettings,
  savePersona,
  saveUserProfile,
  saveAIProfile,
  saveAIRemark,
  saveAIGender,
  setSlowLetterMode,
  PROVIDER_NAMES,
  type AIGender,
  type ModelSettings,
  type Provider,
  type UserProfile,
  type AIProfile,
} from '../lib/storage'
import { getAccount } from '../lib/sync'
import { getToken, isLoggedIn, logout } from '../lib/auth'
import { ChatError, testConnection } from '../lib/api'
import { keyFormatHint } from '../lib/keyFormat'
import { extractOpeningLine, extractPersonality, extractBackgroundLine, applyPersonaEdits } from '../lib/customPersona'
import { listSessions, patchSession, type Session } from '../lib/sessionApi'
import { getActiveSessionId, getSessionsCache, setSessionsCache } from '../lib/sessionStore'
import {
  patchSessionInList,
  resolveRoleName,
  resolveRolePersona,
  roleInitial,
} from '../lib/sessionProfile'

type TestState = 'idle' | 'testing' | 'success' | 'error'

/** 设置页子页：使用指南已抽成 App 独立 view（guide），不再嵌在这里 */
export type SettingsPage = 'main' | 'ai' | 'provider' | 'about' | 'account' | 'work' | 'appearance'

interface Props {
  onGoWelcome?: () => void
  /** 「使用指南」入口：由 App 切到独立 guide view（游客也可看） */
  onGoGuide?: () => void
  /** 工作台「跟 TA 说」→ 切到聊天页（工作台展示模式用） */
  onGoWorkChat?: () => void
  /** 进入设置页时打开的子页 */
  initialPage?: SettingsPage
}

export default function Settings({ onGoWelcome, onGoGuide, onGoWorkChat, initialPage }: Props) {
  const [page, setPage] = useState<SettingsPage>(initialPage ?? 'main')

  if (page === 'provider') {
    return <ProviderDetail onBack={() => setPage('main')} onGoGuide={onGoGuide} />
  }
  if (page === 'about') {
    return <AboutDetail onBack={() => setPage('main')} onGoWelcome={onGoWelcome} />
  }
  if (page === 'account') {
    return <Account onBack={() => setPage('main')} />
  }
  if (page === 'work') {
    return (
      <div className="page settings-page work-subpage">
        <DetailHeader title="工作台" onBack={() => setPage('main')} />
        <Work onGoChat={onGoWorkChat} />
      </div>
    )
  }
  if (page === 'appearance') {
    return <Appearance onBack={() => setPage('main')} />
  }
  return (
    <MainCenter
      onOpenAccount={() => setPage('account')}
      onOpenProvider={() => setPage('provider')}
      onOpenGuide={() => onGoGuide?.()}
      onOpenAbout={() => setPage('about')}
      onOpenWork={() => setPage('work')}
      onOpenAppearance={() => setPage('appearance')}
      onGoWelcome={onGoWelcome}
    />
  )
}

/* ---------------- 详情页通用：左上角返回 ---------------- */

function DetailHeader({ title, onBack }: { title: string; onBack: () => void }) {
  return (
    <div className="detail-header">
      <button type="button" className="detail-back" onClick={onBack} aria-label="返回「我的」">
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
      <h2 className="detail-title">{title}</h2>
      <span className="detail-spacer" aria-hidden="true" />
    </div>
  )
}

/* ---------------- 主页面：顶部资料卡 + 分组入口 ---------------- */

function MainCenter({
  onOpenAccount,
  onOpenProvider,
  onOpenGuide,
  onOpenAbout,
  onOpenWork,
  onOpenAppearance,
  onGoWelcome,
}: {
  onOpenAccount: () => void
  onOpenProvider: () => void
  onOpenGuide: () => void
  onOpenAbout: () => void
  onOpenWork: () => void
  onOpenAppearance: () => void
  onGoWelcome?: () => void
}) {
  const [user, setUser] = useState<UserProfile>(() => loadUserProfile())
  const [picking, setPicking] = useState(false)
  // 全局慢信笔友模式开关（W1-2）：读一次，切换即存 localStorage
  const [slowLetter, setSlowLetter] = useState<boolean>(() => isSlowLetterMode())
  // 登录状态：只在进「我的」页时读一次；去账号页登录/退出回来会重新挂载，读到最新值
  const accountLabel = getAccount()?.account ?? null
  const loggedIn = isLoggedIn()

  const updateUser = (patch: Partial<UserProfile>) => {
    const next = { ...user, ...patch }
    setUser(next)
    saveUserProfile(next)
  }

  const handleLogout = () => {
    if (!window.confirm('退出登录后，本地记录不会丢；下次登录同一账号就能找回来。确定退出吗？')) return
    logout()
    onGoWelcome?.()
  }

  return (
    <div className="page settings-page">
      <div className="profile-card">
        <div className="profile-avatar-wrap">
          <button
            type="button"
            className="profile-avatar"
            onClick={() => setPicking((p) => !p)}
            aria-label={picking ? '收起头像选择' : '更换头像'}
          >
            {user.avatar.startsWith('data:') ? (
              <img src={user.avatar} alt="我的头像" />
            ) : (
              <DefaultAvatar kind="user" className="avatar-default" />
            )}
            <span className="profile-avatar-badge">
              <svg
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.8"
                strokeLinecap="round"
                strokeLinejoin="round"
                aria-hidden="true"
              >
                <path d="M4 8h3l2-2.5h6L17 8h3a1 1 0 0 1 1 1v9a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V9a1 1 0 0 1 1-1z" />
                <circle cx="12" cy="13.5" r="3.2" />
              </svg>
            </span>
          </button>
        </div>

        <input
          className="profile-name"
          type="text"
          placeholder="你希望 TA 怎么叫你？"
          value={user.nickname}
          onChange={(e) => updateUser({ nickname: e.target.value })}
          autoComplete="off"
        />
        <input
          className="profile-bio"
          type="text"
          placeholder="一句话介绍自己，让 TA 更懂你"
          value={user.bio}
          onChange={(e) => updateUser({ bio: e.target.value })}
          autoComplete="off"
        />

        {picking && (
          <div className="profile-avatar-pick">
            <AvatarPicker value={user.avatar} onChange={(avatar) => updateUser({ avatar })} />
          </div>
        )}
      </div>

      <ProfileGroup title="账号">
        <EntryRow
          icon={<CloudSyncIcon />}
          label="账号与同步"
          onClick={onOpenAccount}
          status={accountLabel ?? '未登录'}
        />
      </ProfileGroup>

      <ProfileGroup title="设置">
        <EntryRow icon={<KeyIcon />} label="服务商配置" onClick={onOpenProvider} />
        <EntryRow icon={<PaletteIcon />} label="外观" onClick={onOpenAppearance} />
        <EntryRow icon={<WorkIcon />} label="工作台" onClick={onOpenWork} />
        <EntryRow icon={<BookIcon />} label="使用指南" onClick={onOpenGuide} />
      </ProfileGroup>

      <ProfileGroup title="周记">
        <div className="slow-letter-row">
          <div className="slow-letter-text">
            <span className="slow-letter-title">开启全局慢信笔友模式</span>
            <span className="slow-letter-desc">开启后，所有批阅强制封存，关闭即时回复，全部等待 TA 下一篇周记回信。</span>
            <span className="slow-letter-hint">强书信拉扯体验，不推荐新用户开启。</span>
          </div>
          <button
            type="button"
            role="switch"
            aria-checked={slowLetter}
            aria-label="开启全局慢信笔友模式"
            className={`settings-switch${slowLetter ? ' on' : ''}`}
            onClick={() => {
              const next = !slowLetter
              setSlowLetter(next)
              setSlowLetterMode(next)
            }}
          >
            <span className="settings-switch-thumb" />
          </button>
        </div>
      </ProfileGroup>

      <ProfileGroup title="关于忆文">
        <EntryRow icon={<InfoIcon />} label="关于" onClick={onOpenAbout} />
      </ProfileGroup>

      {loggedIn && (
        <button type="button" className="btn logout-btn" onClick={handleLogout}>
          退出登录
        </button>
      )}
    </div>
  )
}

function ProfileGroup({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="profile-group">
      <h3 className="profile-group-title">{title}</h3>
      <div className="profile-group-card">{children}</div>
    </section>
  )
}

function EntryRow({
  icon,
  label,
  onClick,
  status,
}: {
  icon: ReactNode
  label: string
  onClick: () => void
  status?: string
}) {
  return (
    <button type="button" className="entry-row" onClick={onClick}>
      <span className="entry-icon">{icon}</span>
      <span className="entry-label">{label}</span>
      {status && <span className="entry-status">{status}</span>}
      <svg
        className="entry-chevron"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden="true"
      >
        <path d="M9 6l6 6-6 6" />
      </svg>
    </button>
  )
}

/* ---------------- 分组入口的小图标（线条 SVG） ---------------- */

const CloudSyncIcon = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M7 18a4 4 0 0 1 0-8 5 5 0 0 1 9.7-1.5A4 4 0 0 1 17 18H7z" />
    <path d="M12 9.5v6" />
    <path d="M9.5 13l2.5 2.5 2.5-2.5" />
  </svg>
)


const KeyIcon = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <circle cx="7.5" cy="15.5" r="3.5" />
    <path d="M10 13L21 2" />
    <path d="M15.5 7.5l3 3" />
    <path d="M18.5 4.5l3 3" />
  </svg>
)

const InfoIcon = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <circle cx="12" cy="12" r="9" />
    <path d="M12 8h.01" />
    <path d="M11 12h1v4h1" />
  </svg>
)

const BookIcon = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20" />
    <path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z" />
  </svg>
)

const WorkIcon = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <rect x="3" y="7" width="18" height="13" rx="2" />
    <path d="M8 7V5a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
    <path d="M3 12h18" />
  </svg>
)

const PaletteIcon = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M12 3a9 9 0 1 0 0 18h1.2a1.8 1.8 0 0 0 1.3-3 1.8 1.8 0 0 1 1.3-3H18A4 4 0 0 0 21 11a8 8 0 0 0-9-8z" />
    <circle cx="7.5" cy="10.5" r="1.2" />
    <circle cx="12" cy="7.5" r="1.2" />
    <circle cx="16.5" cy="10.5" r="1.2" />
  </svg>
)

/* ---------------- 详情页：TA 的资料 ---------------- */

/**
 * TA 的资料 = 角色设定卡完整版（TASK-UI1）：
 * 头像 / 姓名 / 备注 / 性别 / 性格特质 / 关系&背景 / 开场第一句，每项可改。
 * 有会话（登录）→ 姓名/人设 patchSession 同步到当前角色；无会话 → 兜底写全局 key。
 * 姓名/头像存 ai_companion_ai_profile，备注 ai_companion_ai_remark，性别 ai_companion_ai_gender，
 * 性格/背景/开场白拼回 ai_companion_persona。
 */
export function AIDetail({ onBack, onOpenSpace }: { onBack: () => void; onOpenSpace?: () => void }) {
  const [sessions, setSessions] = useState<Session[]>(() => getSessionsCache())
  // TA 资料按会话隔离：有当前会话 → 读该会话自己的头像/姓名；无会话回落全局（游客/过渡态）
  const [ai, setAI] = useState<AIProfile>(() => loadAIProfile(getActiveSessionId() || undefined))
  const [globalPersona, setGlobalPersona] = useState(() => loadPersona())
  const [remark, setRemark] = useState(() => loadAIRemark(getActiveSessionId() || undefined))
  const [gender, setGender] = useState<AIGender>(() => loadAIGender(getActiveSessionId() || undefined))
  // 各字段草稿：null = 还没动过，显示当前值（会话刷新后自动跟着变）；改过才进草稿
  const [nameDraft, setNameDraft] = useState<string | null>(null)
  const [personalityDraft, setPersonalityDraft] = useState<string | null>(null)
  const [backgroundDraft, setBackgroundDraft] = useState<string | null>(null)
  const [openingDraft, setOpeningDraft] = useState<string | null>(null)
  const [remarkDraft, setRemarkDraft] = useState<string | null>(null)
  const [savedField, setSavedField] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const savedTimer = useRef<number | undefined>(undefined)
  // 本页已保存过改动：拉列表回来的旧数据别覆盖本地刚存的新值（防竞态）
  const dirtyRef = useRef(false)

  const activeSessionId = getActiveSessionId()
  // 有会话 id（哪怕缓存还没拉到）= 有角色；无会话/游客 → 引导 + 全局兜底
  const hasSession = Boolean(activeSessionId)
  const roleName = resolveRoleName(activeSessionId, sessions, ai.nickname)
  const rolePersona = resolveRolePersona(activeSessionId, sessions, globalPersona)
  const nameValue = nameDraft ?? roleName
  const personalityValue = personalityDraft ?? extractPersonality(rolePersona)
  const backgroundValue = backgroundDraft ?? extractBackgroundLine(rolePersona)
  const openingValue = openingDraft ?? extractOpeningLine(rolePersona)
  const remarkValue = remarkDraft ?? remark

  // 打开资料卡时拉一次会话列表：别处（角色列表/换 TA）改过之后，缓存同步成后端最新
  useEffect(() => {
    const token = getToken()
    if (!token) return
    let cancelled = false
    listSessions(token).then((res) => {
      if (cancelled || !res.ok || dirtyRef.current) return
      const list = res.data.sessions
      setSessions(list)
      setSessionsCache(list)
    })
    return () => {
      cancelled = true
      window.clearTimeout(savedTimer.current)
    }
  }, [])

  const flashSaved = (field: string) => {
    setSavedField(field)
    window.clearTimeout(savedTimer.current)
    savedTimer.current = window.setTimeout(() => setSavedField(null), 2000)
  }

  // 把后端改动合并回本地缓存：在列表里 → 只改传入字段；不在列表（刚建/缓存还没拉到）→ 用后端返回补上
  const commitSessionChange = (patch: { title?: string; persona?: string }, server: Session | null) => {
    const id = String(activeSessionId)
    const exists = sessions.some((s) => String(s.id) === id)
    const next = exists ? patchSessionInList(sessions, activeSessionId, patch) : server ? [...sessions, server] : sessions
    setSessions(next)
    setSessionsCache(next)
  }

  // 改名：有会话 patchSession title（列表/聊天顶/空间/资料卡全部更新，微信备注式）；全局 ai_profile.nickname 始终同步
  const handleSaveName = async () => {
    const t = nameValue.trim()
    if (!t || saving) return
    if (hasSession && !getToken()) return
    setSaving(true)
    try {
      if (hasSession) {
        const res = await patchSession(getToken(), activeSessionId, { title: t })
        if (!res.ok) {
          window.alert('没改掉，网络开小差了，稍后再试试。')
          return
        }
        commitSessionChange({ title: t }, res.data)
      }
      const next = { ...ai, nickname: t }
      setAI(next)
      // 按会话隔离：有当前会话写该角色自己的 key，改 A 不影响 B
      saveAIProfile(next, hasSession ? activeSessionId : undefined)
      dirtyRef.current = true
      setNameDraft(t)
      flashSaved('name')
    } finally {
      setSaving(false)
    }
  }

  // 改备注：按会话写（角色隔离）
  const handleSaveRemark = () => {
    const v = remarkValue.trim()
    setRemark(v)
    saveAIRemark(v, getActiveSessionId() || undefined)
    dirtyRef.current = true
    setRemarkDraft(v)
    flashSaved('remark')
  }

  // 改性别：按会话写（角色隔离）
  const handleSaveGender = (g: AIGender) => {
    setGender(g)
    saveAIGender(g, getActiveSessionId() || undefined)
    dirtyRef.current = true
    flashSaved('gender')
  }

  // 改头像：写当前角色的会话 key（无会话回落全局），改 A 不影响 B
  const updateAvatar = (avatar: string) => {
    const next = { ...ai, avatar }
    setAI(next)
    saveAIProfile(next, hasSession ? activeSessionId : undefined)
  }

  /**
   * 保存人设相关字段（性格/背景/开场白）：三个草稿一起拼成新 persona。
   * 有会话 patchSession persona（只影响当前角色）；全局 ai_companion_persona 始终同步（设定卡对应 key）。
   */
  const handleSavePersonaField = async (field: 'personality' | 'background' | 'opening') => {
    if (saving) return
    if (hasSession && !getToken()) return
    const edits = { personality: personalityValue, background: backgroundValue, opening: openingValue }
    const nextPersona = applyPersonaEdits(rolePersona, edits)
    setSaving(true)
    try {
      if (hasSession) {
        const res = await patchSession(getToken(), activeSessionId, { persona: nextPersona })
        if (!res.ok) {
          window.alert('没改掉，网络开小差了，稍后再试试。')
          return
        }
        commitSessionChange({ persona: nextPersona }, res.data)
      }
      setGlobalPersona(nextPersona)
      savePersona(nextPersona)
      dirtyRef.current = true
      // 同步草稿，让其它字段显示跟着刚保存的整份人设走
      setPersonalityDraft(personalityValue)
      setBackgroundDraft(backgroundValue)
      setOpeningDraft(openingValue)
      flashSaved(field)
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="page settings-page">
      <DetailHeader title="TA 的资料" onBack={onBack} />

      {!hasSession && (
        <div className="settings-card">
          <p className="hint">登录并开始聊天后，这里就是 TA 的资料卡。</p>
        </div>
      )}

      <div className="settings-card ai-role-card">
        {ai.avatar.startsWith('data:') ? (
          <img className="ai-role-avatar-img" src={ai.avatar} alt="" />
        ) : (
          <span className="ai-role-avatar" aria-hidden="true">
            {roleInitial(roleName)}
          </span>
        )}
        <div className="ai-role-info">
          <span className="ai-role-name">{roleName}</span>
          <span className="ai-role-sub">这是 TA 的资料卡，改动会存回本地并同步当前角色</span>
        </div>
      </div>

      <div className="settings-card">
        <div className="field">
          <label>TA 的头像</label>
          <AvatarPicker value={ai.avatar} onChange={updateAvatar} kind="ai" />
        </div>

        {onOpenSpace && (
          <button type="button" className="btn btn-ghost ai-space-entry" onClick={onOpenSpace}>
            看看 TA 的生活 →
          </button>
        )}

        <div className="field">
          <label htmlFor="ai-nickname">TA 的名字</label>
          <div className="ai-save-row">
            <input
              id="ai-nickname"
              className="input"
              type="text"
              placeholder="给 TA 起个名字吧"
              value={nameValue}
              onChange={(e) => setNameDraft(e.target.value)}
              autoComplete="off"
              maxLength={30}
            />
            <button
              type="button"
              className="btn btn-primary ai-save-btn"
              onClick={() => void handleSaveName()}
              disabled={!nameValue.trim() || saving}
            >
              {savedField === 'name' ? '已保存' : saving ? '保存中…' : '改名'}
            </button>
          </div>
          <p className="hint">改名字会同步到聊天列表和 TA 的空间</p>
        </div>

        <div className="field">
          <label htmlFor="ai-remark">TA 备注</label>
          <div className="ai-save-row">
            <input
              id="ai-remark"
              className="input"
              type="text"
              placeholder="比如：TA 喜欢怎么被你称呼、你们之间的小约定"
              value={remarkValue}
              onChange={(e) => setRemarkDraft(e.target.value)}
              autoComplete="off"
              maxLength={60}
            />
            <button type="button" className="btn btn-primary ai-save-btn" onClick={handleSaveRemark} disabled={saving}>
              {savedField === 'remark' ? '已保存' : '保存'}
            </button>
          </div>
        </div>

        <div className="field">
          <label>性别</label>
          <GenderSelect value={gender} onChange={handleSaveGender} />
          {savedField === 'gender' && <p className="hint">已保存</p>}
        </div>

        <div className="field">
          <label htmlFor="ai-personality">性格特质</label>
          <textarea
            id="ai-personality"
            className="input persona-input"
            rows={4}
            placeholder="描述性格、说话习惯，例如：温柔理智、嘴硬心软"
            value={personalityValue}
            onChange={(e) => setPersonalityDraft(e.target.value)}
          />
          <div className="ai-save-row ai-save-row-end">
            <button
              type="button"
              className="btn btn-primary ai-save-btn"
              onClick={() => void handleSavePersonaField('personality')}
              disabled={saving}
            >
              {savedField === 'personality' ? '已保存' : '保存性格'}
            </button>
          </div>
        </div>

        <div className="field">
          <label htmlFor="ai-background">关系&背景设定</label>
          <textarea
            id="ai-background"
            className="input persona-input"
            rows={3}
            placeholder="你们是什么关系，TA的经历、相处细节"
            value={backgroundValue}
            onChange={(e) => setBackgroundDraft(e.target.value)}
          />
          <div className="ai-save-row ai-save-row-end">
            <button
              type="button"
              className="btn btn-primary ai-save-btn"
              onClick={() => void handleSavePersonaField('background')}
              disabled={saving}
            >
              {savedField === 'background' ? '已保存' : '保存背景'}
            </button>
          </div>
        </div>

        <div className="field">
          <label htmlFor="ai-opening">开场第一句</label>
          <input
            id="ai-opening"
            className="input"
            type="text"
            placeholder="TA初次和你见面说的第一句话"
            value={openingValue}
            onChange={(e) => setOpeningDraft(e.target.value)}
            autoComplete="off"
          />
          <div className="ai-save-row ai-save-row-end">
            <button
              type="button"
              className="btn btn-primary ai-save-btn"
              onClick={() => void handleSavePersonaField('opening')}
              disabled={saving}
            >
              {savedField === 'opening' ? '已保存' : '保存开场白'}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}

/* ---------------- 详情页：服务商配置 ---------------- */

function ProviderDetail({ onBack, onGoGuide }: { onBack: () => void; onGoGuide?: () => void }) {
  const [initial] = useState(loadSettings)
  const [provider, setProvider] = useState<Provider>(initial.provider)
  const [apiKey, setApiKey] = useState(initial.providers[initial.provider].apiKey)
  const [baseUrl, setBaseUrl] = useState(initial.providers[initial.provider].baseUrl)
  const [model, setModel] = useState(initial.providers[initial.provider].model)
  const [keyHint, setKeyHint] = useState<string | null>(() =>
    keyFormatHint(initial.provider, initial.providers[initial.provider].apiKey),
  )
  const [advancedOpen, setAdvancedOpen] = useState(initial.provider === 'custom' || initial.provider === 'openai')
  const [saved, setSaved] = useState(false)
  const [testState, setTestState] = useState<TestState>('idle')
  const [testMsg, setTestMsg] = useState('')

  const handleProviderChange = (p: Provider) => {
    setProvider(p)
    // 调出该服务商自己存过的配置；没存过就是空 key + 默认地址/模型
    const cfg = initial.providers[p]
    setApiKey(cfg.apiKey)
    setBaseUrl(cfg.baseUrl || DEFAULT_SETTINGS[p].baseUrl)
    setModel(cfg.model || DEFAULT_SETTINGS[p].model)
    // 自定义/OpenAI 必须填地址（OpenAI 官方地址国内直连不稳，需填中转站或挂代理），自动展开高级设置
    setAdvancedOpen(p === 'custom' || p === 'openai')
    setTestState('idle')
    setTestMsg('')
    setKeyHint(keyFormatHint(p, cfg.apiKey))
  }

  const currentSettings = (): ModelSettings => ({
    provider,
    apiKey,
    baseUrl: baseUrl.trim(),
    model: model.trim(),
  })

  const handleSave = () => {
    saveSettings(currentSettings())
    setSaved(true)
    setTimeout(() => setSaved(false), 2000)
  }

  const handleTest = async () => {
    const s = currentSettings()
    // 点「测试连接」也做一次 key 格式检测，帮用户发现选错服务商
    setKeyHint(keyFormatHint(s.provider, s.apiKey))
    if (!s.apiKey) {
      setTestState('error')
      setTestMsg('请先填入 ' + PROVIDER_NAMES[s.provider] + ' 的 API Key')
      return
    }
    if (!s.baseUrl) {
      setTestState('error')
      setTestMsg('请先填写服务商地址 base_url')
      return
    }
    if (!s.model) {
      setTestState('error')
      setTestMsg('请先填写模型名称')
      return
    }

    setTestState('testing')
    setTestMsg('正在测试…')
    try {
      await testConnection(s)
      setTestState('success')
      setTestMsg('连接成功，Key 可用')
    } catch (e) {
      setTestState('error')
      setTestMsg(e instanceof ChatError ? e.message : '连接失败，请检查设置')
    }
  }

  const resultClass =
    testState === 'success' ? 'test-result success' : testState === 'error' ? 'test-result error' : 'test-result'

  return (
    <div className="page settings-page">
      <DetailHeader title="服务商配置" onBack={onBack} />

      <div className="settings-card">
        <p className="hint">Key 只存你浏览器本地，不经过任何服务器。请放心填写。</p>
        {onGoGuide && (
          <button type="button" className="provider-guide-link" onClick={onGoGuide}>
            不会配？先看使用指南（30 秒看懂）
          </button>
        )}

        <div className="field">
          <ProviderSelect value={provider} onChange={handleProviderChange} />
        </div>

        <div className="field">
          <label htmlFor="api-key">API Key</label>
          <input
            id="api-key"
            className="input"
            type="password"
            placeholder={apiKey ? 'sk-…' : '请填写 ' + PROVIDER_NAMES[provider] + ' 的 API Key'}
            value={apiKey}
            onChange={(e) => {
              setApiKey(e.target.value)
              setKeyHint(keyFormatHint(provider, e.target.value))
            }}
            autoComplete="off"
          />
          {keyHint && <p className="key-format-hint">{keyHint}</p>}
        </div>

        <div className="field">
          <label htmlFor="model">模型名称</label>
          <input
            id="model"
            className="input"
            type="text"
            placeholder="glm-4.7-flash"
            value={model}
            onChange={(e) => setModel(e.target.value)}
            autoComplete="off"
          />
          <p className="hint">切换服务商时自动带出，一般不用改</p>
        </div>

        <button
          type="button"
          className="advanced-toggle"
          onClick={() => setAdvancedOpen(!advancedOpen)}
        >
          <span>高级设置</span>
          <svg
            className={`advanced-chevron${advancedOpen ? '' : ' collapsed'}`}
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.5"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden="true"
          >
            <path d="M18 15l-6-6-6 6" />
          </svg>
        </button>
        {advancedOpen && (
          <div className="field">
            <label htmlFor="base-url">服务商地址 base_url</label>
            <input
              id="base-url"
              className="input"
              type="text"
              placeholder="https://api.deepseek.com/v1"
              value={baseUrl}
              onChange={(e) => setBaseUrl(e.target.value)}
              autoComplete="off"
            />
            <p className="hint">OpenAI 兼容格式，一般以 /v1 结尾</p>
          </div>
        )}
      </div>

      <div className="settings-actions">
        <button className="btn btn-primary" onClick={handleSave}>
          {saved ? '已保存' : '保存设置'}
        </button>
        <button className="btn btn-ghost" onClick={handleTest} disabled={testState === 'testing'}>
          {testState === 'testing' ? '测试中…' : '测试连接'}
        </button>
      </div>

      {testMsg && <p className={resultClass}>{testMsg}</p>}
    </div>
  )
}

/* ---------------- 详情页：关于忆文 ---------------- */

function AboutDetail({ onBack, onGoWelcome }: { onBack: () => void; onGoWelcome?: () => void }) {
  const clicks = useRef<number[]>([])

  // 彩蛋：版本号连点 5 下回到欢迎页
  const handleVersionClick = () => {
    if (!onGoWelcome) return
    const now = Date.now()
    const recent = clicks.current.filter((t) => now - t < 2000)
    recent.push(now)
    clicks.current = recent
    if (recent.length >= 5) {
      clicks.current = []
      onGoWelcome()
    }
  }

  return (
    <div className="page settings-page">
      <DetailHeader title="关于" onBack={onBack} />

      <div className="about-card">
        <div className="about-logo" aria-hidden="true">
          <span>忆</span>
        </div>
        <h2 className="about-name">忆文</h2>
        <p className="about-en">Eluvin</p>
        <p className="about-slogan">忆过往，成文思</p>
        <p className="about-intro">一个住在你浏览器里的 TA，记得你说过的每一句话，也陪你把日子慢慢过成文。</p>
        <button type="button" className="about-version" onClick={handleVersionClick}>
          忆文 Eluvin v1.3.0 · 内测版
        </button>
      </div>
    </div>
  )
}
