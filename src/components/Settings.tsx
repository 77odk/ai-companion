import { useState } from 'react'
import ProviderSelect from './ProviderSelect'
import {
  DEFAULT_SETTINGS,
  loadSettings,
  loadPersona,
  saveSettings,
  savePersona,
  PROVIDER_NAMES,
  type ModelSettings,
  type Provider,
} from '../lib/storage'
import { ChatError, testConnection } from '../lib/api'

type TestState = 'idle' | 'testing' | 'success' | 'error'

export default function Settings() {
  const [initial] = useState(loadSettings)
  const [provider, setProvider] = useState<Provider>(initial.provider)
  const [apiKey, setApiKey] = useState(initial.providers[initial.provider].apiKey)
  const [baseUrl, setBaseUrl] = useState(initial.providers[initial.provider].baseUrl)
  const [model, setModel] = useState(initial.providers[initial.provider].model)
  const [saved, setSaved] = useState(false)
  const [testState, setTestState] = useState<TestState>('idle')
  const [testMsg, setTestMsg] = useState('')
  const [persona, setPersona] = useState(() => loadPersona())

  const handleProviderChange = (p: Provider) => {
    setProvider(p)
    // 调出该服务商自己存过的配置；没存过就是空 key + 默认地址/模型
    const cfg = initial.providers[p]
    setApiKey(cfg.apiKey)
    setBaseUrl(cfg.baseUrl || DEFAULT_SETTINGS[p].baseUrl)
    setModel(cfg.model || DEFAULT_SETTINGS[p].model)
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
      <p className="page-desc">Key 只存你浏览器本地，不经过任何服务器。请放心填写。</p>

      <ProviderSelect value={provider} onChange={handleProviderChange} />

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
        <p className="hint">切换服务商时互不影响，各存各的 Key</p>
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
      </div>

      <div className="field">
        <label htmlFor="persona">专属人设（可选）</label>
        <textarea
          id="persona"
          className="input persona-input"
          rows={5}
          placeholder={'它怎么称呼你？它是什么性格？你们是什么关系？\n有什么只有你们知道的梗？\n\n不填就用默认人设～'}
          value={persona}
          onChange={(e) => setPersona(e.target.value)}
        />
        <p className="hint">填了之后，AI 会严格按你的设定来演；不填就用默认人设</p>
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
