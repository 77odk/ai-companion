// 真人聊天节奏（2026-09-03 七七拍板）：思考延迟 3~10 秒，输入越长等越久
// 跑法：node scripts/test_think_delay.mjs
import { computeThinkDelayMs } from '../src/lib/api.ts'

let passed = 0
let failed = 0

function ok(cond, name) {
  if (cond) passed++
  else {
    failed++
    console.error(`  ✗ ${name}`)
  }
}

// 用固定 rand（0.5 → 区间中点），断言落在分档区间内
function mid(len) {
  return computeThinkDelayMs(len, () => 0.5)
}

console.log('[1] 短消息（几个字）：3~4 秒')
const short = mid(5)
ok(short >= 3000 && short < 4000, `5 字 → 3~4s（得 ${short}ms）`)
ok(short >= 3000 && short <= 4000, '边界含 3000/4000')

console.log('[2] 短句（8~30 字）：4~6 秒')
const s2 = mid(20)
ok(s2 >= 4000 && s2 < 6000, `20 字 → 4~6s（得 ${s2}ms）`)

console.log('[3] 中等一段（30~100 字）：5~7 秒')
const s3 = mid(60)
ok(s3 >= 5000 && s3 < 7000, `60 字 → 5~7s（得 ${s3}ms）`)

console.log('[4] 一大段（>100 字）：8~10 秒')
const s4 = mid(300)
ok(s4 >= 8000 && s4 < 10000, `300 字 → 8~10s（得 ${s4}ms）`)

console.log('[5] 分档边界：30 / 100 字')
const b30 = mid(30)
ok(b30 >= 4000 && b30 < 6000, '30 字 → 4~6s（>30 才升档，30 含在 4~6s 档）')
const b100 = mid(100)
ok(b100 >= 5000 && b100 < 7000, '100 字 → 5~7s（>100 才升档，100 含在 5~7s 档）')

console.log('[6] 空/负数输入不崩')
ok(mid(0) >= 3000 && mid(0) < 4000, '空 → 落最短档')
ok(mid(-5) >= 3000 && mid(-5) < 4000, '负 → 落最短档')

console.log('[7] 随机性：同长度两次结果可能不同')
const a = computeThinkDelayMs(60, () => 0.1)
const b = computeThinkDelayMs(60, () => 0.9)
ok(a !== b || a >= 5000, '不同 rand 值 → 不同结果或都在档内')

console.log('[8] 不超上限：即使 rand=1 也不超 10 秒')
ok(computeThinkDelayMs(999, () => 0.999) < 10000, '超长输入最大 <10s')
ok(computeThinkDelayMs(999, () => 0.999) >= 8000, '超长输入最小 ≥8s')

console.log(`\n${passed} 通过 / ${failed} 失败`)
if (failed > 0) process.exit(1)
