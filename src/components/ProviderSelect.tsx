import type { Provider } from '../lib/storage'
import { DEFAULT_SETTINGS } from '../lib/storage'

interface Props {
  value: Provider
  onChange: (provider: Provider) => void
}

const OPTIONS: { value: Provider; label: string }[] = [
  { value: 'deepseek', label: 'DeepSeek' },
  { value: 'zhipu', label: '智谱 GLM' },
  { value: 'custom', label: '自定义（OpenAI 兼容）' },
  { value: 'openai', label: 'OpenAI（需代理/中转）' },
]

export default function ProviderSelect({ value, onChange }: Props) {
  return (
    <div className="field">
      <label htmlFor="provider">服务商</label>
      <select
        id="provider"
        className="input"
        value={value}
        onChange={(e) => onChange(e.target.value as Provider)}
      >
        {OPTIONS.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
      {value !== 'custom' && (
        <p className="hint">
          默认模型 {DEFAULT_SETTINGS[value].model} · 地址 {DEFAULT_SETTINGS[value].baseUrl}
          {value === 'openai' && ' · 官方地址国内直连不稳，连不上请用中转站地址（高级设置里改）'}
        </p>
      )}
    </div>
  )
}
