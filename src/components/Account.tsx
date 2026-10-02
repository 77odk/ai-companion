// 账号与同步（「我的」页入口）：账号 + 密码登录/注册 + 云端同步
// 登录标识三选一：手机号 / 邮箱 / 用户名，交给后端识别，前端只做轻量即时提示（见 LoginForm）。
// 登录表单与登录墙 LoginGate 共用一套（LoginForm.tsx）。
// 登录状态不影响聊天：未登录照常用本地，登录只是多一层同步。

import { useEffect, useState, type ReactNode } from 'react'
import { getAccount, syncNow, bindIdentity, getIdentities, verifySend, verifyConfirm, getAccountStatus, type Account, type Identity } from '../lib/sync'
import { getToken, logout } from '../lib/auth'
import LoginForm from './LoginForm'
import { hasLocalLegacyData, nextMigrationTitle, runLocalMigration, setLocalMigratedFlag } from '../lib/migrateLocal'
import { listSessions } from '../lib/sessionApi'
import { setActiveSessionId, setSessionsCache } from '../lib/sessionStore'
import { deleteMyAccount, exportMyData, clearLocalCompanionData, DELETE_CONFIRM_WORD } from '../lib/accountData'

export default function AccountPage({ onBack }: { onBack: () => void }) {
  const [account, setAccount] = useState<Account | null>(() => getAccount())
  const [panel, setPanel] = useState<'main' | 'login-methods'>('main')
  const [syncing, setSyncing] = useState(false)
  const [importing, setImporting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [info, setInfo] = useState<string | null>(null)
  const [exporting, setExporting] = useState(false)
  const [deleteOpen, setDeleteOpen] = useState(false)
  const [deleteWord, setDeleteWord] = useState('')
  const [deleting, setDeleting] = useState(false)
  const [identities, setIdentities] = useState<Identity[]>([])
  const [bindValue, setBindValue] = useState('')
  const [bindCode, setBindCode] = useState('')
  const [binding, setBinding] = useState(false)
  const [verified, setVerified] = useState<boolean | null>(null)
  const [verifyEmail, setVerifyEmail] = useState<string | null>(null)
  const [verifyCode, setVerifyCode] = useState('')
  const [sendingVerify, setSendingVerify] = useState(false)
  const [confirmingVerify, setConfirmingVerify] = useState(false)
  const [bindOpen, setBindOpen] = useState(false)

  const clearNotice = () => { setError(null); setInfo(null) }

  const handleImportLegacy = async () => {
    if (importing) return
    clearNotice()
    if (!hasLocalLegacyData()) { setInfo('没有找到本机旧记录'); return }
    const token = getToken()
    if (!token) return
    setImporting(true)
    try {
      let existingTitles: string[] = []
      const list = await listSessions(token)
      if (list.ok) existingTitles = list.data.sessions.map((s) => s.title)
      const result = await runLocalMigration(token, nextMigrationTitle(existingTitles))
      if (!result.ok) { setError(result.message); return }
      setActiveSessionId(String(result.sessionId))
      setLocalMigratedFlag()
      setInfo('旧记录已带过来')
      const refreshed = await listSessions(token)
      if (refreshed.ok) setSessionsCache(refreshed.data.sessions)
    } catch (err) {
      setError(err instanceof Error ? err.message : '导入失败，请稍后重试')
    } finally { setImporting(false) }
  }

  const handleSync = async () => {
    if (syncing) return
    setSyncing(true); clearNotice()
    try { await syncNow(); setInfo('同步完成') }
    catch (err) { setError(err instanceof Error ? err.message : '同步失败，请稍后重试') }
    finally { setSyncing(false) }
  }

  useEffect(() => {
    if (!account) return
    let alive = true
    getIdentities().then((list) => { if (alive) setIdentities(list) }).catch(() => {})
    getAccountStatus().then((st) => {
      if (!alive) return
      setVerified(st.verified); setVerifyEmail(st.email)
    }).catch(() => {})
    return () => { alive = false }
  }, [account])

  const handleBind = async () => {
    if (binding) return
    if (!bindValue.trim()) { setError('填一下要绑定的邮箱'); return }
    if (!bindCode.trim()) { setError('先收验证码，再填验证码'); return }
    setBinding(true); clearNotice()
    try {
      await bindIdentity('email', bindValue.trim(), bindCode.trim())
      setIdentities(await getIdentities())
      setBindValue(''); setBindCode(''); setBindOpen(false); setInfo('邮箱已绑定')
    } catch (err) { setError(err instanceof Error ? err.message : '绑定失败，请稍后重试') }
    finally { setBinding(false) }
  }

  const handleSendVerify = async () => {
    if (sendingVerify || !account) return
    setSendingVerify(true); clearNotice()
    try { setInfo(`验证码已发到 ${await verifySend(account.account, 'verify')}，5 分钟内有效`) }
    catch (err) { setError(err instanceof Error ? err.message : '发送失败，请稍后再试') }
    finally { setSendingVerify(false) }
  }

  const handleSendBindCode = async () => {
    if (sendingVerify) return
    if (!bindValue.trim()) { setError('先填要绑定的邮箱'); return }
    setSendingVerify(true); clearNotice()
    try { setInfo(`验证码已发到 ${await verifySend(bindValue.trim(), 'register')}，5 分钟内有效`) }
    catch (err) { setError(err instanceof Error ? err.message : '发送失败，请稍后再试') }
    finally { setSendingVerify(false) }
  }

  const handleConfirmVerify = async () => {
    if (confirmingVerify) return
    if (!verifyCode.trim()) { setError('填一下邮件里的验证码'); return }
    setConfirmingVerify(true); clearNotice()
    try {
      await verifyConfirm(account!.account, verifyCode.trim())
      setVerified(true); setVerifyCode(''); setInfo('邮箱验证成功')
    } catch (err) { setError(err instanceof Error ? err.message : '验证失败，请稍后重试') }
    finally { setConfirmingVerify(false) }
  }

  const handleExport = async () => {
    clearNotice(); setExporting(true)
    try { await exportMyData(); setInfo('已经导出，去浏览器下载里看看') }
    catch (err) { setError(err instanceof Error ? err.message : '导出失败了') }
    finally { setExporting(false) }
  }

  const handleConfirmDelete = async () => {
    setError(null); setDeleting(true)
    try {
      await deleteMyAccount(deleteWord.trim())
      clearLocalCompanionData(); logout(); setAccount(null)
      setDeleteOpen(false); setDeleteWord(''); setInfo('账号已经注销，本机缓存也清掉了')
    } catch (err) { setError(err instanceof Error ? err.message : '注销失败了') }
    finally { setDeleting(false) }
  }

  const handleLogout = () => {
    logout(); setAccount(null); setPanel('main'); clearNotice()
  }

  if (!account) {
    return (
      <div className="page settings-page account-page">
        <DetailHeader title="账号与同步" onBack={onBack} />
        <div className="settings-card account-login-card">
          <LoginForm onSuccess={(acct) => setAccount(acct)} />
        </div>
      </div>
    )
  }

  if (panel === 'login-methods') {
    return (
      <div className="page settings-page account-page">
        <DetailHeader title="登录方式" onBack={() => { setPanel('main'); clearNotice() }} />
        <section className="account-section">
          <p className="account-section-title">已绑定</p>
          <div className="account-list-card">
            {identities.length === 0 ? (
              <div className="account-list-row account-list-row-static"><span className="account-list-main">正在读取…</span></div>
            ) : identities.map((identity) => (
              <div className="account-list-row account-list-row-static" key={identity.type + identity.value}>
                <span className="account-list-main">{identity.type === 'email' ? '邮箱' : identity.type === 'phone' ? '手机号' : '用户名'}</span>
                <span className="account-list-value">{identity.value}</span>
              </div>
            ))}
          </div>
        </section>

        <section className="account-section">
          <p className="account-section-title">邮箱验证</p>
          <div className="account-list-card">
            {verified === null ? (
              <div className="account-list-row account-list-row-static"><span className="account-list-main">正在检查…</span></div>
            ) : verified ? (
              <div className="account-list-row account-list-row-static">
                <span className="account-list-main">已验证</span><span className="account-list-value">{verifyEmail || '邮箱'}</span>
              </div>
            ) : (
              <div className="account-inline-form">
                <p>验证当前邮箱，账号会更安全。</p>
                <div className="account-code-row">
                  <input className="input" type="text" inputMode="numeric" maxLength={6} placeholder="6 位验证码" value={verifyCode} onChange={(e) => setVerifyCode(e.target.value.replace(/\D/g, ''))} />
                  <button type="button" className="btn btn-ghost" onClick={handleSendVerify} disabled={sendingVerify}>{sendingVerify ? '发送中…' : '发验证码'}</button>
                  <button type="button" className="btn btn-primary" onClick={handleConfirmVerify} disabled={confirmingVerify}>{confirmingVerify ? '验证中…' : '确认'}</button>
                </div>
              </div>
            )}
          </div>
        </section>

        <section className="account-section">
          <p className="account-section-title">其他登录方式</p>
          <div className="account-list-card">
            {!bindOpen ? (
              <button type="button" className="account-list-row" onClick={() => { setBindOpen(true); clearNotice() }}>
                <span className="account-list-main">绑定另一个邮箱</span><Chevron />
              </button>
            ) : (
              <div className="account-inline-form">
                <input className="input" type="email" placeholder="邮箱地址" value={bindValue} onChange={(e) => setBindValue(e.target.value)} autoComplete="email" />
                <div className="account-code-row">
                  <input className="input" type="text" inputMode="numeric" maxLength={6} placeholder="验证码" value={bindCode} onChange={(e) => setBindCode(e.target.value.replace(/\D/g, ''))} />
                  <button type="button" className="btn btn-ghost" disabled={sendingVerify} onClick={handleSendBindCode}>{sendingVerify ? '发送中…' : '发验证码'}</button>
                  <button type="button" className="btn btn-primary" onClick={handleBind} disabled={binding}>{binding ? '绑定中…' : '绑定'}</button>
                </div>
                <button type="button" className="account-inline-cancel" onClick={() => { setBindOpen(false); setBindValue(''); setBindCode(''); clearNotice() }}>取消</button>
              </div>
            )}
          </div>
        </section>
        <AccountNotice info={info} error={error} />
      </div>
    )
  }

  return (
    <div className="page settings-page account-page">
      <DetailHeader title="账号与同步" onBack={onBack} />
      <section className="account-overview" aria-label="账号概览">
        <div className="account-overview-avatar" aria-hidden="true">{account.account.trim().slice(0, 1).toUpperCase() || 'Y'}</div>
        <strong>{account.account}</strong>
        <span className="account-sync-state"><span aria-hidden="true" />云端同步正常</span>
        <p>聊天、记忆和 TA 的资料会自动同步</p>
      </section>

      <AccountGroup title="账号">
        <div className="account-list-row account-list-row-static"><span className="account-list-main">当前登录</span><span className="account-list-value">{account.account}</span></div>
        <button type="button" className="account-list-row" onClick={() => { setPanel('login-methods'); clearNotice() }}>
          <span className="account-list-main">登录方式</span>
          <span className="account-list-trailing">{verified === true ? '邮箱已验证' : verified === false ? '待验证' : ''}<Chevron /></span>
        </button>
      </AccountGroup>

      <AccountGroup title="同步">
        <div className="account-list-row account-list-row-static account-sync-row">
          <span><span className="account-list-main">云端同步</span><small>换设备登录同一账号，也能继续使用</small></span>
          <span className="account-status-pill">已开启</span>
        </div>
        <button type="button" className="account-list-row" onClick={() => void handleSync()} disabled={syncing}>
          <span className="account-list-main">{syncing ? '正在同步…' : '立即同步'}</span><Chevron />
        </button>
      </AccountGroup>

      <AccountGroup title="我的内容">
        <button type="button" className="account-list-row" onClick={() => void handleExport()} disabled={exporting}>
          <span className="account-list-main">{exporting ? '正在导出…' : '导出我的内容'}</span><Chevron />
        </button>
        <button type="button" className="account-list-row" onClick={() => void handleImportLegacy()} disabled={importing}>
          <span className="account-list-main">{importing ? '正在带过来…' : '带回本机旧记录'}</span><Chevron />
        </button>
      </AccountGroup>

      <AccountGroup title="账号操作">
        <button type="button" className="account-list-row account-logout-row" onClick={handleLogout}><span className="account-list-main">退出登录</span></button>
      </AccountGroup>

      <button type="button" className="account-delete-entry" onClick={() => { setDeleteOpen(true); clearNotice() }}>注销账号</button>

      {deleteOpen && (
        <div className="account-delete-panel">
          <strong>确认注销账号？</strong>
          <p>注销会永久删掉账号、聊天记录、记忆和 TA 的资料，删了找不回来。想留一份就先导出。</p>
          <p>确认的话，在下面输入「{DELETE_CONFIRM_WORD}」：</p>
          <input className="input" value={deleteWord} onChange={(e) => setDeleteWord(e.target.value)} placeholder={DELETE_CONFIRM_WORD} aria-label="注销确认词" />
          <div className="account-delete-actions">
            <button type="button" className="btn btn-ghost" onClick={() => { setDeleteOpen(false); setDeleteWord('') }}>再想想</button>
            <button type="button" className="btn account-delete-confirm" disabled={deleting || deleteWord.trim() !== DELETE_CONFIRM_WORD} onClick={handleConfirmDelete}>
              {deleting ? '正在注销…' : '确认注销'}
            </button>
          </div>
        </div>
      )}
      <AccountNotice info={info} error={error} />
    </div>
  )
}

function AccountGroup({ title, children }: { title: string; children: ReactNode }) {
  return <section className="account-section"><p className="account-section-title">{title}</p><div className="account-list-card">{children}</div></section>
}

function AccountNotice({ info, error }: { info: string | null; error: string | null }) {
  if (info) return <p className="test-result success account-notice">{info}</p>
  if (error) return <p className="test-result error account-notice">{error}</p>
  return null
}

function Chevron() {
  return <svg className="account-chevron" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M9 6l6 6-6 6" /></svg>
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
