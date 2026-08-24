// 登录/注册/找回密码表单（账号三选一：手机号 / 邮箱 / 用户名 + 密码）
// 从 Account.tsx 抽出复用：登录墙 LoginGate 和「账号与同步」页共用同一套表单。
// B2e：登录模式带「忘记密码？」；注册用户名必须绑邮箱/手机号（找回密码通道）；忘记密码=邮箱验证码重置。

import { useState } from 'react'
import { login, register, syncNow, verifySend, resetPassword, type Account } from '../lib/sync'

type View = 'login' | 'register' | 'forgot'

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

function isUsernameLike(value: string): boolean {
  const s = value.trim()
  if (!s || s.includes('@')) return false
  if (/^1[3-9]\d{9}$/.test(s)) return false
  return true
}

interface Props {
  /** 登录/注册成功后回调（登录墙据此回跳目标页；账号页据此刷新已登录态） */
  onSuccess?: (acct: Account) => void
}

export default function LoginForm({ onSuccess }: Props) {
  const [view, setView] = useState<View>('login')
  const [accountInput, setAccountInput] = useState('')
  const [password, setPassword] = useState('')
  const [bindEmail, setBindEmail] = useState('')
  const [bindPhone, setBindPhone] = useState('')
  const [code, setCode] = useState('')
  const [newPassword, setNewPassword] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [sending, setSending] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [info, setInfo] = useState<string | null>(null)

  const switchView = (v: View) => {
    setView(v)
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
      const acct =
        view === 'login'
          ? await login(acctValue, password)
          : await register(acctValue, password, bindEmail, bindPhone)
      setAccountInput('')
      setPassword('')
      setBindEmail('')
      setBindPhone('')
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

  const handleSendCode = async () => {
    if (sending) return
    if (!accountInput.trim()) {
      setError('先填账号')
      return
    }
    setSending(true)
    setError(null)
    setInfo(null)
    try {
      const sentTo = await verifySend(accountInput)
      setInfo(`验证码已发到 ${sentTo}，5 分钟内有效`)
    } catch (err) {
      setError(err instanceof Error ? err.message : '发送失败，请稍后再试')
    } finally {
      setSending(false)
    }
  }

  const handleReset = async () => {
    if (submitting) return
    if (!accountInput.trim() || !code.trim() || !newPassword) {
      setError('账号、验证码、新密码都要填')
      return
    }
    if (newPassword.length < 6) {
      setError('密码至少 6 位')
      return
    }
    setSubmitting(true)
    setError(null)
    setInfo(null)
    try {
      await resetPassword(accountInput, code, newPassword)
      setAccountInput('')
      setCode('')
      setNewPassword('')
      switchView('login')
      setInfo('密码已重置，用新密码登录吧')
    } catch (err) {
      setError(err instanceof Error ? err.message : '重置失败，请稍后再试')
    } finally {
      setSubmitting(false)
    }
  }

  const hint = accountHint(accountInput)
  const needBind = view === 'register' && isUsernameLike(accountInput)

  if (view === 'forgot') {
    return (
      <>
        <p className="account-mode-label">找回密码</p>
        <div className="field">
          <label htmlFor="forgot-account">账号</label>
          <input
            id="forgot-account"
            className="input"
            type="text"
            placeholder="手机号 / 邮箱 / 用户名"
            value={accountInput}
            onChange={(e) => setAccountInput(e.target.value)}
            autoComplete="username"
          />
        </div>
        <div className="field">
          <label htmlFor="forgot-code">验证码</label>
          <div className="forgot-code-row">
            <input
              id="forgot-code"
              className="input"
              type="text"
              inputMode="numeric"
              maxLength={6}
              placeholder="邮箱里的 6 位数字"
              value={code}
              onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))}
            />
            <button type="button" className="btn btn-ghost" onClick={handleSendCode} disabled={sending}>
              {sending ? '发送中…' : '发验证码'}
            </button>
          </div>
        </div>
        <div className="field">
          <label htmlFor="forgot-new-password">新密码</label>
          <input
            id="forgot-new-password"
            className="input"
            type="password"
            placeholder="至少 6 位"
            value={newPassword}
            onChange={(e) => setNewPassword(e.target.value)}
            autoComplete="new-password"
          />
        </div>
        <div className="settings-actions">
          <button type="button" className="btn btn-primary" onClick={handleReset} disabled={submitting}>
            {submitting ? '稍等…' : '重置密码'}
          </button>
        </div>
        <button type="button" className="account-toggle" onClick={() => switchView('login')}>
          想起来了，返回登录
        </button>
        {error && <p className="test-result error">{error}</p>}
        {info && <p className="test-result success">{info}</p>}
      </>
    )
  }

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
          autoComplete={view === 'login' ? 'current-password' : 'new-password'}
        />
      </div>

      {needBind && (
        <>
          <p className="account-mode-label">用户名注册需要绑一个联系方式，以后忘了密码能找回来</p>
          <div className="field">
            <label htmlFor="bind-email">绑定邮箱（推荐）</label>
            <input
              id="bind-email"
              className="input"
              type="text"
              placeholder="用来收验证码的邮箱"
              value={bindEmail}
              onChange={(e) => setBindEmail(e.target.value)}
              autoComplete="email"
            />
          </div>
          <div className="field">
            <label htmlFor="bind-phone">或者绑定手机号</label>
            <input
              id="bind-phone"
              className="input"
              type="tel"
              placeholder="手机号"
              value={bindPhone}
              onChange={(e) => setBindPhone(e.target.value.replace(/\D/g, '').slice(0, 11))}
              autoComplete="tel"
            />
          </div>
        </>
      )}

      <div className="settings-actions">
        <button type="button" className="btn btn-primary" onClick={handleAuth} disabled={submitting}>
          {submitting ? '稍等…' : view === 'login' ? '登录' : '注册'}
        </button>
      </div>

      {view === 'login' && (
        <button type="button" className="account-toggle" onClick={() => switchView('forgot')}>
          忘记密码？
        </button>
      )}

      <button
        type="button"
        className="account-toggle"
        onClick={() => switchView(view === 'login' ? 'register' : 'login')}
      >
        {view === 'login' ? '没有账号？注册' : '已有账号？去登录'}
      </button>

      {error && <p className="test-result error">{error}</p>}
      {info && <p className="test-result success">{info}</p>}
    </>
  )
}
