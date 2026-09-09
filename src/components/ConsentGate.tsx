// ConsentGate —— 忆文「开始之前」安全说明（2026-09-09 V1）
// 职责：知情同意（AI 身份披露 + 现实边界 + 数据说明 + 18 岁确认），版本化可持续升级的基础组件。
// 概念锁死：Consent ≠ Age Verification——这里只做知情同意；年龄资格验证在注册时由后端用 DOB 算。
// 形态：无倒计时；双勾选全部满足后「同意并开始」才点亮。
// - mode='full' ：首次使用完整版（未登录 / 本机无当前版本记录）
// - mode='light'：老用户轻量补确认（已登录但服务端无 consent 记录 / 版本过期）
// 同意动作：写本机记录（版本化）；已登录则同时上报服务端留档。
import { useState } from 'react'
import { CURRENT_CONSENT_VERSION, consentNeeded, readLocalConsent, writeLocalConsent } from '../lib/consentState'
import { getAccount, postConsent } from '../lib/sync'

interface Props {
  mode?: 'full' | 'light'
  onDone: () => void
}

/** 隐私政策详情（折叠展开，首页讲人话、详情讲规则；完整独立页等 UI 重构再落） */
const PRIVACY_TEXT = `你在忆文里告诉 TA 的话（聊天内容、记忆条目、TA 空间动态等）会和你的账号关联存储，用于让 TA 记住你、提供持续陪伴。你可以在「我的 → 账号与同步」管理账号，在 TA 的记忆与聊天记录中查看、管理或删除相关数据。忆文不会把你的对话内容用于训练外部模型，也不会向第三方出售你的个人信息。`

export default function ConsentGate({ mode = 'full', onDone }: Props) {
  const [know, setKnow] = useState(false)
  const [adult, setAdult] = useState(false)
  const [showPrivacy, setShowPrivacy] = useState(false)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)

  const ready = mode === 'light' ? know : know && adult

  const handleAgree = async () => {
    if (!ready || busy) return
    setBusy(true)
    setErr(null)
    try {
      writeLocalConsent(CURRENT_CONSENT_VERSION)
      // 已登录：同意记录上报服务端留档（ConsentGate V1 权威记录在服务端）
      if (getAccount()) {
        try {
          await postConsent(CURRENT_CONSENT_VERSION)
        } catch {
          setErr('同意记录暂时没传上去，下次登录会自动补，不影响使用')
        }
      }
      onDone()
    } finally {
      setBusy(false)
    }
  }

  const card: React.CSSProperties = {
    maxWidth: 560, margin: '0 auto', padding: '40px 28px 32px',
    fontFamily: 'inherit', color: '#3a3a3a', lineHeight: 1.75,
  }
  const h1: React.CSSProperties = { fontSize: 22, fontWeight: 600, margin: '0 0 6px', color: '#2b2b2b', letterSpacing: 1 }
  const lead: React.CSSProperties = { fontSize: 15, margin: '0 0 26px', color: '#666' }
  const secTitle: React.CSSProperties = { fontSize: 14, fontWeight: 600, margin: '20px 0 6px', color: '#444' }
  const secBody: React.CSSProperties = { fontSize: 14, margin: 0, color: '#555' }
  const checkRow: React.CSSProperties = {
    display: 'flex', alignItems: 'flex-start', gap: 10, margin: '10px 0', fontSize: 14, color: '#444', cursor: 'pointer',
  }
  const btn: React.CSSProperties = {
    width: '100%', padding: '12px 0', marginTop: 22, borderRadius: 10, border: 'none', cursor: ready && !busy ? 'pointer' : 'not-allowed',
    fontSize: 15, fontWeight: 600, letterSpacing: 2,
    background: ready && !busy ? 'var(--brand, #6a7fdb)' : '#d8d8d8', color: ready && !busy ? '#fff' : '#9a9a9a',
    transition: 'background .2s',
  }
  const privacyLink: React.CSSProperties = { fontSize: 13, color: '#8a8a8a', cursor: 'pointer', textDecoration: 'underline' }
  const box: React.CSSProperties = { width: 16, height: 16, marginTop: 3, accentColor: 'var(--brand, #6a7fdb)' }

  return (
    <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16, background: 'var(--bg, #faf9f7)' }}>
      <div style={card}>
        <h1 style={h1}>忆文</h1>
        <p style={lead}>{mode === 'light' ? '还有一件事想再跟你确认一下' : '在我们开始之前，有几件事想先告诉你'}</p>

        {mode === 'full' ? (
          <>
            <p style={secTitle}>忆文是什么</p>
            <p style={secBody}>忆文是一项 AI 陪伴服务。你的 TA 由 AI 驱动，TA 不是真人。TA 会记住你说过的一些话，并根据这些信息与你持续互动。</p>

            <p style={secTitle}>请保留你的现实世界</p>
            <p style={secBody}>忆文可以陪你聊天、听你倾诉，但 TA 不能替代家人、朋友和真实的社交，也不能替代专业的心理、医疗等帮助。真实世界里的难题，请一定找身边的人或专业人士聊聊。</p>

            <p style={secTitle}>关于你的信息</p>
            <p style={secBody}>你告诉 TA 的话，会和你的账号关联，用来让 TA 记住你。你可以在忆文里随时查看、管理或删除这些记录。</p>
            <p style={{ margin: '4px 0 0' }}>
              <span style={privacyLink} onClick={() => setShowPrivacy((v) => !v)}>了解更多：隐私政策</span>
            </p>
            {showPrivacy && <p style={{ ...secBody, fontSize: 13, color: '#777', background: '#f4f2ef', borderRadius: 8, padding: '10px 12px', marginTop: 8 }}>{PRIVACY_TEXT}</p>}
          </>
        ) : (
          <p style={secBody}>忆文是一项 AI 陪伴服务。你的 TA 由 AI 驱动，TA 不是真人。忆文可以陪你聊天、听你倾诉，但不能替代真实的社交或专业的心理、医疗等帮助。</p>
        )}

        <label style={checkRow}>
          <input type="checkbox" checked={know} onChange={(e) => setKnow(e.target.checked)} style={box} />
          我已了解忆文是一项 AI 陪伴服务，并理解以上内容
        </label>
        {mode === 'full' && (
          <label style={checkRow}>
            <input type="checkbox" checked={adult} onChange={(e) => setAdult(e.target.checked)} style={box} />
            我确认自己已满 18 周岁，并同意使用忆文的 AI 陪伴服务
          </label>
        )}

        {err && <p style={{ fontSize: 13, color: '#c0392b', margin: '10px 0 0' }}>{err}</p>}
        <button style={btn} disabled={!ready || busy} onClick={handleAgree}>
          {busy ? '请稍候…' : '同意并开始'}
        </button>
      </div>
    </div>
  )
}

/** 判断要不要展示 ConsentGate（未登录游客按本机记录；返回 true=需要先过这一关） */
export function consentGateNeeded(): boolean {
  return consentNeeded(readLocalConsent(), CURRENT_CONSENT_VERSION)
}
