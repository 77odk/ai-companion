// 干活中心 · 激活码（前端校验版，MVP 够用）
// 格式：XXXX-XXXX-XXXX，去掉连字符共 12 位。
// 后 4 位是前 8 位数据位的校验位：
//   前 8 位字符按字母表转数值（A=0, B=1, ...）
//   第 1 个校验字符 = 前 4 位数值之和 % 32
//   第 2 个校验字符 = 后 4 位数值之和 % 32
//   第 3 个校验字符 = (第 1 + 第 2 校验字符数值) % 32
//   第 4 个校验字符 = 前 8 位所有数值之和 % 32
// 校验通过 = 后 4 位与算出的 4 位完全一致。
// 字符表去掉易混淆的 0/O/1/I，共 32 个字符。

const ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789'
const ALPHABET_SIZE = ALPHABET.length

export const UNLOCK_KEY = 'ac_companion_unlocked'

export interface UnlockRecord {
  code: string
  at: number
}

function charValue(ch: string): number {
  return ALPHABET.indexOf(ch)
}

/** 由 8 位数据位算出 4 位校验码 */
function computeChecksum(data8: string): string {
  const vals = data8.split('').map(charValue)
  const c1 = vals.slice(0, 4).reduce((a, b) => a + b, 0) % ALPHABET_SIZE
  const c2 = vals.slice(4, 8).reduce((a, b) => a + b, 0) % ALPHABET_SIZE
  const c3 = (c1 + c2) % ALPHABET_SIZE
  const c4 = vals.reduce((a, b) => a + b, 0) % ALPHABET_SIZE
  return ALPHABET[c1] + ALPHABET[c2] + ALPHABET[c3] + ALPHABET[c4]
}

/** 全同退化码（如 AAAA-AAAA-AAAA）能自然通过校验，但极易被猜中，直接拒绝 */
function isDegenerate(code: string): boolean {
  return new Set(code.slice(0, 8)).size === 1
}

/** 校验激活码是否合法 */
export function validateCode(raw: string): boolean {
  const code = raw.trim().toUpperCase().replace(/[^A-Z0-9]/g, '')
  if (code.length !== 12) return false
  for (const ch of code) {
    if (charValue(ch) < 0) return false
  }
  if (isDegenerate(code)) return false
  return computeChecksum(code.slice(0, 8)) === code.slice(8)
}

/** 读取本地已保存的解锁记录（校验不过视为未解锁） */
export function loadUnlock(): UnlockRecord | null {
  try {
    const raw = localStorage.getItem(UNLOCK_KEY)
    if (!raw) return null
    const parsed = JSON.parse(raw) as Partial<UnlockRecord>
    if (typeof parsed.code === 'string' && typeof parsed.at === 'number' && validateCode(parsed.code)) {
      return { code: parsed.code, at: parsed.at }
    }
    return null
  } catch {
    return null
  }
}

export function isUnlocked(): boolean {
  return loadUnlock() !== null
}

/** 校验并保存激活码，成功返回 true */
export function saveUnlock(raw: string): boolean {
  const code = raw.trim().toUpperCase()
  if (!validateCode(code)) return false
  localStorage.setItem(UNLOCK_KEY, JSON.stringify({ code, at: Date.now() }))
  return true
}
