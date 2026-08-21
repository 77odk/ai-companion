import { useState } from 'react'
import ProviderSelect from './ProviderSelect'
import AvatarPicker from './AvatarPicker'
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

const USER_AVATARS = ['😊', '😎', '🥰', '🤗', '🐱', '🐶', '🦊', '🐼', '🌸', '🌙', '⭐', '❤️']
const AI_AVATARS = ['💛', '🌟', '💙', '💜', '🧡', '🦋', '🌈', '✨', '🌻', '🔥', '🐳', '🎧']

export default function Settings() {
  const [initial] = useState(loadSettings)
  const [provider, setProvider] = useState<Provider>(initial.provider)
  const [apiKey, setApiKey] = useState(initial.providers[initial.provider].apiKey)
  const [baseUrl, setBaseUrl] = useState(initial.providers[initial.provider].baseUrl)
  const [model, setModel] = useState(initial.providers[initial.provider].model)
  const [advancedOpen, setAdvancedOpen] = useState(initial.provider === 'custom')
  const [saved, setSaved] = useState(false)
  const [testState, setTestState] = useState<TestState>('idle')
  const [testMsg, setTestMsg] = useState('')
  const [persona, setPersona] = useState(() => loadPersona())

  const [user, setUser] = useState<UserProfile>(() => loadUserProfile())
  const [ai, setAI] = useState<AIProfile>(() => loadAIProfile())

  const handleProviderChange = (p: Provider) => {
    setProvider(p)
    // 调出该服务商自己存过的配置；没存过就是空 key + 默认地址/模型
    const cfg = initial.providers[p]
    setApiKey(cfg.apiKey)
    setBaseUrl(cfg.baseUrl || DEFAULT_SETTINGS[p].baseUrl)
    setModel(cfg.model || DEFAULT_SETTINGS[p].model)
    // 自定义服务商必须填地址，自动展开高级设置
    setAdvancedOpen(p === 'custom')
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
    savePersona(persona)
    saveUserProfile(user)
    saveAIProfile(ai)
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
      {/* 我的资料 */}
      <div className="settings-card">
        <h3 className="settings-card-title">我的资料</h3>
        <p className="hint">它怎么称呼你，就填什么昵称。</p>

        <div className="field">
          <label>我的头像</label>
          <AvatarPicker options={USER_AVATARS} value={user.avatar} onChange={(avatar) => setUser({ ...user, avatar })} />
        </div>

        <div className="field">
          <label htmlFor="user-nickname">我的昵称</label>
          <input
            id="user-nickname"
            className="input"
            type="text"
            placeholder="你希望它怎么叫你？"
            value={user.nickname}
            onChange={(e) => setUser({ ...user, nickname: e.target.value })}
            autoComplete="off"
          />
        </div>

        <div className="field">
          <label htmlFor="user-bio">个性签名</label>
          <input
            id="user-bio"
            className="input"
            type="text"
            placeholder="一句话介绍自己（可选）"
            value={user.bio}
            onChange={(e) => setUser({ ...user, bio: e.target.value })}
            autoComplete="off"
          />
        </div>
      </div>

      {/* 我的 AI */}
      <div className="settings-card">
        <h3 className="settings-card-title">我的 AI</h3>
        <p className="hint">给陪伴你的它起个名字、选个样子。</p>

        <div className="field">
          <label>它的头像</label>
          <AvatarPicker options={AI_AVATARS} value={ai.avatar} onChange={(avatar) => setAI({ ...ai, avatar })} />
        </div>

        <div className="field">
          <label htmlFor="ai-nickname">它的名字</label>
          <input
            id="ai-nickname"
            className="input"
            type="text"
            placeholder="给它起个名字吧"
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
            placeholder={'它怎么称呼你？它是什么性格？你们是什么关系？\n有什么只有你们知道的梗？\n\n不填就用默认人设～'}
            value={persona}
            onChange={(e) => setPersona(e.target.value)}
          />
          <p className="hint">填了之后，TA 会把你设定的当成真实的自己，聊天时就这么表现；不填就用默认人设</p>
        </div>
      </div>

      {/* 服务商配置：服务商 + Key + 模型名 一体 */}
      <div className="settings-card">
        <h3 className="settings-card-title">服务商配置</h3>
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
          {advancedOpen ? '收起高级设置 ▴' : '高级设置 ▾'}
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
          {saved ? '已保存 ✓' : '保存设置'}
        </button>
        <button className="btn btn-ghost" onClick={handleTest} disabled={testState === 'testing'}>
          {testState === 'testing' ? '测试中…' : '测试连接'}
        </button>
      </div>

      {testMsg && <p className={resultClass}>{testMsg}</p>}
    </div>
  )
}
