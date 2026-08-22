import { useRef, useState, type ReactNode } from 'react'
import ProviderSelect from './ProviderSelect'
import AvatarPicker from './AvatarPicker'
import DefaultAvatar from './DefaultAvatar'
import GuideDetail from './Guide'
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
import { ChatError, testConnection } from '../lib/api'

type TestState = 'idle' | 'testing' | 'success' | 'error'
type Page = 'main' | 'ai' | 'provider' | 'guide' | 'about'

interface Props {
  onOpenSpace?: () => void
  onGoWelcome?: () => void
}

export default function Settings({ onOpenSpace, onGoWelcome }: Props) {
  const [page, setPage] = useState<Page>('main')

  if (page === 'ai') {
    return <AIDetail onBack={() => setPage('main')} onOpenSpace={onOpenSpace} />
  }
  if (page === 'provider') {
    return <ProviderDetail onBack={() => setPage('main')} />
  }
  if (page === 'guide') {
    return <GuideDetail onBack={() => setPage('main')} onGoProvider={() => setPage('provider')} />
  }
  if (page === 'about') {
    return <AboutDetail onBack={() => setPage('main')} onGoWelcome={onGoWelcome} />
  }
  return (
    <MainCenter
      onOpenAI={() => setPage('ai')}
      onOpenProvider={() => setPage('provider')}
      onOpenGuide={() => setPage('guide')}
      onOpenAbout={() => setPage('about')}
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
  onOpenAI,
  onOpenProvider,
  onOpenGuide,
  onOpenAbout,
}: {
  onOpenAI: () => void
  onOpenProvider: () => void
  onOpenGuide: () => void
  onOpenAbout: () => void
}) {
  const [user, setUser] = useState<UserProfile>(() => loadUserProfile())
  const [picking, setPicking] = useState(false)

  const updateUser = (patch: Partial<UserProfile>) => {
    const next = { ...user, ...patch }
    setUser(next)
    saveUserProfile(next)
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

function EntryRow({ icon, label, onClick }: { icon: ReactNode; label: string; onClick: () => void }) {
  return (
    <button type="button" className="entry-row" onClick={onClick}>
      <span className="entry-icon">{icon}</span>
      <span className="entry-label">{label}</span>
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

function AIDetail({ onBack, onOpenSpace }: { onBack: () => void; onOpenSpace?: () => void }) {
  const [ai, setAI] = useState<AIProfile>(() => loadAIProfile())
  const [persona, setPersona] = useState(() => loadPersona())
  const [saved, setSaved] = useState(false)

  const handleSave = () => {
    saveAIProfile(ai)
    savePersona(persona)
    setSaved(true)
    setTimeout(() => setSaved(false), 2000)
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
            placeholder={'TA 怎么称呼你？TA 是什么性格？你们是什么关系？\n有什么只有你们知道的秘密？\n\n不填就用默认人设～'}
            value={persona}
            onChange={(e) => setPersona(e.target.value)}
          />
          <p className="hint">填了之后，TA 会把你设定的当成真实的自己，聊天时就这么表现；不填就用默认人设</p>
        </div>

        <div className="settings-actions">
          <button className="btn btn-primary" onClick={handleSave}>
            {saved ? '已保存' : '保存'}
          </button>
        </div>
      </div>
    </div>
  )
}

/* ---------------- 详情页：服务商配置 ---------------- */

function ProviderDetail({ onBack }: { onBack: () => void }) {
  const [initial] = useState(loadSettings)
  const [provider, setProvider] = useState<Provider>(initial.provider)
  const [apiKey, setApiKey] = useState(initial.providers[initial.provider].apiKey)
  const [baseUrl, setBaseUrl] = useState(initial.providers[initial.provider].baseUrl)
  const [model, setModel] = useState(initial.providers[initial.provider].model)
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
            onChange={(e) => setApiKey(e.target.value)}
            autoComplete="off"
          />
        </div>

        <div className="field">
          <label htmlFor="model">模型名称</label>
          <input
            id="model"
            className="input"
            type="text"
            placeholder="deepseek-chat"
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
          忆文 Eluvin v0.2.1 · 内测版
        </button>
      </div>
    </div>
  )
}
