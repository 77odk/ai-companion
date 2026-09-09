// ConsentGate V1 合规状态（2026-09-09）——纯函数，可单测
// 概念（锁死）：Consent ≠ Age Verification
// - 本机 consent = 知情同意（游客也记，登录后补传云端），仅表示"看过并勾选了当前版本说明"
// - 服务端 age_verified_at = 账号资格验证（注册时后端用 DOB 算），不被游客自述污染
// - consent_version 独立版本化：改版（v1→v2）后版本不匹配 → 重新轻量确认，不重填出生日期
export const CURRENT_CONSENT_VERSION = 'v1'

export interface LocalConsent {
  version: string
  /** ISO 时间戳，本地同意时刻（体验层判断用；权威记录在服务端 consented_at） */
  consentedAt: string
}

const CONSENT_KEY = 'eluvin_consent'

/** 读本机同意记录；没有或损坏返回 null */
export function readLocalConsent(): LocalConsent | null {
  try {
    const raw = localStorage.getItem(CONSENT_KEY)
    if (!raw) return null
    const p = JSON.parse(raw) as Partial<LocalConsent>
    if (p && typeof p.version === 'string' && typeof p.consentedAt === 'string') {
      return { version: p.version, consentedAt: p.consentedAt }
    }
    return null
  } catch {
    return null
  }
}

/** 写本机同意记录（当前版本 + 时刻） */
export function writeLocalConsent(version: string = CURRENT_CONSENT_VERSION, consentedAt?: string): void {
  const rec: LocalConsent = { version, consentedAt: consentedAt || new Date().toISOString() }
  try {
    localStorage.setItem(CONSENT_KEY, JSON.stringify(rec))
  } catch {
    // localStorage 不可用（隐私模式等）：不阻塞使用，服务端留档仍会走
  }
}

/** 是否需要（重新）同意：没有记录，或记录版本 ≠ 当前版本（改版重确认） */
export function consentNeeded(consent: LocalConsent | null, current: string = CURRENT_CONSENT_VERSION): boolean {
  return !consent || consent.version !== current
}

/** 生成当前版本的一次同意记录（供上报/落库用） */
export function makeConsent(version: string = CURRENT_CONSENT_VERSION, consentedAt?: string): LocalConsent {
  return { version, consentedAt: consentedAt || new Date().toISOString() }
}
