import { useEffect, useRef, useState, type ReactNode } from 'react'
import ProviderSelect from './ProviderSelect'
import { defaultConfigName, isActiveConfig, loadSavedConfigs, removeConfig, saveConfig, type SavedConfig } from '../lib/savedConfigs'
import AvatarPicker from './AvatarPicker'
import DefaultAvatar from './DefaultAvatar'
import Account from './Account'
import GenderSelect from './GenderSelect'
import Work from './Work'
import Appearance from './Appearance'
import AnniversaryManager from './AnniversaryManager'
import {
  DEFAULT_SETTINGS,
  loadSettings,
  loadPersona,
  loadUserProfile,
  loadAIProfile,
  loadAIRemark,
  AIGENDER_LABELS,
  loadAIGenderState,
  saveSettings,
  savePersona,
  saveUserProfile,
  saveAIProfile,
  saveAIRemark,
  saveAIGender,
  PROVIDER_NAMES,
  COMMON_MODELS,
  loadModelHistory,
  saveModelHistory,
  type AIGender,
  type ModelSettings,
  type Provider,
  type UserProfile,
  type AIProfile,
} from '../lib/storage'
import { getToken, isLoggedIn, logout } from '../lib/auth'
import { ChatError, testConnection } from '../lib/api'
import { keyFormatHint } from '../lib/keyFormat'
import {
  extractOpeningLine,
  extractPersonality,
  extractBackgroundLine,
  applyPersonaEdits,
  canSavePersonaLength,
  countPersonaCharacters,
  hasPersonaIdentityConflict,
  PERSONA_HARD_LIMIT,
  PERSONA_SOFT_LIMIT,
} from '../lib/customPersona'
import { listSessions, patchSession, type Session } from '../lib/sessionApi'
import { getActiveSessionId, getSessionsCache, setSessionsCache } from '../lib/sessionStore'
import { forceRefresh } from '../lib/forceRefresh'
import {
  patchSessionInList,
  resolveRoleName,
  resolveRolePersona,
  roleInitial,
} from '../lib/sessionProfile'

type TestState = 'idle' | 'testing' | 'success' | 'error'

/** 设置页子页：使用指南已抽成 App 独立 view（guide），不再嵌在这里 */
export type SettingsPage = 'main' | 'ai' | 'provider' | 'about' | 'account' | 'work' | 'appearance' | 'anniversary' | 'profile' | 'privacy'

interface Props {
  onGoWelcome?: () => void
  /** 「使用指南」入口：由 App 切到独立 guide view（游客也可看） */
  onGoGuide?: () => void
  /** 工作台「跟 TA 说」→ 切到聊天页（工作台展示模式用） */
  onGoWorkChat?: () => void
  /** 三 tab 改版：角色管理（会话列表）入口，降级放「我的」 */
  onGoRoles?: () => void
  /** 记忆组：关于我（我的重要日子 + 我说的） */
  onGoAboutMe?: () => void
  /** TA 组：TA 的资料 */
  onGoProfile?: () => void
  /** 进入设置页时打开的子页 */
  initialPage?: SettingsPage
  /** App 级来源（例如 TA 首页）进入纪念日时，由来源负责返回。 */
  onAnniversaryBack?: () => void
}

export default function Settings({ onGoWelcome, onGoGuide, onGoWorkChat, onGoRoles, onGoAboutMe, onGoProfile, initialPage, onAnniversaryBack }: Props) {
  const [page, setPage] = useState<SettingsPage>(initialPage ?? 'main')

  if (page === 'profile') {
    return <UserProfileDetail onBack={() => setPage('main')} />
  }
  if (page === 'privacy') {
    return <PrivacyDetail onBack={() => setPage('main')} />
  }
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
        <DetailHeader title="AI 工作台" onBack={() => setPage('main')} />
        <Work onGoChat={onGoWorkChat} />
      </div>
    )
  }
  if (page === 'appearance') {
    return <Appearance onBack={() => setPage('main')} />
  }
  if (page === 'anniversary') {
    return <AnniversaryManager onBack={onAnniversaryBack ?? (() => setPage('main'))} />
  }
  return (
    <MainCenter
      onOpenMyProfile={() => setPage('profile')}
      onOpenAccount={() => setPage('account')}
      onOpenProvider={() => setPage('provider')}
      onOpenGuide={() => onGoGuide?.()}
      onOpenAbout={() => setPage('about')}
      onOpenPrivacy={() => setPage('privacy')}
      onOpenAppearance={() => setPage('appearance')}
      onOpenAnniversary={() => setPage('anniversary')}
      onGoRoles={() => onGoRoles?.()}
      onGoAboutMe={() => onGoAboutMe?.()}
      onGoProfile={() => onGoProfile?.()}
      onGoWelcome={onGoWelcome}
    />
  )
}

/* ---------------- 详情页通用：左上角返回 ---------------- */

function DetailHeader({ title, onBack }: { title: string; onBack: () => void }) {
  return (
    <div className="detail-header">
      <button type="button" className="detail-back detail-back-text" onClick={onBack} aria-label="返回">
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
        返回
      </button>
      <h2 className="detail-title">{title}</h2>
      <span className="detail-spacer" aria-hidden="true" />
    </div>
  )
}


/* ---------------- 我的资料：沿用现有资料能力，主页面只展示，编辑集中到这里 ---------------- */

function UserProfileDetail({ onBack }: { onBack: () => void }) {
  const [user, setUser] = useState<UserProfile>(() => loadUserProfile())
  const [picking, setPicking] = useState(false)

  const updateUser = (patch: Partial<UserProfile>) => {
    const next = { ...user, ...patch }
    setUser(next)
    saveUserProfile(next)
  }

  return (
    <div className="page settings-page">
      <DetailHeader title="我的资料" onBack={onBack} />
      <div className="profile-edit-card">
        <div className="profile-avatar-wrap">
          <button
            type="button"
            className="profile-avatar"
            onClick={() => setPicking((value) => !value)}
            aria-label={picking ? '收起头像选择' : '更换头像'}
          >
            {user.avatar.startsWith('data:') ? (
              <img src={user.avatar} alt="我的头像" />
            ) : (
              <DefaultAvatar kind="user" className="avatar-default" />
            )}
            <span className="profile-avatar-badge" aria-hidden="true">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                <path d="M4 8h3l2-2.5h6L17 8h3a1 1 0 0 1 1 1v9a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V9a1 1 0 0 1 1-1z" />
                <circle cx="12" cy="13.5" r="3.2" />
              </svg>
            </span>
          </button>
        </div>

        {picking && (
          <div className="profile-avatar-pick">
            <AvatarPicker value={user.avatar} onChange={(avatar) => updateUser({ avatar })} />
          </div>
        )}

        <div className="field">
          <label htmlFor="mine-profile-name">名字</label>
          <input
            id="mine-profile-name"
            className="input"
            type="text"
            placeholder="你希望 TA 怎么叫你？"
            value={user.nickname}
            onChange={(event) => updateUser({ nickname: event.target.value })}
            autoComplete="off"
          />
        </div>

        <div className="field">
          <label htmlFor="mine-profile-bio">一句话介绍</label>
          <input
            id="mine-profile-bio"
            className="input"
            type="text"
            placeholder="让 TA 更懂你"
            value={user.bio}
            onChange={(event) => updateUser({ bio: event.target.value })}
            autoComplete="off"
          />
        </div>

        <div className="field">
          <label htmlFor="mine-profile-region">地区</label>
          <input
            id="mine-profile-region"
            className="input"
            type="text"
            placeholder="例如：上海 · 浦东新区"
            value={user.region ?? ''}
            onChange={(event) => updateUser({ region: event.target.value })}
            autoComplete="address-level2"
          />
          <p className="hint profile-region-hint">按你填写的城市或区使用，不会自动读取定位；后续首页天气会从这里取地区。</p>
        </div>
      </div>
    </div>
  )
}

/* ---------------- 隐私：文案为本批草案，合并前需七七拍板 ---------------- */

function PrivacyDetail({ onBack }: { onBack: () => void }) {
  return (
    <div className="page settings-page">
      <DetailHeader title="隐私" onBack={onBack} />
      <div className="privacy-card">
        <p className="privacy-lead">
          你在忆文里告诉 TA 的话（聊天内容、记忆条目、TA 空间动态等）会和你的账号关联存储，用于让 TA 记住你、提供持续陪伴。你可以在「我的 → 账号与同步」管理账号，在 TA 的记忆与聊天记录中查看、管理或删除相关内容。忆文不会把你的对话内容用于训练外部模型，也不会向第三方出售你的个人信息。
        </p>

        <section className="privacy-section">
          <h3>你的内容，只用于你正在使用的功能</h3>
          <p>忆文不会为了广告推荐或与陪伴无关的用途，擅自查看或使用你的聊天、记忆和空间内容。正常使用中，这些内容只用于对话、记忆、关系连续性，以及你主动开启的同步功能。</p>
        </section>

        <section className="privacy-section">
          <h3>模型请求</h3>
          <p>聊天时，为了生成回复，必要的上下文会发送到你当前配置的模型服务商。你的 API Key 只保存在当前浏览器，不会上传到忆文服务器。不同模型服务商如何处理请求内容，以对应服务商自己的隐私规则为准。</p>
        </section>

        <section className="privacy-section">
          <h3>账号与同步</h3>
          <p>使用账号同步后，聊天、记忆、角色资料和空间内容会与账号关联保存，用于换设备后恢复。退出登录不会自动删除当前设备上的本地记录。</p>
        </section>

        <section className="privacy-section">
          <h3>你可以随时管理</h3>
          <p>你可以在忆文相应页面查看、修改或删除自己保存的内容。如果未来隐私范围发生实质变化，忆文应在变化生效前重新明确告知你。</p>
        </section>
      </div>
    </div>
  )
}

/* ---------------- 主页面：顶部资料卡 + 分组入口 ---------------- */

function MainCenter({
  onOpenMyProfile,
  onOpenAccount,
  onOpenProvider,
  onOpenGuide,
  onOpenAbout,
  onOpenPrivacy,
  onOpenAppearance,
  onOpenAnniversary,
  onGoRoles,
  onGoAboutMe,
  onGoProfile,
  onGoWelcome,
}: {
  onOpenMyProfile: () => void
  onOpenAccount: () => void
  onOpenProvider: () => void
  onOpenGuide: () => void
  onOpenAbout: () => void
  onOpenPrivacy: () => void
  onOpenAppearance: () => void
  onOpenAnniversary: () => void
  onGoRoles?: () => void
  onGoAboutMe?: () => void
  onGoProfile?: () => void
  onGoWelcome?: () => void
}) {
  const user = loadUserProfile()
  const loggedIn = isLoggedIn()
  const modelSettings = loadSettings()
  const providerStatus = `${PROVIDER_NAMES[modelSettings.provider]} · ${modelSettings.model || '未设置'}`

  const handleLogout = () => {
    if (!window.confirm('退出登录后，本地记录不会丢；下次登录同一账号就能找回来。确定退出吗？')) return
    logout()
    onGoWelcome?.()
  }

  return (
    <div className="page settings-page mine-page">
      <button type="button" className="profile-card profile-card-link" onClick={onOpenMyProfile}>
        <span className="profile-avatar-wrap">
          <span className="profile-avatar profile-avatar-display">
            {user.avatar.startsWith('data:') ? (
              <img src={user.avatar} alt="我的头像" />
            ) : (
              <DefaultAvatar kind="user" className="avatar-default" />
            )}
            <span className="profile-avatar-badge" aria-hidden="true">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                <path d="M4 8h3l2-2.5h6L17 8h3a1 1 0 0 1 1 1v9a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V9a1 1 0 0 1 1-1z" />
                <circle cx="12" cy="13.5" r="3.2" />
              </svg>
            </span>
          </span>
        </span>
        <span className="profile-card-name">{user.nickname.trim() || '设置你的名字'}</span>
        {user.bio.trim() && <span className="profile-card-bio">{user.bio}</span>}
        <span className="profile-card-region">{user.region?.trim() || '地区未填写'}</span>
        <svg className="profile-card-chevron" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <path d="M9 6l6 6-6 6" />
        </svg>
      </button>

      <ProfileGroup title="开始使用">
        <EntryRow icon={<BookIcon />} label="使用指南" onClick={onOpenGuide} />
        <EntryRow icon={<KeyIcon />} label="API 设置" status={providerStatus} onClick={onOpenProvider} />
      </ProfileGroup>

      <ProfileGroup title="关于 TA">
        {onGoProfile && <EntryRow icon={<ProfileIcon />} label="TA 的资料" onClick={onGoProfile} />}
        {onGoRoles && <EntryRow icon={<RolesIcon />} label="角色管理" status="进阶" onClick={onGoRoles} />}
      </ProfileGroup>

      <ProfileGroup title="关于我">
        {onGoAboutMe && <EntryRow icon={<AboutMeIcon />} label="重要记录 & 记忆" onClick={onGoAboutMe} />}
      </ProfileGroup>

      <ProfileGroup title="关于我们">
        <EntryRow icon={<AnniversaryIcon />} label="纪念日管理" onClick={onOpenAnniversary} />
      </ProfileGroup>

      <ProfileGroup title="即将开放">
        <EntryRow icon={<WorkIcon />} label="AI 工作台" status="即将开放" disabled />
      </ProfileGroup>

      <ProfileGroup title="账号与隐私">
        <EntryRow
          icon={<CloudSyncIcon />}
          label="账号与同步"
          onClick={onOpenAccount}
          status={loggedIn ? '已登录' : '未登录'}
        />
        <EntryRow icon={<PrivacyIcon />} label="隐私" onClick={onOpenPrivacy} />
        <EntryRow icon={<PaletteIcon />} label="外观" onClick={onOpenAppearance} />
        <EntryRow icon={<InfoIcon />} label="关于忆文" onClick={onOpenAbout} />
        <UpdateControls />
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
  disabled = false,
}: {
  icon: ReactNode
  label: string
  onClick?: () => void
  status?: string
  disabled?: boolean
}) {
  return (
    <button type="button" className={`entry-row${disabled ? ' entry-row-disabled' : ''}`} onClick={onClick} disabled={disabled}>
      <span className="entry-icon">{icon}</span>
      <span className="entry-label">{label}</span>
      {status && <span className="entry-status">{status}</span>}
      {!disabled && (
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
      )}
    </button>
  )
}

function UpdateControls() {
  const [expanded, setExpanded] = useState(false)

  const checkUpdate = () => {
    setExpanded(true)
    location.reload()
  }

  const doForceRefresh = () => {
    if (!window.confirm('强制刷新会清除页面缓存并重新加载，继续吗？')) return
    void forceRefresh()
  }

  return (
    <div className="update-controls-inline">
      <button type="button" className="entry-row" onClick={() => setExpanded((value) => !value)}>
        <span className="entry-icon"><UpdateIcon /></span>
        <span className="entry-label">检查更新</span>
        <span className="entry-status">当前版本</span>
        <svg className="entry-chevron" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <path d="M9 6l6 6-6 6" />
        </svg>
      </button>
      {expanded && (
        <div className="update-controls-secondary">
          <button type="button" className="btn btn-ghost" onClick={checkUpdate}>重新加载检查</button>
          <button type="button" className="btn btn-ghost" onClick={doForceRefresh}>强制刷新</button>
        </div>
      )}
    </div>
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

const UpdateIcon = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M20 11a8 8 0 1 0-2.3 5.7" />
    <path d="M20 5v6h-6" />
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

const PrivacyIcon = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M12 3l7 3v5c0 4.6-2.8 8.2-7 10-4.2-1.8-7-5.4-7-10V6l7-3z" />
    <path d="M9.5 12l1.7 1.7 3.6-4" />
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

const RolesIcon = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <circle cx="9" cy="8" r="3.5" />
    <path d="M3.5 20a5.5 5.5 0 0 1 11 0" />
    <path d="M16 4.6a3.5 3.5 0 0 1 0 6.8" />
    <path d="M17.5 14.2a5.5 5.5 0 0 1 3 5.8" />
  </svg>
)

const AnniversaryIcon = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <rect x="3" y="5" width="18" height="16" rx="2" />
    <path d="M7 3v4M17 3v4M3 10h18" />
    <path d="M8 14h3M13 14h3M8 17h3" />
  </svg>
)

/* TA 的样子（资料卡）：人像 + 卡片 */
const ProfileIcon = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <rect x="3.5" y="4" width="17" height="16" rx="2.5" />
    <circle cx="12" cy="9.5" r="2.8" />
    <path d="M7 17.5a5 5 0 0 1 10 0" />
    <path d="M7 7.5h.01" />
    <path d="M7 11h.01" />
  </svg>
)

/* 关于我：单人像 */
const AboutMeIcon = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <circle cx="12" cy="8" r="3.8" />
    <path d="M5 20a7 7 0 0 1 14 0" />
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
export function AIDetail({ onBack, onOpenSpace, sessionId }: { onBack: () => void; onOpenSpace?: () => void; sessionId?: string }) {
  const [sessions, setSessions] = useState<Session[]>(() => getSessionsCache())
  // 正在看的角色：角色管理「角色详情」会把该角色的 sessionId 传进来；不传 = 当前会话。
  // 2026-09-14 修串号：以前一律读当前会话，导致「看 A 的资料卡、改的却是 B」。
  const viewSessionId = sessionId ?? getActiveSessionId()
  // TA 资料按会话隔离：有会话 → 读该会话自己的头像/姓名；无会话回落全局（游客/过渡态）
  const [ai, setAI] = useState<AIProfile>(() => loadAIProfile(viewSessionId || undefined))
  const [globalPersona, setGlobalPersona] = useState(() => loadPersona())
  const [remark, setRemark] = useState(() => loadAIRemark(viewSessionId || undefined))
  // 性别：选一次锁定（2026-09-14 七七拍板）；locked = 已选定不再给改
  const [genderState, setGenderState] = useState(() => loadAIGenderState(viewSessionId || undefined))
  const gender = genderState.gender
  // 各字段草稿：null = 还没动过，显示当前值（会话刷新后自动跟着变）；改过才进草稿
  const [nameDraft, setNameDraft] = useState<string | null>(null)
  const [personalityDraft, setPersonalityDraft] = useState<string | null>(null)
  const [backgroundDraft, setBackgroundDraft] = useState<string | null>(null)
  const [openingDraft, setOpeningDraft] = useState<string | null>(null)
  const [remarkDraft, setRemarkDraft] = useState<string | null>(null)
  const [savedField, setSavedField] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [identityConflictField, setIdentityConflictField] = useState<'personality' | 'background' | 'opening' | null>(null)
  const [identityConflictAcknowledged, setIdentityConflictAcknowledged] = useState(false)
  const savedTimer = useRef<number | undefined>(undefined)
  // 本页已保存过改动：拉列表回来的旧数据别覆盖本地刚存的新值（防竞态）
  const dirtyRef = useRef(false)

  const activeSessionId = viewSessionId
  // 有会话 id（哪怕缓存还没拉到）= 有角色；无会话/游客 → 引导 + 全局兜底
  const hasSession = Boolean(activeSessionId)
  const roleName = resolveRoleName(activeSessionId, sessions, ai.nickname)
  const rolePersona = resolveRolePersona(activeSessionId, sessions, globalPersona)
  const nameValue = nameDraft ?? roleName
  const personalityValue = personalityDraft ?? extractPersonality(rolePersona)
  const backgroundValue = backgroundDraft ?? extractBackgroundLine(rolePersona)
  const openingValue = openingDraft ?? extractOpeningLine(rolePersona)
  const remarkValue = remarkDraft ?? remark
  const nextPersona = applyPersonaEdits(rolePersona, {
    personality: personalityValue,
    background: backgroundValue,
    opening: openingValue,
  })
  const nextPersonaLength = countPersonaCharacters(nextPersona)
  const personaLengthValid = canSavePersonaLength(nextPersona, rolePersona)

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
    saveAIRemark(v, activeSessionId || undefined)
    dirtyRef.current = true
    setRemarkDraft(v)
    flashSaved('remark')
  }

  // 改性别：只写这个角色自己的 key，选定即锁定（2026-09-14 七七拍板）。
  // 以前这里额外写了一份全局，导致一个角色改完、所有没自己记录的角色跟着变——去掉。
  // 'unknown'（还没选）不锁，仍可再选。
  const handleSaveGender = (g: AIGender) => {
    saveAIGender(g, activeSessionId || undefined)
    setGenderState({ gender: g, locked: g !== 'unknown', own: true })
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
  const savePersonaField = async (field: 'personality' | 'background' | 'opening') => {
    if (saving) return
    if (hasSession && !getToken()) return
    if (!personaLengthValid) return
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

  const handleSavePersonaField = (field: 'personality' | 'background' | 'opening') => {
    if (!personaLengthValid) return
    if (!identityConflictAcknowledged && hasPersonaIdentityConflict(nextPersona, roleName)) {
      setIdentityConflictField(field)
      return
    }
    void savePersonaField(field)
  }

  return (
    <div className="page settings-page">
      <DetailHeader title="TA 的样子" onBack={onBack} />

      {!hasSession && (
        <div className="settings-card">
          <p className="hint">登录并开始聊天后，这里就是 TA 的样子。</p>
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
          <span className="ai-role-sub">这是 TA 的样子，改动会存回本地并同步当前角色</span>
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
          {genderState.locked ? (
            <p className="gender-locked">
              <span className="gender-locked-value">{AIGENDER_LABELS[gender]}</span>
              <span className="gender-locked-note">已选定，不再修改</span>
            </p>
          ) : (
            <>
              <GenderSelect value={gender} onChange={handleSaveGender} />
              <p className="hint">选一次就定下来，之后不能再改</p>
            </>
          )}
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
              onClick={() => handleSavePersonaField('personality')}
              disabled={saving || !personaLengthValid}
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
              onClick={() => handleSavePersonaField('background')}
              disabled={saving || !personaLengthValid}
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
              onClick={() => handleSavePersonaField('opening')}
              disabled={saving || !personaLengthValid}
            >
              {savedField === 'opening' ? '已保存' : '保存开场白'}
            </button>
          </div>
        </div>
        <div className="field">
          <p className="hint">{nextPersonaLength} / {PERSONA_HARD_LIMIT}</p>
          {nextPersonaLength > PERSONA_SOFT_LIMIT && (
            <p className="hint">人设越长、信息越杂，TA 越容易抓不住重点、混淆身份和关系。</p>
          )}
          {!personaLengthValid && (
            <>
              <p className="test-result error">
                已超出 {Math.max(0, nextPersonaLength - PERSONA_HARD_LIMIT)} 字。存量超长人设可以继续精简，但不能比当前已保存内容更长。
              </p>
              <p className="hint">
                可以合并重复的性格描述，把剧情年表改成摘要，并把“TA 是什么人”和“你们经历过什么”分开写。
              </p>
            </>
          )}
        </div>
      </div>
      {identityConflictField && (
        <div className="role-modal-overlay" role="dialog" aria-modal="true" aria-label="检查人设身份">
          <div className="role-modal">
            <div className="role-modal-body">
              <p>这张人设里好像出现了两个不同的身份。TA 可能会分不清谁是谁。你可以继续使用，也可以先检查一下人设。</p>
            </div>
            <div className="role-modal-footer">
              <div className="role-modal-actions">
                <button type="button" className="btn btn-ghost" onClick={() => setIdentityConflictField(null)}>
                  回去看看
                </button>
                <button
                  type="button"
                  className="btn btn-primary"
                  onClick={() => {
                    const field = identityConflictField
                    setIdentityConflictAcknowledged(true)
                    setIdentityConflictField(null)
                    void savePersonaField(field)
                  }}
                >
                  知道了
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
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
  // 第三批⑫：模型名点选下拉
  const [modelDropdownOpen, setModelDropdownOpen] = useState(false)
  const [modelHistory, setModelHistory] = useState<string[]>(() => loadModelHistory())
  const modelDropdownRef = useRef<HTMLDivElement>(null)
  const [keyHint, setKeyHint] = useState<string | null>(() =>
    keyFormatHint(initial.provider, initial.providers[initial.provider].apiKey),
  )
  const [advancedOpen, setAdvancedOpen] = useState(initial.provider === 'custom' || initial.provider === 'openai')
  const [saved, setSaved] = useState(false)
  const [testState, setTestState] = useState<TestState>('idle')
  const [testMsg, setTestMsg] = useState('')
  // 已保存的服务商配置卡片（存一次，下次点一下直接切换）
  const [savedConfigs, setSavedConfigs] = useState<SavedConfig[]>(() => loadSavedConfigs())
  const [saveNameOpen, setSaveNameOpen] = useState(false)
  const [saveName, setSaveName] = useState('')

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

  // 第三批⑫：点击模型下拉外部关闭下拉
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (modelDropdownRef.current && !modelDropdownRef.current.contains(e.target as Node)) {
        setModelDropdownOpen(false)
      }
    }
    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [])

  const currentSettings = (): ModelSettings => ({
    provider,
    apiKey,
    baseUrl: baseUrl.trim(),
    model: model.trim(),
  })

  const handleSave = () => {
    saveSettings(currentSettings())
    // 第三批⑫：保存模型名到历史，下次点选直接可选
    saveModelHistory(model)
    setModelHistory(loadModelHistory())
    // 第一批①：切模型串流 bug——保存模型设置=显式切换点，通知 Chat abort 旧请求
    window.dispatchEvent(new CustomEvent('model-settings-changed'))
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

  /** 点已保存的卡片：把这套配置填上并直接生效 */
  const handleUseSaved = (c: SavedConfig) => {
    setProvider(c.provider)
    setApiKey(c.apiKey)
    setBaseUrl(c.baseUrl)
    setModel(c.model)
    setAdvancedOpen(c.provider === 'custom' || c.provider === 'openai')
    setKeyHint(keyFormatHint(c.provider, c.apiKey))
    setTestState('idle')
    setTestMsg('')
    saveSettings({ provider: c.provider, apiKey: c.apiKey, baseUrl: c.baseUrl, model: c.model })
    saveModelHistory(c.model)
    setModelHistory(loadModelHistory())
    // 切模型/配置=显式切换点，通知 Chat abort 旧请求（第一批①）
    window.dispatchEvent(new CustomEvent('model-settings-changed'))
    setSaved(true)
    setTimeout(() => setSaved(false), 2000)
  }

  /** 把当前填的这套存成一张卡片 */
  const handleSaveAsConfig = () => {
    if (!apiKey.trim() || !baseUrl.trim() || !model.trim()) {
      setTestState('error')
      setTestMsg('先把 Key、地址、模型都填上，再存下来')
      return
    }
    setSavedConfigs(saveConfig({ name: saveName, provider, apiKey, baseUrl, model }))
    setSaveNameOpen(false)
    setTestState('success')
    setTestMsg('已存到下面「我存过的」，下次点一下就切过来')
  }

  const resultClass =
    testState === 'success' ? 'test-result success' : testState === 'error' ? 'test-result error' : 'test-result'

  return (
    <div className="page settings-page">
      <DetailHeader title="API 设置" onBack={onBack} />

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
          <div className="model-select-wrapper" ref={modelDropdownRef} style={{ position: 'relative' }}>
            <div style={{ display: 'flex', gap: '8px' }}>
              <input
                id="model"
                className="input"
                type="text"
                placeholder="glm-4.7-flash"
                value={model}
                onChange={(e) => setModel(e.target.value)}
                onFocus={() => setModelDropdownOpen(true)}
                autoComplete="off"
                style={{ flex: 1 }}
              />
              <button
                type="button"
                className="btn-ghost"
                onClick={() => setModelDropdownOpen(!modelDropdownOpen)}
                style={{ padding: '0 12px', whiteSpace: 'nowrap' }}
              >
                选择
              </button>
            </div>
            {modelDropdownOpen && (
              <div
                style={{
                  position: 'absolute',
                  top: '100%',
                  left: 0,
                  right: 0,
                  marginTop: '4px',
                  background: 'var(--color-card, #fff)',
                  border: '1px solid var(--color-border, #eee)',
                  borderRadius: '8px',
                  maxHeight: '240px',
                  overflowY: 'auto',
                  zIndex: 100,
                  boxShadow: '0 4px 12px rgba(0,0,0,0.1)',
                }}
              >
                {modelHistory.length > 0 && (
                  <div style={{ padding: '8px 12px', fontSize: '12px', color: '#999', borderBottom: '1px solid #f0f0f0' }}>
                    最近用过
                  </div>
                )}
                {modelHistory.map((m) => (
                  <div
                    key={`hist-${m}`}
                    onClick={() => { setModel(m); setModelDropdownOpen(false) }}
                    style={{ padding: '8px 12px', cursor: 'pointer', fontSize: '14px' }}
                    onMouseEnter={(e) => (e.currentTarget.style.background = '#f5f5f5')}
                    onMouseLeave={(e) => (e.currentTarget.style.background = 'transparent')}
                  >
                    {m}
                  </div>
                ))}
                <div style={{ padding: '8px 12px', fontSize: '12px', color: '#999', borderBottom: '1px solid #f0f0f0', borderTop: modelHistory.length > 0 ? '1px solid #f0f0f0' : 'none' }}>
                  常见模型
                </div>
                {COMMON_MODELS[provider]?.map((m) => (
                  <div
                    key={`common-${m}`}
                    onClick={() => { setModel(m); setModelDropdownOpen(false) }}
                    style={{ padding: '8px 12px', cursor: 'pointer', fontSize: '14px' }}
                    onMouseEnter={(e) => (e.currentTarget.style.background = '#f5f5f5')}
                    onMouseLeave={(e) => (e.currentTarget.style.background = 'transparent')}
                  >
                    {m}
                  </div>
                ))}
              </div>
            )}
          </div>
          <p className="hint">切换服务商时自动带出，也可以点「选择」从常见模型里选</p>
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

      {saveNameOpen && (
        <div className="saved-config-namer">
          <input
            className="input"
            type="text"
            placeholder="给这套配置起个名字（比如 慧慧云）"
            value={saveName}
            onChange={(e) => setSaveName(e.target.value)}
            autoComplete="off"
            aria-label="配置名字"
          />
          <div className="saved-config-namer-actions">
            <button className="btn btn-primary" onClick={handleSaveAsConfig}>
              存下来
            </button>
            <button className="btn btn-ghost" onClick={() => setSaveNameOpen(false)}>
              取消
            </button>
          </div>
        </div>
      )}

      <div className="settings-actions">
        <button className="btn btn-primary" onClick={handleSave}>
          {saved ? '已保存' : '保存设置'}
        </button>
        <button
          className="btn btn-ghost"
          onClick={() => {
            setSaveName(defaultConfigName({ provider, baseUrl }))
            setSaveNameOpen(true)
          }}
        >
          存为配置
        </button>
        <button className="btn btn-ghost" onClick={handleTest} disabled={testState === 'testing'}>
          {testState === 'testing' ? '测试中…' : '测试连接'}
        </button>
      </div>

      {testMsg && <p className={resultClass}>{testMsg}</p>}

        {savedConfigs.length > 0 && (
          <div className="field saved-configs-bottom">
            <label>我存过的</label>
            <div className="saved-config-list">
              {savedConfigs.map((c) => {
                const active = isActiveConfig({ provider, baseUrl, model }, c)
                return (
                  <div
                    key={c.id}
                    className={`saved-config-card${active ? ' active' : ''}`}
                    role="button"
                    tabIndex={0}
                    onClick={() => handleUseSaved(c)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' || e.key === ' ') {
                        e.preventDefault()
                        handleUseSaved(c)
                      }
                    }}
                  >
                    <div className="saved-config-head">
                      <span className="saved-config-name">{c.name}</span>
                      {active && <span className="saved-config-badge">使用中</span>}
                      <button
                        type="button"
                        className="saved-config-del"
                        aria-label="删除这个配置"
                        onClick={(e) => {
                          e.stopPropagation()
                          setSavedConfigs(removeConfig(c.id))
                        }}
                      >
                        ×
                      </button>
                    </div>
                    <div className="saved-config-meta">{c.baseUrl.replace(/^https?:\/\//, '')}</div>
                    <div className="saved-config-meta">{c.model}</div>
                  </div>
                )
              })}
            </div>
            <p className="hint">点一下卡片直接切过来，不用重新填</p>
          </div>
        )}
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
      <DetailHeader title="关于忆文" onBack={onBack} />

      <div className="about-card">
        <div className="about-logo" aria-hidden="true">
          <span>忆</span>
        </div>
        <h2 className="about-name">忆文</h2>
        <p className="about-en">Eluvin</p>
        <p className="about-slogan">忆过往，成文思</p>
        <p className="about-intro">一个住在你浏览器里的 TA，记得你说过的每一句话，也陪你把日子慢慢过成文。</p>
        <p className="about-contact">
          合作与反馈：
          <a href="mailto:yw_eluvin@163.com">yw_eluvin@163.com</a>
        </p>
        <button type="button" className="about-version" onClick={handleVersionClick}>
          忆文 Eluvin v1.2.3 · 内测版
        </button>
      </div>
    </div>
  )
}
