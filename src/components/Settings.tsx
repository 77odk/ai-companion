import { useEffect, useRef, useState, type ReactNode } from 'react'
import ProviderSelect from './ProviderSelect'
import { defaultConfigName, isActiveConfig, loadSavedConfigs, removeConfig, saveConfig, type SavedConfig } from '../lib/savedConfigs'
import AvatarPicker from './AvatarPicker'
import DefaultAvatar from './DefaultAvatar'
import Account from './Account'
import GenderSelect from './GenderSelect'
import Work from './Work'
import Appearance from './Appearance'
import KeyGuideSheet from './KeyGuideSheet'
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
  isActionNarrationEnabled,
  saveActionNarrationEnabled,
  getAllLocalContextUsageTurns,
  getInitiativePreference,
  saveInitiativePreference,
  isSystemNotificationEnabled,
  saveSystemNotificationEnabled,
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
import { checkDeployedBuild, getCurrentBuildVersion } from '../lib/appVersion'
import { getGlobalReplyLength, replyLengthLabel, saveGlobalReplyLength, type ReplyLength } from '../lib/replyLength'
import {
  patchSessionInList,
  resolveRoleName,
  resolveRolePersona,
  roleInitial,
} from '../lib/sessionProfile'
import { estimateUsageTurnCost, formatUsageMoney, formatUsageTokens, summarizeUsageTurns } from '../lib/usageCost'
import { requestSystemNotificationPermission, systemNotificationPermission } from '../lib/systemNotification'
import {
  RELATIONSHIP_PRESETS,
  loadRelationshipSetting,
  saveRelationshipSetting,
  type RelationshipPreset,
} from '../lib/relationshipState'

type TestState = 'idle' | 'testing' | 'success' | 'error'

/** 设置页子页：使用指南已抽成 App 独立 view（guide），不再嵌在这里 */
export type SettingsPage = 'main' | 'ai' | 'provider' | 'usage' | 'about' | 'account' | 'work' | 'appearance' | 'anniversary' | 'profile' | 'privacy' | 'reply' | 'initiative'

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
  /** 我们组：一起经历过（TA 的空间 · 大小事） */
  onGoSpace?: () => void
  /** TA 组：TA 的样子（资料卡；第 4 批换成合并页） */
  onGoProfile?: () => void
  /** 进入设置页时打开的子页 */
  initialPage?: SettingsPage
  /** 从其他页面直接进入某个设置子页时，返回应回到真实来源，而不是固定落到「我的」。 */
  onInitialPageBack?: () => void
  /** 兼容旧调用：App 级来源进入纪念日时可显式指定返回。 */
  onAnniversaryBack?: () => void
  /** 全屏设置二级页（隐私 / 聊天设置）：通知 App 隐藏底部导航。 */
  onPrivacyOpenChange?: (open: boolean) => void
  /** 「反馈与建议」入口：由 App 切到独立 feedback view（与通知页同一套全屏页） */
  onGoFeedback?: () => void
}

export default function Settings({ onGoWelcome, onGoGuide, onGoWorkChat, onGoRoles, onGoAboutMe, onGoProfile, initialPage, onInitialPageBack, onAnniversaryBack, onPrivacyOpenChange, onGoFeedback }: Props) {
  const [page, setPage] = useState<SettingsPage>(initialPage ?? 'main')
  const mainScrollTopRef = useRef(0)
  const restoreMainScrollRef = useRef(false)

  const openSubpage = (next: SettingsPage) => {
    const mainPage = document.querySelector<HTMLElement>('.app-main > .settings-page')
    mainScrollTopRef.current = mainPage?.scrollTop ?? 0
    setPage(next)
  }

  const backFrom = (current: SettingsPage) => {
    if (current === 'anniversary' && onAnniversaryBack) {
      onAnniversaryBack()
      return
    }
    if (initialPage && initialPage !== 'main' && initialPage === current && onInitialPageBack) {
      onInitialPageBack()
      return
    }
    restoreMainScrollRef.current = true
    setPage('main')
  }

  useEffect(() => {
    if (page !== 'main' || !restoreMainScrollRef.current) return
    restoreMainScrollRef.current = false
    const top = mainScrollTopRef.current
    const frame = window.requestAnimationFrame(() => {
      const mainPage = document.querySelector<HTMLElement>('.app-main > .settings-page')
      if (mainPage) mainPage.scrollTop = top
    })
    return () => window.cancelAnimationFrame(frame)
  }, [page])

  useEffect(() => {
    // 设置里的任意子页都要藏掉底部导航（原来只藏 privacy / reply，API 设置、纪念日、账号、外观、关于忆文都漏了）
    onPrivacyOpenChange?.(page !== 'main')
  }, [page, onPrivacyOpenChange])

  useEffect(() => () => onPrivacyOpenChange?.(false), [onPrivacyOpenChange])

  if (page === 'provider') {
    return <ProviderDetail onBack={() => backFrom('provider')} onGoGuide={onGoGuide} />
  }
  if (page === 'profile') {
    return <MyProfileDetail onBack={() => backFrom('profile')} />
  }
  if (page === 'usage') {
    return <UsageInfoDetail onBack={() => backFrom('usage')} />
  }
  if (page === 'privacy') {
    return <PrivacyDetail onBack={() => backFrom('privacy')} />
  }
  if (page === 'reply') {
    return <ReplyLengthDetail onBack={() => backFrom('reply')} />
  }
  if (page === 'initiative') {
    return <InitiativeDetail onBack={() => backFrom('initiative')} />
  }
  if (page === 'about') {
    return <AboutDetail onBack={() => backFrom('about')} />
  }
  if (page === 'account') {
    return <Account onBack={() => backFrom('account')} />
  }
  if (page === 'work') {
    return (
      <div className="page settings-page work-subpage">
        <DetailHeader title="工作台" onBack={() => backFrom('work')} />
        <Work onGoChat={onGoWorkChat} />
      </div>
    )
  }
  if (page === 'appearance') {
    return <Appearance onBack={() => backFrom('appearance')} />
  }
  if (page === 'anniversary') {
    return <AnniversaryManager onBack={() => backFrom('anniversary')} />
  }
  return (
    <MainCenter
      onOpenProfile={() => openSubpage('profile')}
      onOpenAccount={() => openSubpage('account')}
      onOpenPrivacy={() => openSubpage('privacy')}
      onOpenProvider={() => openSubpage('provider')}
      onOpenUsage={() => openSubpage('usage')}
      onOpenGuide={() => onGoGuide?.()}
      onOpenAbout={() => openSubpage('about')}
      onOpenAppearance={() => openSubpage('appearance')}
      onOpenAnniversary={() => openSubpage('anniversary')}
      onOpenReply={() => openSubpage('reply')}
      onOpenInitiative={() => openSubpage('initiative')}
      onOpenFeedback={() => onGoFeedback?.()}
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

/* ---------------- 主页面：顶部资料卡 + 分组入口 ---------------- */

function MainCenter({
  onOpenProfile,
  onOpenAccount,
  onOpenPrivacy,
  onOpenProvider,
  onOpenUsage,
  onOpenGuide,
  onOpenAbout,
  onOpenAppearance,
  onOpenAnniversary,
  onOpenReply,
  onOpenInitiative,
  onOpenFeedback,
  onGoRoles,
  onGoAboutMe,
  onGoProfile,
  onGoWelcome,
}: {
  onOpenProfile: () => void
  onOpenAccount: () => void
  onOpenPrivacy: () => void
  onOpenProvider: () => void
  onOpenUsage: () => void
  onOpenGuide: () => void
  onOpenAbout: () => void
  onOpenAppearance: () => void
  onOpenAnniversary: () => void
  onOpenReply: () => void
  onOpenInitiative: () => void
  onOpenFeedback: () => void
  onGoRoles?: () => void
  onGoAboutMe?: () => void
  onGoProfile?: () => void
  onGoWelcome?: () => void
}) {
  const user = loadUserProfile()
  const settings = loadSettings()
  const activeProvider = settings.provider
  const providerLabel = PROVIDER_NAMES[activeProvider] ?? activeProvider
  const modelLabel = settings.providers[activeProvider]?.model?.trim() || '未设置'
  const accountLabel = getAccount()?.account ?? null
  const loggedIn = isLoggedIn()
  const replyLength = getGlobalReplyLength(accountLabel ?? '')
  const activeSessionId = getActiveSessionId()
  const initiative = getInitiativePreference(accountLabel ?? '', activeSessionId ?? '')
  const [systemNotifications, setSystemNotifications] = useState(() => isSystemNotificationEnabled())
  const [systemNotificationHint, setSystemNotificationHint] = useState('')

  const toggleSystemNotifications = async () => {
    setSystemNotificationHint('')
    if (systemNotifications) {
      if (saveSystemNotificationEnabled(false)) setSystemNotifications(false)
      return
    }
    const result = await requestSystemNotificationPermission()
    if (result === 'granted') {
      if (saveSystemNotificationEnabled(true)) setSystemNotifications(true)
      return
    }
    if (result === 'needs-home-screen') {
      setSystemNotificationHint('请先把忆文添加到主屏幕，再从主屏幕打开忆文开启通知。')
      return
    }
    if (result === 'unsupported') {
      setSystemNotificationHint('当前浏览器暂不支持系统通知。')
      return
    }
    setSystemNotificationHint('没有拿到系统通知权限，可以在系统设置里重新开启。')
  }

  const handleLogout = () => {
    if (!window.confirm('退出登录后，本地记录不会丢；下次登录同一账号就能找回来。确定退出吗？')) return
    logout()
    onGoWelcome?.()
  }

  return (
    <div className="page settings-page">
      <button type="button" className="profile-card profile-card-link" onClick={onOpenProfile} aria-label="编辑我的资料">
        <div className="profile-avatar-wrap">
          <span className="profile-avatar">
            {user.avatar.startsWith('data:') ? (
              <img src={user.avatar} alt="我的头像" />
            ) : (
              <DefaultAvatar kind="user" className="avatar-default" />
            )}
          </span>
        </div>
        <div className="profile-card-copy">
          <strong className="profile-card-name">{user.nickname.trim() || '设置你的名字'}</strong>
          <span className="profile-card-meta">{user.city?.trim() || '添加所在城市'}</span>
        </div>
        <svg className="entry-chevron" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <path d="M9 6l6 6-6 6" />
        </svg>
      </button>

      <ProfileGroup title="使用与支持">
        <EntryRow icon={<BookIcon />} label="使用指南" onClick={onOpenGuide} />
        <EntryRow icon={<KeyIcon />} label="API 设置" status={`${providerLabel} · ${modelLabel}`} onClick={onOpenProvider} />
        <EntryRow icon={<UsageIcon />} label="用量信息" onClick={onOpenUsage} />
        <div className="entry-row settings-toggle-row">
          <span className="entry-icon"><NotificationIcon /></span>
          <span className="entry-label">
            系统通知
            <small>{systemNotificationPermission() === 'granted' && systemNotifications ? '已开启' : '关闭时只在忆文里显示'}</small>
          </span>
          <button
            type="button"
            className={`settings-switch${systemNotifications ? ' on' : ''}`}
            role="switch"
            aria-checked={systemNotifications}
            aria-label="系统通知"
            onClick={() => void toggleSystemNotifications()}
          >
            <span />
          </button>
        </div>
        <p className="settings-inline-help">⚠️ios 用户：需要把忆文添加到主屏幕才能开启通知，safari 浏览器使用收不到哦</p>
        {systemNotificationHint ? <p className="settings-inline-help is-error" role="status">{systemNotificationHint}</p> : null}
        <EntryRow icon={<FeedbackIcon />} label="反馈与建议" onClick={onOpenFeedback} />
      </ProfileGroup>

      <ProfileGroup title="关于 TA">
        {onGoProfile && <EntryRow icon={<ProfileIcon />} label="TA 的资料" onClick={onGoProfile} />}
        <EntryRow
          icon={<ReplyLengthIcon />}
          label="聊天设置"
          status={replyLengthLabel(replyLength)}
          onClick={onOpenReply}
        />
        <EntryRow
          icon={<NotificationIcon />}
          label="主动消息"
          status={initiative.enabled ? '已开启' : '已关闭'}
          onClick={onOpenInitiative}
          disabled={!loggedIn || !activeSessionId}
        />
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
          status={accountLabel ? '已登录' : '未登录'}
        />
        <EntryRow icon={<PrivacyIcon />} label="隐私" onClick={onOpenPrivacy} />
        <EntryRow icon={<PaletteIcon />} label="外观" onClick={onOpenAppearance} />
        <EntryRow icon={<InfoIcon />} label="关于忆文" onClick={onOpenAbout} />
        <EntryRow icon={<HomeIcon />} label="回到欢迎页" onClick={onGoWelcome} />
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

function UsageInfoDetail({ onBack }: { onBack: () => void }) {
  const sessions = getSessionsCache()
  const [turns] = useState(() => getAllLocalContextUsageTurns(sessions.map((session) => session.id)))
  const summary = summarizeUsageTurns(turns)
  const globalName = loadAIProfile().nickname
  const maxDayTokens = Math.max(
    1,
    ...summary.days.map((day) => day.inputTokens + day.outputTokens),
  )
  const recent = turns.slice(0, 50)
  const todayTokens = summary.today.inputTokens + summary.today.outputTokens
  const cacheLabel = summary.cacheHitRate == null
    ? '不可测'
    : `${(summary.cacheHitRate * 100).toFixed(1)}%`

  const sessionName = (sessionId: string) =>
    resolveRoleName(sessionId, sessions, globalName)

  return (
    <div className="page settings-page usage-info-page">
      <DetailHeader title="用量信息" onBack={onBack} />

      <p className="usage-info-local-note">
        这里只统计这台设备上的模型调用，不上传逐轮明细。服务商没有返回的项目会标为估算或未知。
      </p>

      {turns.length === 0 ? (
        <div className="usage-info-empty">
          <strong>还没有可显示的用量</strong>
          <span>和 TA 聊几轮后，这里会开始记录。</span>
        </div>
      ) : (
        <>
          <section className="usage-info-summary" aria-label="今日用量">
            <div className="usage-info-stat">
              <span>今日用量</span>
              <strong>{formatUsageTokens(todayTokens)}</strong>
              <small>
                输入 {formatUsageTokens(summary.today.inputTokens)} · 输出 {formatUsageTokens(summary.today.outputTokens)}
              </small>
            </div>
            <div className="usage-info-stat">
              <span>今日花费</span>
              <strong>{formatUsageMoney(summary.today.cost)}</strong>
              <small>
                {summary.today.cost.unknownTurns > 0
                  ? `${summary.today.cost.unknownTurns} 轮价格未知`
                  : '按公开价估算'}
              </small>
            </div>
            <div className="usage-info-stat">
              <span>缓存命中率</span>
              <strong>{cacheLabel}</strong>
              <small>
                {summary.cacheHitRate == null
                  ? '服务商未返回缓存用量'
                  : summary.cacheUnknownTurns > 0
                    ? `另有 ${summary.cacheUnknownTurns} 轮不可测`
                    : '按服务商返回值计算'}
              </small>
            </div>
          </section>

          <section className="usage-info-section">
            <h3>近 7 天</h3>
            <div className="usage-info-days">
              {summary.days.map((day) => {
                const total = day.inputTokens + day.outputTokens
                const width = total > 0 ? Math.max(4, (total / maxDayTokens) * 100) : 0
                return (
                  <div className="usage-info-day" key={day.key}>
                    <span className="usage-info-day-label">{day.label}</span>
                    <span className="usage-info-day-track" aria-hidden="true">
                      <span className="usage-info-day-bar" style={{ width: `${width}%` }} />
                    </span>
                    <span className="usage-info-day-value">{formatUsageTokens(total)}</span>
                  </div>
                )
              })}
            </div>
          </section>

          <section className="usage-info-section">
            <h3>按 TA</h3>
            <div className="usage-info-role-list">
              {summary.sessions.map((item) => (
                <div className="usage-info-role" key={item.sessionId}>
                  <div>
                    <strong>{sessionName(item.sessionId)}</strong>
                    <span>{item.turns} 轮</span>
                  </div>
                  <div className="usage-info-role-value">
                    <strong>{formatUsageTokens(item.inputTokens + item.outputTokens)}</strong>
                    <span>{formatUsageMoney(item.cost)}</span>
                  </div>
                </div>
              ))}
            </div>
          </section>

          <section className="usage-info-section">
            <h3>每轮明细</h3>
            <div className="usage-info-turn-list">
              {recent.map((turn) => {
                const cost = estimateUsageTurnCost(turn)
                const time = new Date(turn.createdAt).toLocaleString(undefined, {
                  month: 'numeric',
                  day: 'numeric',
                  hour: '2-digit',
                  minute: '2-digit',
                })
                return (
                  <div className="usage-info-turn" key={turn.id}>
                    <div className="usage-info-turn-head">
                      <strong>{sessionName(turn.sessionId)}</strong>
                      <span>{time}</span>
                    </div>
                    <div className="usage-info-turn-model">
                      {PROVIDER_NAMES[turn.provider] ?? turn.provider} · {turn.model || '模型未知'}
                    </div>
                    <div className="usage-info-turn-metrics">
                      <span>输入 {formatUsageTokens(turn.inputTokens)}</span>
                      <span>输出 {turn.outputTokens == null ? '未知' : formatUsageTokens(turn.outputTokens)}</span>
                      <span>缓存 {turn.cachedTokens == null ? '未知' : formatUsageTokens(turn.cachedTokens)}</span>
                      <span>花费 {cost ? formatUsageMoney({
                        CNY: cost.currency === 'CNY' ? cost.amount : 0,
                        USD: cost.currency === 'USD' ? cost.amount : 0,
                        unknownTurns: 0,
                        cacheEstimatedTurns: cost.cacheKnown ? 0 : 1,
                      }) : '未知'}</span>
                    </div>
                    <div className="usage-info-turn-source">
                      {turn.source === 'actual' ? '服务商返回' : '本地估算'}
                      {cost && !cost.cacheKnown ? ' · 缓存项按未命中估算' : ''}
                    </div>
                  </div>
                )
              })}
            </div>
          </section>

          <p className="usage-info-footnote">
            花费只按忆文内置的公开价格表估算，服务商最终账单为准；无法确认价格的模型不会硬算。
          </p>
        </>
      )}
    </div>
  )
}

function ReplyLengthDetail({ onBack }: { onBack: () => void }) {
  const accountId = getAccount()?.account ?? ''
  const [value, setValue] = useState<ReplyLength>(() => getGlobalReplyLength(accountId))
  const [actionNarration, setActionNarration] = useState(() => isActionNarrationEnabled())
  const [error, setError] = useState('')

  const options: Array<{ value: ReplyLength; title: string; note: string }> = [
    { value: 'natural', title: '自然', note: '不做额外限制，按聊天内容自然回复' },
    { value: 'short', title: '简洁', note: '更利落一点，省掉不必要的展开' },
    { value: 'medium', title: '适中', note: '该说的说完整，不过分展开' },
    { value: 'long', title: '详细', note: '可以把细节和想法多说一点' },
  ]

  const choose = (next: ReplyLength) => {
    if (!accountId) return
    if (!saveGlobalReplyLength(accountId, next)) {
      setError('没有保存成功，稍后再试一下')
      return
    }
    setError('')
    setValue(next)
  }

  const toggleActionNarration = () => {
    const next = !actionNarration
    if (!saveActionNarrationEnabled(next)) {
      setError('没有保存成功，稍后再试一下')
      return
    }
    setError('')
    setActionNarration(next)
  }

  return (
    <div className="page settings-page reply-length-page">
      <DetailHeader title="聊天设置" onBack={onBack} />

      <section className="chat-settings-section">
        <div className="chat-settings-section-head">
          <h2>回复长度</h2>
          <p>选择 TA 平时说话展开到什么程度。</p>
        </div>
        <p className="hint">这个偏好会跟账号同步；某个 TA 想单独调整，可以在聊天右上角「聊天设置」里覆盖。</p>
        <div className="reply-length-options" role="radiogroup" aria-label="全局回复长度">
          {options.map((option) => {
            const selected = option.value === value
            return (
              <button
                key={option.value}
                type="button"
                className={`reply-length-option${selected ? ' is-selected' : ''}`}
                role="radio"
                aria-checked={selected}
                onClick={() => choose(option.value)}
              >
                <span className="reply-length-option-copy">
                  <strong>{option.title}</strong>
                  <span>{option.note}</span>
                </span>
                <span className="reply-length-radio" aria-hidden="true">
                  {selected ? <span /> : null}
                </span>
              </button>
            )
          })}
        </div>
      </section>

      <section className="chat-settings-section">
        <div className="chat-settings-section-head">
          <h2>动作与旁白</h2>
          <p>开启后，TA 可以用括号写简短动作或旁白，输入框也会显示（）快捷按钮。</p>
        </div>
        <div className="chat-settings-card">
          <div className="chat-follow-row">
            <div className="chat-follow-copy">
              <strong>允许括号动作与旁白</strong>
              <small>{actionNarration ? '已开启 · 所有 TA 共用' : '已关闭 · 保持纯对话'}</small>
            </div>
            <button
              type="button"
              className={`chat-follow-switch${actionNarration ? ' is-on' : ''}`}
              role="switch"
              aria-checked={actionNarration}
              aria-label={`动作与旁白，当前${actionNarration ? '已开启' : '已关闭'}`}
              onClick={toggleActionNarration}
            >
              <span aria-hidden="true" />
            </button>
          </div>
        </div>
      </section>

      {error ? <p className="reply-length-error" role="status">{error}</p> : null}
    </div>
  )
}

function InitiativeDetail({ onBack }: { onBack: () => void }) {
  const accountId = getAccount()?.account ?? ''
  const sessionId = getActiveSessionId() ?? ''
  const [preference, setPreference] = useState(() => getInitiativePreference(accountId, sessionId))
  const [notice, setNotice] = useState('')

  const persist = (patch: Partial<typeof preference>) => {
    if (!accountId || !sessionId) return
    const next = { ...preference, ...patch }
    if (!saveInitiativePreference(accountId, sessionId, next)) {
      setNotice('这次没有保存上，稍后再试。')
      return
    }
    setPreference(getInitiativePreference(accountId, sessionId))
    setNotice('已保存')
    window.setTimeout(() => setNotice(''), 1200)
  }

  const hourOptions = Array.from({ length: 24 }, (_, hour) => ({
    value: hour,
    label: `${String(hour).padStart(2, '0')}:00`,
  }))

  return (
    <div className="page settings-page initiative-settings-page">
      <DetailHeader title="主动消息" onBack={onBack} />

      <div className="settings-card initiative-settings-card">
        <div className="initiative-setting-row">
          <div>
            <strong>允许 TA 主动来找你</strong>
            <p>只有有真实理由时才会发，不会为了凑频率硬聊。</p>
          </div>
          <button
            type="button"
            className={`settings-switch${preference.enabled ? ' on' : ''}`}
            role="switch"
            aria-checked={preference.enabled}
            aria-label="允许 TA 主动来找你"
            onClick={() => persist({ enabled: !preference.enabled })}
          >
            <span />
          </button>
        </div>

        <div className="field initiative-field">
          <label htmlFor="initiative-frequency">频率</label>
          <select
            id="initiative-frequency"
            className="input"
            value={Math.min(3, preference.dailyLimit)}
            onChange={(event) => persist({ dailyLimit: Number(event.target.value) })}
            disabled={!preference.enabled}
          >
            <option value={1}>少一点 · 每天最多 1 次</option>
            <option value={2}>适中 · 每天最多 2 次</option>
            <option value={3}>多一点 · 每天最多 3 次</option>
          </select>
          <p className="hint">如果你没有回应，下一次主动消息会自动隔得更久。</p>
        </div>

        <div className="initiative-quiet">
          <div>
            <strong>静默时段</strong>
            <p>这段时间 TA 不会主动发消息。</p>
          </div>
          <div className="initiative-quiet-inputs">
            <label>
              <span>开始</span>
              <select
                className="input"
                value={preference.quietStartHour}
                onChange={(event) => persist({ quietStartHour: Number(event.target.value) })}
                disabled={!preference.enabled}
              >
                {hourOptions.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
              </select>
            </label>
            <span aria-hidden="true">—</span>
            <label>
              <span>结束</span>
              <select
                className="input"
                value={preference.quietEndHour}
                onChange={(event) => persist({ quietEndHour: Number(event.target.value) })}
                disabled={!preference.enabled}
              >
                {hourOptions.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
              </select>
            </label>
          </div>
        </div>
      </div>

      {notice ? <p className="settings-inline-notice" role="status">{notice}</p> : null}
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
  unread = false,
}: {
  icon: ReactNode
  label: string
  onClick?: () => void
  status?: string
  disabled?: boolean
  unread?: boolean
}) {
  return (
    <button
      type="button"
      className={`entry-row${disabled ? ' entry-row-disabled' : ''}`}
      onClick={onClick}
      disabled={disabled}
      aria-label={unread ? `${label}，有新消息` : undefined}
    >
      <span className="entry-icon">{icon}</span>
      <span className="entry-label">{label}</span>
      {status && <span className="entry-status">{status}</span>}
      {unread ? <span className="entry-unread-dot" aria-hidden="true" /> : null}
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

function UpdateControls({ standalone = false }: { standalone?: boolean }) {
  const [expanded, setExpanded] = useState(false)
  const [checking, setChecking] = useState(false)
  const [checkHint, setCheckHint] = useState('')

  // #21：不再盲目 reload，先探一次线上 build；有新版本页面顶部会出现提示条（同一套检测）。
  const checkUpdate = async () => {
    setExpanded(true)
    if (checking) return
    setChecking(true)
    setCheckHint('')
    const result = await checkDeployedBuild()
    setChecking(false)
    if (result === 'updated') setCheckHint('发现新版本，看页面顶部的提示刷新一下')
    else if (result === 'current') setCheckHint('已经是最新版本')
    else setCheckHint('暂时检查不了，过会儿再试')
  }

  const doForceRefresh = () => {
    if (!window.confirm('强制刷新会清除页面缓存并重新加载，继续吗？')) return
    void forceRefresh()
  }

  const secondary = (
    <div className="update-controls-secondary">
      <button type="button" className="btn btn-ghost" onClick={() => void checkUpdate()} disabled={checking}>
        {checking ? '检查中…' : '检查新版本'}
      </button>
      <button type="button" className="btn btn-ghost" onClick={doForceRefresh}>强制刷新</button>
      {checkHint && <p className="update-check-hint" role="status">{checkHint}</p>}
    </div>
  )

  if (standalone) {
    return (
      <div className="settings-card update-controls-card">
        <button type="button" className="entry-row" onClick={() => setExpanded((v) => !v)}>
          <span className="entry-icon"><UpdateIcon /></span>
          <span className="entry-label">检查更新</span>
          <svg className="entry-chevron" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M9 6l6 6-6 6" />
          </svg>
        </button>
        {expanded && secondary}
      </div>
    )
  }

  return (
    <div className="update-controls-inline">
      <button type="button" className="entry-row" onClick={() => setExpanded((v) => !v)}>
        <span className="entry-icon"><UpdateIcon /></span>
        <span className="entry-label">检查更新</span>
        <span className="entry-status">当前版本</span>
        <svg className="entry-chevron" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <path d="M9 6l6 6-6 6" />
        </svg>
      </button>
      {expanded && secondary}
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

const UsageIcon = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M5 19V9" />
    <path d="M12 19V5" />
    <path d="M19 19v-7" />
    <path d="M3 19h18" />
  </svg>
)

const InfoIcon = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <circle cx="12" cy="12" r="9" />
    <path d="M12 8h.01" />
    <path d="M11 12h1v4h1" />
  </svg>
)

const NotificationIcon = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M18 8a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9" />
    <path d="M10 21h4" />
  </svg>
)

/* 反馈与建议：对话气泡 */
const FeedbackIcon = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M20 12.5c0 3.6-3.6 6.5-8 6.5-1 0-2-.2-2.9-.5L5 20l1.2-3.2A6.6 6.6 0 0 1 4 12.5C4 8.9 7.6 6 12 6s8 2.9 8 6.5z" />
    <path d="M9.5 12.5h5" />
  </svg>
)

const PrivacyIcon = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M12 3l7 3v5c0 4.7-2.8 8.1-7 10-4.2-1.9-7-5.3-7-10V6l7-3z" />
    <path d="M9.5 12l1.7 1.7 3.5-3.8" />
  </svg>
)

const BookIcon = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20" />
    <path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z" />
  </svg>
)

const ReplyLengthIcon = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M5 7h14" />
    <path d="M5 12h10" />
    <path d="M5 17h7" />
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

/* 回到欢迎页：小房子 */
const HomeIcon = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M3 11.5 12 4l9 7.5" />
    <path d="M5.5 9.8V20h13V9.8" />
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
  const initialRelationship = loadRelationshipSetting(viewSessionId || undefined)
  const [relationshipPreset, setRelationshipPreset] = useState<RelationshipPreset | ''>(() => initialRelationship?.preset ?? '')
  const [relationshipCustom, setRelationshipCustom] = useState(() => initialRelationship?.customLabel ?? '')
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

  const handleSaveRelationship = () => {
    if (!activeSessionId) return
    const saved = saveRelationshipSetting(
      activeSessionId,
      relationshipPreset || undefined,
      relationshipPreset === '自定义' ? relationshipCustom : undefined,
    )
    if (!saved) return
    dirtyRef.current = true
    flashSaved('relationship')
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
          <label htmlFor="ai-relationship">关系设定</label>
          <select
            id="ai-relationship"
            className="input"
            value={relationshipPreset}
            onChange={(event) => setRelationshipPreset(event.target.value as RelationshipPreset | '')}
            disabled={!hasSession}
          >
            <option value="">不设定</option>
            {RELATIONSHIP_PRESETS.map((option) => (
              <option key={option} value={option}>{option}</option>
            ))}
          </select>
          {relationshipPreset === '自定义' && (
            <input
              className="input"
              type="text"
              value={relationshipCustom}
              onChange={(event) => setRelationshipCustom(event.target.value)}
              maxLength={40}
              placeholder="写下你们的关系"
              autoComplete="off"
            />
          )}
          <div className="ai-save-row ai-save-row-end">
            <button
              type="button"
              className="btn btn-primary ai-save-btn"
              onClick={handleSaveRelationship}
              disabled={!hasSession || saving || (relationshipPreset === '自定义' && !relationshipCustom.trim())}
            >
              {savedField === 'relationship' ? '已保存' : '保存关系'}
            </button>
          </div>
          <p className="hint">选填。修改关系设定不会改写已经发生过的聊天和共同经历。</p>
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
          <label htmlFor="ai-background">背景设定</label>
          <textarea
            id="ai-background"
            className="input persona-input"
            rows={3}
            placeholder="TA 的经历、世界观、相处背景"
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

/* ---------------- 详情页：API 设置 ---------------- */

/* ---------------- 详情页：我的资料 ---------------- */

function MyProfileDetail({ onBack }: { onBack: () => void }) {
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
      <div className="profile-card profile-edit-card">
        <div className="profile-avatar-wrap">
          <button type="button" className="profile-avatar" onClick={() => setPicking((v) => !v)} aria-label={picking ? '收起头像选择' : '更换头像'}>
            {user.avatar.startsWith('data:') ? <img src={user.avatar} alt="我的头像" /> : <DefaultAvatar kind="user" className="avatar-default" />}
            <span className="profile-avatar-badge">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <path d="M4 8h3l2-2.5h6L17 8h3a1 1 0 0 1 1 1v9a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V9a1 1 0 0 1 1-1z" />
                <circle cx="12" cy="13.5" r="3.2" />
              </svg>
            </span>
          </button>
        </div>
        <label className="profile-field">
          <span>名字</span>
          <input className="profile-name" type="text" placeholder="你希望 TA 怎么叫你？" value={user.nickname} onChange={(e) => updateUser({ nickname: e.target.value })} autoComplete="off" />
        </label>
        <label className="profile-field">
          <span>一句话介绍</span>
          <input className="profile-bio" type="text" placeholder="让 TA 更懂你" value={user.bio} onChange={(e) => updateUser({ bio: e.target.value })} autoComplete="off" />
        </label>
        <label className="profile-field">
          <span>所在城市</span>
          <input className="profile-bio" type="text" placeholder="例如：杭州" value={user.city ?? ''} maxLength={40} onChange={(e) => updateUser({ city: e.target.value })} autoComplete="address-level2" />
        </label>
        <p className="profile-city-note">用于当地天气；开启首页天气后，城市和当前天气也可作为对话上下文发送给你选择的模型服务，让 TA 知道你那边的天气。</p>
        {picking && <div className="profile-avatar-pick"><AvatarPicker value={user.avatar} onChange={(avatar) => updateUser({ avatar })} /></div>}
      </div>
    </div>
  )
}

/* ---------------- 详情页：隐私（文案待七七最终拍板） ---------------- */

function PrivacyDetail({ onBack }: { onBack: () => void }) {
  return (
    <div className="page settings-page privacy-page">
      <DetailHeader title="隐私" onBack={onBack} />
      <div className="privacy-detail-card">
        <section>
          <h3>你的内容属于你</h3>
          <p>你在忆文里的聊天、记忆和与 TA 相处产生的内容，是为了让 TA 记住你、保持关系和对话的连续。忆文不会把这些内容当作平台自己的内容使用。</p>
        </section>
        <section>
          <h3>忆文不会为了运营查看你的私人对话</h3>
          <p>与账号关联保存的数据，只用于提供你正在使用的功能，例如聊天记录、记忆和跨设备同步。忆文不会为了运营、广告或了解你在聊什么而主动查看你的私人聊天内容。</p>
        </section>
        <section>
          <h3>你的模型 Key 不会交给忆文使用</h3>
          <p>你配置的模型服务 Key 用于在你的设备上连接你选择的模型服务。忆文不会拿你的 Key 为其他用户提供服务，也不会占用你的模型额度做与本人使用无关的事情。</p>
        </section>
        <section>
          <h3>不会拿你的对话训练外部模型</h3>
          <p>忆文不会把你的对话内容用于训练外部模型，也不会向第三方出售你的个人信息。</p>
        </section>
        <section>
          <h3>你可以管理自己的记录</h3>
          <p>你可以在忆文中查看和管理自己的聊天、记忆及账号相关内容。账号与同步相关设置可以在「我的 → 账号与同步」中管理。</p>
        </section>
        <section>
          <h3>关于第三方模型服务</h3>
          <p>当你使用自己配置的模型服务时，为了获得回复，必要的对话上下文会发送给你选择的模型服务商。相关内容如何被该服务商处理，以对应服务商的隐私政策和服务条款为准。</p>
        </section>
      </div>
    </div>
  )
}

/* ---------------- 详情页：API 设置 ---------------- */

// onGoGuide 保留在签名里兼容调用方，页面内已改为打开「怎么获取 API Key」弹层
function ProviderDetail({ onBack }: { onBack: () => void; onGoGuide?: () => void }) {
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
  // 不会配 Key？打开「怎么获取 API Key」弹层（不再跳去使用指南）
  const [keyGuideOpen, setKeyGuideOpen] = useState(false)

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
        <button type="button" className="provider-guide-link" onClick={() => setKeyGuideOpen(true)}>
          不会配？点这里看怎么获取 Key
        </button>

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
                    {provider === 'mimo' && (m === 'mimo-v2.5-pro' || m === 'mimo-v2.5') ? `${m}（即将下线）` : m}
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

      <KeyGuideSheet open={keyGuideOpen} onClose={() => setKeyGuideOpen(false)} />

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

function AboutDetail({ onBack }: { onBack: () => void }) {
  const buildVersion = getCurrentBuildVersion()
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
        <p className="about-contact">
          <a href="/privacy.html">隐私政策</a>
        </p>
        <p className="about-version">忆文 Eluvin v1.2.3 · 内测版</p>
        {buildVersion && (
          <p className="about-build" title={buildVersion}>
            当前构建 <span className="about-build-sha">{buildVersion.slice(0, 8)}</span>
          </p>
        )}
      </div>
      <UpdateControls standalone />
    </div>
  )
}
