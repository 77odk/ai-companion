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

// 免费两家排前面，其余服务商收进「更多服务商」（DeepSeek/OpenAI 等以后开放付费档再用）
const GROUPS: { label: string; options: Option[] }[] = [
  {
    label: '免费',
    options: [
      { value: 'zhipu', label: '智谱 GLM（免费·推荐）' },
      { value: 'volcengine', label: '火山豆包（免费）' },
    ],
  },
  {
    label: '更多服务商',
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
      ) : value === 'volcengine' ? (
        <p className="hint">
          免费 · 每天 200 万 token 额度（次日返还），实名开通即可用。默认模型 doubao-seed-character · 地址{' '}
          {DEFAULT_SETTINGS.volcengine.baseUrl}
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
