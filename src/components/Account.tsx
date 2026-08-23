// 账号与同步（「我的」页入口）：邮箱 + 密码登录/注册 + 云端同步
// 登录状态不影响聊天：未登录照常用本地，登录只是多一层同步。
// 错误红字直接展示后端 error 文案（邮箱格式不对 / 密码至少 6 位 / 这个邮箱已经注册过了 / 邮箱或密码不对 / 登录已失效…）。

import { useState } from 'react'
import { getAccount, login, register, syncNow, clearAccount, type Account } from '../lib/sync'

type FormMode = 'login' | 'register'

export default function AccountPage({ onBack }: { onBack: () => void }) {
  const [account, setAccount] = useState<Account | null>(() => getAccount())
  const [mode, setMode] = useState<FormMode>('login')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [syncing, setSyncing] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [info, setInfo] = useState<string | null>(null)

  const switchMode = (m: FormMode) => {
    setMode(m)
    setError(null)
    setInfo(null)
  }

  const handleAuth = async () => {
    if (submitting) return
    const e = email.trim()
    if (!e || !password) {
      setError('请输入邮箱和密码')
      return
    }
    setSubmitting(true)
    setError(null)
    setInfo(null)
    try {
      const acct = mode === 'login' ? await login(e, password) : await register(e, password)
      setAccount(acct)
      setEmail('')
      setPassword('')
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

  const handleSync = async () => {
    if (syncing) return
    setSyncing(true)
    setError(null)
    setInfo(null)
    try {
      await syncNow()
      setInfo('同步完成')
    } catch (err) {
      setError(err instanceof Error ? err.message : '同步失败，请稍后重试')
    } finally {
      setSyncing(false)
    }
  }

  const handleLogout = () => {
    clearAccount()
    setAccount(null)
    setError(null)
    setInfo(null)
  }

  return (
    <div className="page settings-page">
      <DetailHeader title="账号与同步" onBack={onBack} />

      {account ? (
        <div className="settings-card">
          <p className="hint">已登录，本地记录会自动同步到云端，换设备也能找回来。</p>

          <div className="field">
            <label>登录邮箱</label>
            <p className="account-email">{account.email}</p>
          </div>

          <div className="settings-actions">
            <button type="button" className="btn btn-primary" onClick={handleSync} disabled={syncing}>
              {syncing ? '同步中…' : '立即同步'}
            </button>
            <button type="button" className="btn btn-ghost" onClick={handleLogout}>
              退出登录
            </button>
          </div>

          {info && <p className="test-result success">{info}</p>}
          {error && <p className="test-result error">{error}</p>}
        </div>
      ) : (
        <div className="settings-card">
          <div className="field">
            <label htmlFor="account-email">邮箱</label>
            <input
              id="account-email"
              className="input"
              type="email"
              placeholder="you@example.com"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              autoComplete="email"
            />
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
        </div>
      )}
    </div>
  )
}

/* ---------------- 详情页通用：左上角返回（与 Settings 的 DetailHeader 同款画法） ---------------- */

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
