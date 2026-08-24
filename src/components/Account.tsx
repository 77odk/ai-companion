// 账号与同步（「我的」页入口）：账号 + 密码登录/注册 + 云端同步
// 登录标识三选一：手机号 / 邮箱 / 用户名，交给后端识别，前端只做轻量即时提示（见 LoginForm）。
// 登录表单与登录墙 LoginGate 共用一套（LoginForm.tsx）。
// 登录状态不影响聊天：未登录照常用本地，登录只是多一层同步。

import { useState } from 'react'
import { getAccount, syncNow, type Account } from '../lib/sync'
import { logout } from '../lib/auth'
import LoginForm from './LoginForm'

export default function AccountPage({ onBack }: { onBack: () => void }) {
  const [account, setAccount] = useState<Account | null>(() => getAccount())
  const [syncing, setSyncing] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [info, setInfo] = useState<string | null>(null)

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
    logout()
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
            <label>当前登录</label>
            <p className="account-email">{account.account}</p>
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
          <LoginForm onSuccess={(acct) => setAccount(acct)} />
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
