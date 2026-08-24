import { useRef, useState, type ReactNode } from 'react'
import ProviderSelect from './ProviderSelect'
import AvatarPicker from './AvatarPicker'
import DefaultAvatar from './DefaultAvatar'
import Account from './Account'
import {
  DEFAULT_SETTINGS,
  loadSettings,
  loadPersona,
  loadUserProfile,
  loadAIProfile,
  saveSettings,
  savePersona,
  saveUserProfile,
  saveAIProfile,
  PROVIDER_NAMES,
  type ModelSettings,
  type Provider,
  type UserProfile,
  type AIProfile,
} from '../lib/storage'
import { getAccount } from '../lib/sync'
import { isLoggedIn, logout } from '../lib/auth'
import { ChatError, testConnection } from '../lib/api'
import { keyFormatHint } from '../lib/keyFormat'

type TestState = 'idle' | 'testing' | 'success' | 'error'

/** 设置页子页：使用指南已抽成 App 独立 view（guide），不再嵌在这里 */
export type SettingsPage = 'main' | 'ai' | 'provider' | 'about' | 'account'

interface Props {
  onOpenSpace?: () => void
  onGoWelcome?: () => void
  /** 「换个 TA」回调：清空人设后由 App 跳到选角色页 */
  onSwitchRole?: () => void
  /** 「使用指南」入口：由 App 切到独立 guide view（游客也可看） */
  onGoGuide?: () => void
  /** 进入设置页时打开的子页 */
  initialPage?: SettingsPage
}

export default function Settings({ onOpenSpace, onGoWelcome, onSwitchRole, onGoGuide, initialPage }: Props) {
  const [page, setPage] = useState<SettingsPage>(initialPage ?? 'main')

  if (page === 'ai') {
    return <AIDetail onBack={() => setPage('main')} onOpenSpace={onOpenSpace} onSwitchRole={onSwitchRole} />
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
  return (
    <MainCenter
      onOpenAccount={() => setPage('account')}
      onOpenAI={() => setPage('ai')}
      onOpenProvider={() => setPage('provider')}
      onOpenGuide={() => onGoGuide?.()}
      onOpenAbout={() => setPage('about')}
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
  onOpenAI,
  onOpenProvider,
  onOpenGuide,
  onOpenAbout,
  onGoWelcome,
}: {
  onOpenAccount: () => void
  onOpenAI: () => void
  onOpenProvider: () => void
  onOpenGuide: () => void
  onOpenAbout: () => void
  onGoWelcome?: () => void
}) {
  const [user, setUser] = useState<UserProfile>(() => loadUserProfile())
  const [picking, setPicking] = useState(false)
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

      <ProfileGroup title="我的 AI">
        <EntryRow icon={<PortraitIcon />} label="TA 的资料" onClick={onOpenAI} />
      </ProfileGroup>

      <ProfileGroup title="设置">
        <EntryRow icon={<KeyIcon />} label="服务商配置" onClick={onOpenProvider} />
        <EntryRow icon={<BookIcon />} label="使用指南" onClick={onOpenGuide} />
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

const PortraitIcon = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <circle cx="12" cy="8" r="4" />
    <path d="M4 21v-1a7 7 0 0 1 7-7h2a7 7 0 0 1 7 7v1" />
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

/* ---------------- 详情页：TA 的资料 ---------------- */

function AIDetail({
  onBack,
  onOpenSpace,
  onSwitchRole,
}: {
  onBack: () => void
  onOpenSpace?: () => void
  onSwitchRole?: () => void
}) {
  const [ai, setAI] = useState<AIProfile>(() => loadAIProfile())
  const [persona, setPersona] = useState(() => loadPersona())
  const [saved, setSaved] = useState(false)

  const handleSave = () => {
    saveAIProfile(ai)
    savePersona(persona)
    setSaved(true)
    setTimeout(() => setSaved(false), 2000)
  }

  // 换个 TA：二次确认后只清人设，绝不动聊天记录和记忆；跳回选角色页
  const handleSwitchRole = () => {
    if (!onSwitchRole) return
    if (!window.confirm('换掉现在的 TA 吗？历史记忆不会清除')) return
    savePersona('')
    onSwitchRole()
  }

  return (
    <div className="page settings-page">
      <DetailHeader title="TA 的资料" onBack={onBack} />

      <div className="settings-card">
        <p className="hint">给陪伴你的 TA 起个名字、选个样子。</p>

        <div className="field">
          <label>TA 的头像</label>
          <AvatarPicker value={ai.avatar} onChange={(avatar) => setAI({ ...ai, avatar })} />
        </div>

        {onOpenSpace && (
          <button type="button" className="btn btn-ghost ai-space-entry" onClick={onOpenSpace}>
            看看 TA 的生活 →
          </button>
        )}

        <div className="field">
          <label htmlFor="ai-nickname">TA 的名字</label>
          <input
            id="ai-nickname"
            className="input"
            type="text"
            placeholder="给 TA 起个名字吧"
            value={ai.nickname}
            onChange={(e) => setAI({ ...ai, nickname: e.target.value })}
            autoComplete="off"
          />
        </div>

        <div className="field">
          <label htmlFor="persona">专属人设（可选）</label>
          <textarea
            id="persona"
            className="input persona-input"
            rows={4}
            placeholder={'想让 TA 是什么都可以——包括你的编程搭子、工作助理'}
            value={persona}
            onChange={(e) => setPersona(e.target.value)}
          />
          <p className="hint">填了之后，TA 会把你设定的当成真实的自己，聊天时就这么表现；不填就用默认人设</p>
        </div>

        <div className="settings-actions">
          <button className="btn btn-primary" onClick={handleSave}>
            {saved ? '已保存' : '保存'}
          </button>
          {onSwitchRole && (
            <button type="button" className="btn btn-ghost" onClick={handleSwitchRole}>
              换个 TA
            </button>
          )}
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
          忆文 Eluvin v0.2.3 · 内测版
        </button>
      </div>
    </div>
  )
}
