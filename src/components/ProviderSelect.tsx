import type { Provider } from '../lib/storage'
import { DEFAULT_SETTINGS } from '../lib/storage'

interface Props {
  value: Provider
  onChange: (provider: Provider) => void
}

interface Option {
  value: Provider
  label: string
}

// 智谱排第一进「推荐」组，其余服务商收进「其他」（自定义/OpenAI 需填中转地址，普通用户不用动）
const GROUPS: { label: string; options: Option[] }[] = [
  {
    label: '推荐',
    options: [{ value: 'zhipu', label: '智谱 GLM（免费·推荐）' }],
  },
  {
    label: '其他',
    options: [
      { value: 'deepseek', label: 'DeepSeek' },
      { value: 'custom', label: '自定义（OpenAI 兼容）' },
      { value: 'openai', label: 'OpenAI（需代理/中转）' },
    ],
  },
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
        {GROUPS.map((g) => (
          <optgroup key={g.label} label={g.label}>
            {g.options.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </optgroup>
        ))}
      </select>
      {value === 'zhipu' ? (
        <p className="hint">
          免费 · 默认推荐：注册就送免费额度，日常聊天不用花一分钱。默认模型 {DEFAULT_SETTINGS.zhipu.model} · 地址{' '}
          {DEFAULT_SETTINGS.zhipu.baseUrl}
        </p>
      ) : value !== 'custom' ? (
        <p className="hint">
          默认模型 {DEFAULT_SETTINGS[value].model} · 地址 {DEFAULT_SETTINGS[value].baseUrl}
          {value === 'openai' && ' · 官方地址国内直连不稳，连不上请用中转站地址（高级设置里改）'}
        </p>
      ) : null}
    </div>
  )
}
