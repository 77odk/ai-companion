// 账号与同步（「我的」页入口）：账号 + 密码登录/注册 + 云端同步
// 登录标识三选一：手机号 / 邮箱 / 用户名，交给后端识别，前端只做轻量即时提示（见 LoginForm）。
// 登录表单与登录墙 LoginGate 共用一套（LoginForm.tsx）。
// 登录状态不影响聊天：未登录照常用本地，登录只是多一层同步。

import { useEffect, useState } from 'react'
import { getAccount, syncNow, bindIdentity, getIdentities, verifySend, verifyConfirm, getAccountStatus, type Account, type Identity } from '../lib/sync'
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
  const [identities, setIdentities] = useState<Identity[]>([])
  const [bindType, setBindType] = useState<'email' | 'phone'>('email')
  const [bindValue, setBindValue] = useState('')
  const [bindCode, setBindCode] = useState('')
  const [binding, setBinding] = useState(false)
  const [verified, setVerified] = useState<boolean | null>(null)
  const [verifyEmail, setVerifyEmail] = useState<string | null>(null)
  const [verifyCode, setVerifyCode] = useState('')
  const [sendingVerify, setSendingVerify] = useState(false)
  const [confirmingVerify, setConfirmingVerify] = useState(false)

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

  useEffect(() => {
    if (!account) return
    let alive = true
    getIdentities()
      .then((list) => { if (alive) setIdentities(list) })
      .catch(() => {})
    getAccountStatus()
      .then((st) => {
        if (!alive) return
        setVerified(st.verified)
        setVerifyEmail(st.email)
      })
      .catch(() => {})
    return () => { alive = false }
  }, [account])

  const handleBind = async () => {
    if (binding) return
    const v = bindValue.trim()
    if (!v) {
      setError('填一下要绑定的邮箱或手机号')
      return
    }
    if (bindType === 'email' && !bindCode.trim()) {
      setError('绑定邮箱要先收验证码：点「发验证码」收邮件')
      return
    }
    setBinding(true)
    setError(null)
    setInfo(null)
    try {
      await bindIdentity(bindType, v, bindCode.trim())
      const list = await getIdentities()
      setIdentities(list)
      setBindValue('')
      setBindCode('')
      setInfo(bindType === 'email' ? '邮箱已绑定' : '手机号已绑定')
    } catch (err) {
      setError(err instanceof Error ? err.message : '绑定失败，请稍后重试')
    } finally {
      setBinding(false)
    }
  }

  const handleSendVerify = async () => {
    if (sendingVerify) return
    if (!verifyEmail && !account) return
    // 用登录账号发补验证码（发到账号绑定的邮箱）
    setSendingVerify(true)
    setError(null)
    setInfo(null)
    try {
      const sentTo = await verifySend(account!.account, 'verify')
      setInfo(`验证码已发到 ${sentTo}，5 分钟内有效`)
    } catch (err) {
      setError(err instanceof Error ? err.message : '发送失败，请稍后再试')
    } finally {
      setSendingVerify(false)
    }
  }

  const handleConfirmVerify = async () => {
    if (confirmingVerify) return
    if (!verifyCode.trim()) {
      setError('填一下邮件里的验证码')
      return
    }
    setConfirmingVerify(true)
    setError(null)
    setInfo(null)
    try {
      await verifyConfirm(account!.account, verifyCode.trim())
      setVerified(true)
      setVerifyCode('')
      setInfo('邮箱验证成功')
    } catch (err) {
      setError(err instanceof Error ? err.message : '验证失败，请稍后重试')
    } finally {
      setConfirmingVerify(false)
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

          <div className="field">
            <label>已绑定的账号</label>
            <div className="identities-list">
              {identities.length === 0 ? (
                <p className="account-format-hint">加载中…</p>
              ) : (
                identities.map((id) => (
                  <span key={id.type + id.value} className="identity-chip">
                    {id.type === 'email' ? '邮箱' : id.type === 'phone' ? '手机号' : '用户名'} · {id.value}
                  </span>
                ))
              )}
            </div>
          </div>

          <div className="field">
            <label>邮箱验证</label>
            {verified === null ? (
              <p className="account-format-hint">检查中…</p>
            ) : verified ? (
              <p className="account-format-hint">✓ 邮箱已验证{verifyEmail ? `（${verifyEmail}）` : ''}</p>
            ) : (
              <div className="verify-row">
                <input
                  className="input"
                  type="text"
                  inputMode="numeric"
                  maxLength={6}
                  placeholder="收邮件填 6 位验证码"
                  value={verifyCode}
                  onChange={(e) => setVerifyCode(e.target.value.replace(/\D/g, ''))}
                />
                <button type="button" className="btn btn-ghost" onClick={handleSendVerify} disabled={sendingVerify}>
                  {sendingVerify ? '发送中…' : '发验证码'}
                </button>
                <button type="button" className="btn btn-primary" onClick={handleConfirmVerify} disabled={confirmingVerify}>
                  {confirmingVerify ? '验证中…' : '确认'}
                </button>
              </div>
            )}
            {verified === false && <p className="account-format-hint">验证一下邮箱，账号更安全，也证明是你本人。</p>}
          </div>

          <div className="field">
            <label>再绑一个（换绑/多方式登录）</label>
            <div className="bind-row">
              <select
                className="input bind-select"
                value={bindType}
                onChange={(e) => setBindType(e.target.value as 'email' | 'phone')}
                aria-label="绑定类型"
              >
                <option value="email">邮箱</option>
                <option value="phone">手机号</option>
              </select>
              <input
                className="input"
                type={bindType === 'email' ? 'text' : 'tel'}
                placeholder={bindType === 'email' ? '邮箱地址' : '手机号'}
                value={bindValue}
                onChange={(e) =>
                  setBindValue(bindType === 'phone' ? e.target.value.replace(/\D/g, '').slice(0, 11) : e.target.value)
                }
              />
              {bindType === 'email' && (
                <button
                  type="button"
                  className="btn btn-ghost"
                  disabled={sendingVerify}
                  onClick={async () => {
                    if (!bindValue.trim()) { setError('先填要绑定的邮箱'); return }
                    setSendingVerify(true); setError(null); setInfo(null)
                    try {
                      const sentTo = await verifySend(bindValue.trim(), 'register')
                      setInfo(`验证码已发到 ${sentTo}，5 分钟内有效`)
                    } catch (err) {
                      setError(err instanceof Error ? err.message : '发送失败，请稍后再试')
                    } finally { setSendingVerify(false) }
                  }}
                >
                  {sendingVerify ? '发送中…' : '发验证码'}
                </button>
              )}
              <button type="button" className="btn btn-ghost" onClick={handleBind} disabled={binding}>
                {binding ? '绑定中…' : '绑定'}
              </button>
            </div>
            {bindType === 'email' && (
              <input
                className="input"
                type="text"
                inputMode="numeric"
                maxLength={6}
                placeholder="填绑定邮箱收到的验证码"
                value={bindCode}
                onChange={(e) => setBindCode(e.target.value.replace(/\D/g, ''))}
                style={{ marginTop: 8 }}
              />
            )}
            <p className="account-format-hint">绑定后也能用这个方式登录，忘了密码还能收验证码找回。绑邮箱要先收验证码。</p>
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
