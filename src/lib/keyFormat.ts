// key 格式检测：帮用户发现「服务商选错了」。
// 纯函数，Settings.tsx 的 key 输入 onChange 和「测试连接」时调用；可 Node 单测。
// 规则：智谱 key 是「数字.数字」格式（不带 sk-）；DeepSeek 以 sk- 开头；OpenAI/custom 不检测。
// 返回 null = 检测通过 / 空 key / 该服务商不检测；返回文案 = 提示内容。

import type { Provider } from './storage'

export function keyFormatHint(provider: Provider, apiKey: string | null): string | null {
  const key = (apiKey ?? '').trim()
  if (!key) return null

  if (provider === 'zhipu') {
    if (key.startsWith('sk-') || key.startsWith('ark-')) {
      return '这个 key 看着像别的平台的，智谱的 key 是数字开头的，是不是服务商选错了？'
    }
    return null
  }

  if (provider === 'deepseek') {
    if (!key.startsWith('sk-')) {
      return 'DeepSeek 的 key 一般以 sk- 开头，确认没选错服务商？'
    }
    return null
  }

  if (provider === 'volcengine') {
    if (!key.startsWith('ark-')) {
      return '火山豆包的 key 以 ark- 开头（在火山方舟控制台 API Key 管理里创建），确认没选错服务商？'
    }
    return null
  }

  return null
}
