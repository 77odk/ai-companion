// 账号与同步（「我的」页入口）：账号 + 密码登录/注册 + 云端同步
// 登录标识三选一：手机号 / 邮箱 / 用户名，交给后端识别，前端只做轻量即时提示（见 LoginForm）。
// 登录表单与登录墙 LoginGate 共用一套（LoginForm.tsx）。
// 登录状态不影响聊天：未登录照常用本地，登录只是多一层同步。

import { useState } from 'react'
import { getAccount, syncNow, type Account } from '../lib/sync'
import { getToken, logout } from '../lib/auth'
import LoginForm from './LoginForm'
import { hasLocalLegacyData, nextMigrationTitle, runLocalMigration, setLocalMigratedFlag } from '../lib/migrateLocal'
import { listSessions } from '../lib/sessionApi'
import { setActiveSessionId, setSessionsCache } from '../lib/sessionStore'

export default function AccountPage({ onBack }: { onBack: () => void }) {
  const [account, setAccount] = useState<Account | null>(() => getAccount())
  const [syncing, setSyncing] = useState(false)
  const [importing, setImporting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [info, setInfo] = useState<string | null>(null)

  // 手动把本地旧记录（B2c 前的 persona/聊天/记忆）带过来：用户主动触发，不检查云端会话数。
  // 只要本地有旧数据就建一个新会话搬过去；与 B2d 共用 migrateLocal 的逻辑，不重复实现。
  const handleImportLegacy = async () => {
    if (importing) return
    setError(null)
    setInfo(null)
    if (!hasLocalLegacyData()) {
      setInfo('没有找到本地旧记录')
      return
    }
    const token = getToken()
    if (!token) return
    setImporting(true)
    try {
      // 查一下现有会话标题，避免「我们的开始」重名
      let existingTitles: string[] = []
      const list = await listSessions(token)
      if (list.ok) existingTitles = list.data.sessions.map((s) => s.title)
      const title = nextMigrationTitle(existingTitles)
      const result = await runLocalMigration(token, title)
      if (!result.ok) {
        setError(result.message)
        return
      }
      setActiveSessionId(String(result.sessionId))
      setLocalMigratedFlag()
      setInfo('旧记录已带过来')
      // 刷新会话列表缓存，侧边栏/会话列表能直接看到新会话
      const refreshed = await listSessions(token)
      if (refreshed.ok) setSessionsCache(refreshed.data.sessions)
    } catch (err) {
      setError(err instanceof Error ? err.message : '导入失败，请稍后重试')
    } finally {
      setImporting(false)
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

          <button
            type="button"
            className="btn btn-ghost import-legacy-btn"
            onClick={() => void handleImportLegacy()}
            disabled={importing}
          >
            {importing ? '正在带过来…' : '把本地旧记录带过来'}
          </button>

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
