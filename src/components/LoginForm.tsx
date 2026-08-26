// 登录/注册/找回密码表单（邮箱 + 密码；手机号/用户名 2026-08-26 已下线）
// 从 Account.tsx 抽出复用：登录墙 LoginGate 和「账号与同步」页共用同一套表单。
// 找回密码=邮箱验证码重置。

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
  // 只支持邮箱（2026-08-26 手机号/用户名已下线）
  return '现在只支持邮箱登录，填一下邮箱地址'
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
          : await register(acctValue, password, bindEmail, bindPhone, code)
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
    // 注册视图发到账号本身（现在只支持邮箱注册）；忘记密码发到填的邮箱
    const target = accountInput.trim()
    if (!target) {
      setError('先填邮箱')
      return
    }
    setSending(true)
    setError(null)
    setInfo(null)
    try {
      const purpose = view === 'register' ? 'register' : 'reset'
      const sentTo = await verifySend(target, purpose)
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
            placeholder="邮箱"
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
      {/* 登录/注册 tab（2026-08-26 七七拍板：清晰分开，别让人把登录页误认成注册页） */}
      <div className="account-tabs" role="tablist" aria-label="登录或注册">
          <button
            type="button"
            role="tab"
            aria-selected={view === 'login'}
            className={`account-tab${view === 'login' ? ' on' : ''}`}
            onClick={() => switchView('login')}
          >
            登录
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={view === 'register'}
            className={`account-tab${view === 'register' ? ' on' : ''}`}
            onClick={() => switchView('register')}
          >
            注册
          </button>
        </div>

      <div className="field">
        <label htmlFor="account-email">账号</label>
        <input
          id="account-email"
          className="input"
          type="text"
          placeholder="邮箱"
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

      {view === 'register' && (
        <div className="field">
          <label htmlFor="reg-code">邮箱验证码</label>
          <div className="forgot-code-row">
            <input
              id="reg-code"
              className="input"
              type="text"
              inputMode="numeric"
              maxLength={6}
              placeholder="先点右侧发验证码，收邮件填 6 位数字"
              value={code}
              onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))}
            />
            <button type="button" className="btn btn-ghost" onClick={handleSendCode} disabled={sending}>
              {sending ? '发送中…' : '发验证码'}
            </button>
          </div>
          <p className="account-format-hint">验证码发到填的邮箱，收到才能注册成功</p>
        </div>
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

      {error && <p className="test-result error">{error}</p>}
      {info && <p className="test-result success">{info}</p>}
    </>
  )
}
