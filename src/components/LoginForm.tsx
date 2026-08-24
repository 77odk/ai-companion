// 登录/注册表单（账号三选一：手机号 / 邮箱 / 用户名 + 密码）
// 从 Account.tsx 抽出复用：登录墙 LoginGate 和「账号与同步」页共用同一套表单。
// 错误红字直接展示后端 error 文案（邮箱格式不对 / 手机号格式不对 / 用户名需 2-16 位字符 /
// 密码至少 6 位 / 这个账号已经注册过了 / 账号或密码不对 / 登录已失效…）。

import { useState } from 'react'
import { login, register, syncNow, type Account } from '../lib/sync'

type FormMode = 'login' | 'register'

// 轻量即时提示：明显不对就提示，但不过度校验，最终以后端判定为准（返回 null 表示看着没问题）
function accountHint(value: string): string | null {
  const s = value.trim()
  if (!s) return null
  if (s.includes('@')) {
    return /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(s) ? null : '邮箱格式不太对，检查一下'
  }
  if (/^1[3-9]\d{9}$/.test(s)) return null // 合法手机号
  if (/^\d{11}$/.test(s)) return '手机号格式不对，检查一下位数'
  if (/^\d{10}$/.test(s)) return '手机号好像少了一位？如果不是手机号也能当用户名用'
  if (s.length < 2) return '太短了，用户名至少 2 个字'
  if (s.length > 16) return '太长了，用户名最多 16 个字'
  if (!/^[一-龥A-Za-z0-9_]+$/.test(s)) return '用户名只能用中文、字母、数字和下划线'
  return null
}

interface Props {
  /** 登录/注册成功后回调（登录墙据此回跳目标页；账号页据此刷新已登录态） */
  onSuccess?: (acct: Account) => void
}

export default function LoginForm({ onSuccess }: Props) {
  const [mode, setMode] = useState<FormMode>('login')
  const [accountInput, setAccountInput] = useState('')
  const [password, setPassword] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [info, setInfo] = useState<string | null>(null)

  const switchMode = (m: FormMode) => {
    setMode(m)
    setError(null)
    setInfo(null)
  }

  const handleAuth = async () => {
    if (submitting) return
    const acctValue = accountInput.trim()
    if (!acctValue || !password) {
      setError('请输入账号和密码')
      return
    }
    setSubmitting(true)
    setError(null)
    setInfo(null)
    try {
      const acct = mode === 'login' ? await login(acctValue, password) : await register(acctValue, password)
      setAccountInput('')
      setPassword('')
      // 登录成功：sync.ts 已广播登录状态变化，这里通知父组件回跳目标页
      onSuccess?.(acct)
      // 登录成功自动同步一次；同步失败也保留登录态，只提示原因
      try {
        await syncNow()
        setInfo('记录已同步')
      } catch (err) {
        setError(err instanceof Error ? err.message : '记录同步失败')
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : '操作失败，请稍后重试')
    } finally {
      setSubmitting(false)
    }
  }

  const hint = accountHint(accountInput)

  return (
    <>
      <div className="field">
        <label htmlFor="account-email">账号</label>
        <input
          id="account-email"
          className="input"
          type="text"
          placeholder="手机号 / 邮箱 / 用户名"
          value={accountInput}
          onChange={(e) => setAccountInput(e.target.value)}
          autoComplete="username"
        />
        {hint && <p className="account-format-hint">{hint}</p>}
      </div>

      <div className="field">
        <label htmlFor="account-password">密码</label>
        <input
          id="account-password"
          className="input"
          type="password"
          placeholder="至少 6 位"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          autoComplete={mode === 'login' ? 'current-password' : 'new-password'}
        />
      </div>

      <div className="settings-actions">
        <button type="button" className="btn btn-primary" onClick={handleAuth} disabled={submitting}>
          {submitting ? '稍等…' : mode === 'login' ? '登录' : '注册'}
        </button>
      </div>

      <button
        type="button"
        className="account-toggle"
        onClick={() => switchMode(mode === 'login' ? 'register' : 'login')}
      >
        {mode === 'login' ? '没有账号？注册' : '已有账号？去登录'}
      </button>

      {error && <p className="test-result error">{error}</p>}
      {info && <p className="test-result success">{info}</p>}
    </>
  )
}
